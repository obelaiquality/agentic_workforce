import { spawn } from "node:child_process";
import { once } from "node:events";
import { prisma } from "../db";
import type {
  CreateSessionInput,
  LlmProviderAdapter,
  ProviderAvailability,
  ProviderErrorClass,
  ProviderSendInput,
  ProviderSendOutput,
  ProviderSession,
  ProviderStreamEvent,
} from "../../shared/contracts";
import { getQwenCliConfig, resolveQwenProfileHome } from "./qwenCliConfig";

const QUOTA_PATTERNS = /(quota|rate limit|too many requests|429|exceeded)/i;
const AUTH_PATTERNS = /(auth|unauthorized|forbidden|token|credential|login)/i;
const TIMEOUT_PATTERNS = /(timed out|timeout|deadline)/i;

function buildPrompt(messages: ProviderSendInput["messages"]): string {
  return messages.map((m) => `${m.role.toUpperCase()}: ${m.content}`).join("\n\n");
}

export class QwenCliAdapter implements LlmProviderAdapter {
  id = "qwen-cli" as const;
  label = "Qwen CLI";
  capabilities = {
    streaming: true,
    tools: true,
    nativeConversationState: false,
    structuredOutputs: false,
    mcpTools: false,
  } as const;
  supportsStreaming = true;
  supportsTools = true;

  async createSession(input: CreateSessionInput): Promise<ProviderSession> {
    const account = await prisma.providerAccount.findFirst({
      where: {
        providerId: "qwen-cli",
        enabled: true,
      },
      orderBy: [{ lastUsedAt: "asc" }],
    });

    return {
      id: input.sessionId,
      provider: "qwen-cli",
      accountId: account?.id ?? "",
      model: "qwen-cli",
      capabilities: this.capabilities,
    };
  }

  async send(input: ProviderSendInput): Promise<ProviderSendOutput> {
    const chunks: string[] = [];
    for await (const event of this.stream(input)) {
      if (event.type === "token") {
        chunks.push(event.value);
      }
    }
    const text = chunks.join("").trim();
    return {
      text,
      usage: {
        totalTokens: Math.max(1, Math.ceil(text.length / 4)),
      },
    };
  }

  async *stream(input: ProviderSendInput): AsyncGenerator<ProviderStreamEvent> {
    const account = await prisma.providerAccount.findUnique({ where: { id: input.accountId } });
    if (!account) {
      throw new Error(`Qwen account '${input.accountId}' not found`);
    }

    const config = await getQwenCliConfig();
    const prompt = buildPrompt(input.messages);
    const args = [...config.args, prompt];
    const profileHome = resolveQwenProfileHome(account.profilePath);

    const commandProcess = spawn(config.command, args, {
      env: {
        ...process.env,
        HOME: profileHome,
        USERPROFILE: profileHome,
        QWEN_PROFILE_DIR: account.profilePath,
      },
      cwd: process.cwd(),
      stdio: ["ignore", "pipe", "pipe"],
    });

    let stderr = "";
    commandProcess.stderr.setEncoding("utf-8");
    commandProcess.stderr.on("data", (chunk: string) => {
      stderr += chunk;
    });

    commandProcess.stdout.setEncoding("utf-8");

    const timeout = setTimeout(() => {
      commandProcess.kill("SIGTERM");
    }, config.timeoutMs);

    try {
      for await (const chunk of commandProcess.stdout) {
        yield {
          type: "token",
          value: String(chunk),
        };
      }

      const [exitCode] = (await once(commandProcess, "close")) as [number];

      if (exitCode !== 0) {
        const error = new Error(stderr || `Qwen CLI exited with code ${exitCode}`);
        throw error;
      }

      yield {
        type: "done",
      };
    } finally {
      clearTimeout(timeout);
    }
  }

  classifyError(err: unknown): ProviderErrorClass {
    const message = err instanceof Error ? err.message : String(err);

    if (QUOTA_PATTERNS.test(message)) {
      return "quota_exhausted";
    }
    if (AUTH_PATTERNS.test(message)) {
      return "auth_required";
    }
    if (TIMEOUT_PATTERNS.test(message)) {
      return "timeout";
    }
    if (/ENOENT|spawn/i.test(message)) {
      return "provider_unavailable";
    }
    return "unknown";
  }

  async estimateAvailability(accountId: string): Promise<ProviderAvailability> {
    const account = await prisma.providerAccount.findUnique({ where: { id: accountId } });
    if (!account) {
      return {
        accountId,
        state: "disabled",
        nextUsableAt: null,
        confidence: 0,
      };
    }

    return {
      accountId,
      state: account.enabled ? (account.state as ProviderAvailability["state"]) : "disabled",
      nextUsableAt: account.quotaNextUsableAt?.toISOString() ?? null,
      confidence: account.quotaEtaConfidence,
    };
  }
}
