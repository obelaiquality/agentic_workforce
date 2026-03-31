import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import { publishEvent } from "../eventBus";
import type { ChatMessageDto, ChatSessionDto, ModelRole } from "../../shared/contracts";
import { ProviderOrchestrator } from "./providerOrchestrator";

const RISKY_ACTIONS = new Set(["file_write", "apply_patch", "run_command", "provider_change"]);

function mapSession(session: {
  id: string;
  repoId: string | null;
  title: string;
  providerId: string;
  createdAt: Date;
  updatedAt: Date;
  metadata: unknown;
}): ChatSessionDto {
  return {
    id: session.id,
    repoId: session.repoId,
    title: session.title,
    providerId: session.providerId as ChatSessionDto["providerId"],
    createdAt: session.createdAt.toISOString(),
    updatedAt: session.updatedAt.toISOString(),
    metadata: (session.metadata ?? undefined) as Record<string, unknown> | undefined,
  };
}

function mapMessage(message: {
  id: string;
  sessionId: string;
  role: string;
  content: string;
  createdAt: Date;
  metadata: unknown;
}): ChatMessageDto {
  return {
    id: message.id,
    sessionId: message.sessionId,
    role: message.role as ChatMessageDto["role"],
    content: message.content,
    createdAt: message.createdAt.toISOString(),
    metadata: (message.metadata ?? undefined) as Record<string, unknown> | undefined,
  };
}

function parseActions(text: string) {
  const matches = Array.from(text.matchAll(/\[ACTION:([a-z_]+)(?:\s+payload=(\{.*?\}))?\]/gi));
  return matches.map((match) => {
    const actionType = match[1].toLowerCase();
    let payload: Record<string, unknown> = {};

    if (match[2]) {
      try {
        payload = JSON.parse(match[2]);
      } catch {
        payload = { raw: match[2] };
      }
    }

    return { actionType, payload };
  });
}

export class ChatService {
  constructor(private readonly providerOrchestrator: ProviderOrchestrator) {}

  async listSessions(repoId?: string) {
    const sessions = await prisma.chatSession.findMany({
      where: repoId ? { repoId } : undefined,
      orderBy: { updatedAt: "desc" },
      take: 20,
    });
    return sessions.map(mapSession);
  }

  async createSession(title: string, repoId?: string | null) {
    const activeProvider = await this.providerOrchestrator.getActiveProvider();
    const providerSession = await this.providerOrchestrator
      .getProviderAdapter(activeProvider)
      .createSession({ sessionId: randomUUID(), metadata: { title } })
      .catch(() => null);
    const session = await prisma.chatSession.create({
      data: {
        repoId: repoId || null,
        title,
        providerId: activeProvider,
        metadata: providerSession
          ? {
              providerSession,
            }
          : undefined,
      },
    });

    await prisma.auditEvent.create({
      data: {
        actor: "user",
        eventType: "chat.session_created",
        payload: { sessionId: session.id },
      },
    });

    return mapSession(session);
  }

  async listMessages(sessionId: string) {
    const messages = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    return messages.map(mapMessage);
  }

  async createUserMessage(
    sessionId: string,
    content: string,
    options?: {
      modelRole?: ModelRole;
      metadata?: Record<string, unknown>;
    }
  ) {
    const message = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "user",
        content,
        metadata: options?.modelRole
          ? {
              ...(options?.metadata || {}),
              modelRole: options.modelRole,
            }
          : options?.metadata,
      },
    });

    if (options?.modelRole) {
      const session = await prisma.chatSession.findUnique({
        where: { id: sessionId },
      });
      await prisma.chatSession.update({
        where: { id: sessionId },
        data: {
          metadata: {
            ...(session?.metadata as Record<string, unknown> | undefined),
            preferredModelRole: options.modelRole,
          },
        },
      });
    }

    const dto = mapMessage(message);
    publishEvent(`session:${sessionId}`, "chat.message.user", dto as unknown as Record<string, unknown>);

    this.runAssistantTurn(sessionId, options?.modelRole).catch(async (error) => {
      const messageText = error instanceof Error ? error.message : String(error);

      publishEvent(`session:${sessionId}`, "chat.error", {
        sessionId,
        message: messageText,
      });

      await prisma.auditEvent.create({
        data: {
          actor: "system",
          eventType: "chat.turn_failed",
          payload: {
            sessionId,
            message: messageText,
          },
        },
      });
    });

    return dto;
  }

  private async runAssistantTurn(sessionId: string, explicitModelRole?: ModelRole) {
    const session = await prisma.chatSession.findUnique({
      where: { id: sessionId },
    });
    if (!session) {
      throw new Error(`Chat session not found: ${sessionId}`);
    }

    const messages = await prisma.chatMessage.findMany({
      where: { sessionId },
      orderBy: { createdAt: "asc" },
    });

    const providerMessages = messages.map((message) => ({
      role: message.role as "system" | "user" | "assistant",
      content: message.content,
    }));

    const metadata = (session?.metadata as Record<string, unknown> | null) || {};
    const preferredModelRole =
      explicitModelRole ||
      (typeof metadata.preferredModelRole === "string" ? (metadata.preferredModelRole as ModelRole) : "coder_default");

    let accumulated = "";
    const streamResult = await this.providerOrchestrator.streamChatWithRetry(
      sessionId,
      providerMessages,
      (token) => {
        accumulated += token;
        publishEvent(`session:${sessionId}`, "chat.token", {
          sessionId,
          token,
        });
      },
      {
        modelRole: preferredModelRole,
        metadata: {
          previousResponseId:
            typeof metadata.previousResponseId === "string"
              ? metadata.previousResponseId
              : undefined,
        },
      }
    );

    const assistantMessage = await prisma.chatMessage.create({
      data: {
        sessionId,
        role: "assistant",
        content: accumulated.trim(),
        metadata: {
          accountId: streamResult.accountId,
          providerId: streamResult.providerId,
          modelRole: preferredModelRole,
        },
      },
    });

    await prisma.chatSession.update({
      where: { id: sessionId },
      data: {
        providerId: streamResult.providerId,
        activeAccount: streamResult.accountId || null,
        metadata: {
          ...(metadata || undefined),
          previousResponseId: streamResult.session?.previousResponseId || null,
          providerSession: streamResult.session || null,
          lastUsage: streamResult.usage || null,
          preferredModelRole,
        },
      },
    });

    const actions = parseActions(assistantMessage.content);

    for (const action of actions) {
      if (!RISKY_ACTIONS.has(action.actionType)) {
        continue;
      }

      await prisma.approvalRequest.create({
        data: {
          actionType: action.actionType,
          payload: {
            ...action.payload,
            sessionId,
          },
        },
      });
    }

    const dto = mapMessage(assistantMessage);

    publishEvent(`session:${sessionId}`, "chat.message.assistant", dto as unknown as Record<string, unknown>);
    publishEvent(`session:${sessionId}`, "chat.done", {
      sessionId,
      messageId: assistantMessage.id,
      accountId: streamResult.accountId,
      providerId: streamResult.providerId,
    });

    await prisma.auditEvent.create({
      data: {
        actor: "agent",
        eventType: "chat.turn_completed",
        payload: {
          sessionId,
          messageId: assistantMessage.id,
          providerId: streamResult.providerId,
          accountId: streamResult.accountId,
        },
      },
    });
  }
}
