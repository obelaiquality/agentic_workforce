/**
 * SessionService — CRUD for chat sessions with conversation history.
 *
 * Provides session persistence, resume capability, and search across
 * past conversations. Wraps the Prisma ChatSession and ChatMessage models.
 */

import { prisma } from "../db";
import type { ChatMessageRole } from "@prisma/client";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface SessionSummary {
  id: string;
  title: string;
  repoId: string | null;
  providerId: string;
  messageCount: number;
  lastMessageAt: string | null;
  createdAt: string;
  updatedAt: string;
  metadata: Record<string, unknown>;
}

export interface SessionDetail extends SessionSummary {
  messages: SessionMessage[];
}

export interface SessionMessage {
  id: string;
  role: ChatMessageRole;
  content: string;
  metadata: Record<string, unknown> | null;
  createdAt: string;
}

export interface CreateSessionInput {
  title: string;
  repoId?: string | null;
  providerId?: string;
  metadata?: Record<string, unknown>;
}

export interface AddMessageInput {
  sessionId: string;
  role: ChatMessageRole;
  content: string;
  metadata?: Record<string, unknown>;
}

// ---------------------------------------------------------------------------
// Service
// ---------------------------------------------------------------------------

/**
 * List recent sessions, optionally filtered by repo.
 */
export async function listSessions(options?: {
  repoId?: string;
  limit?: number;
  offset?: number;
  search?: string;
}): Promise<{ items: SessionSummary[]; total: number }> {
  const { repoId, limit = 20, offset = 0, search } = options ?? {};

  const where: Record<string, unknown> = {};
  if (repoId) where.repoId = repoId;
  if (search) {
    where.OR = [
      { title: { contains: search, mode: "insensitive" } },
      { messages: { some: { content: { contains: search, mode: "insensitive" } } } },
    ];
  }

  const [rows, total] = await Promise.all([
    prisma.chatSession.findMany({
      where,
      orderBy: { updatedAt: "desc" },
      take: limit,
      skip: offset,
      include: {
        _count: { select: { messages: true } },
        messages: {
          orderBy: { createdAt: "desc" },
          take: 1,
          select: { createdAt: true },
        },
      },
    }),
    prisma.chatSession.count({ where }),
  ]);

  const items: SessionSummary[] = rows.map((row) => ({
    id: row.id,
    title: row.title,
    repoId: row.repoId,
    providerId: row.providerId,
    messageCount: row._count.messages,
    lastMessageAt: row.messages[0]?.createdAt.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  }));

  return { items, total };
}

/**
 * Get a session with its full conversation history.
 */
export async function getSession(sessionId: string): Promise<SessionDetail | null> {
  const row = await prisma.chatSession.findUnique({
    where: { id: sessionId },
    include: {
      _count: { select: { messages: true } },
      messages: {
        orderBy: { createdAt: "asc" },
      },
    },
  });

  if (!row) return null;

  return {
    id: row.id,
    title: row.title,
    repoId: row.repoId,
    providerId: row.providerId,
    messageCount: row._count.messages,
    lastMessageAt: row.messages.at(-1)?.createdAt.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
    messages: row.messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      content: msg.content,
      metadata: (msg.metadata as Record<string, unknown>) ?? null,
      createdAt: msg.createdAt.toISOString(),
    })),
  };
}

/**
 * Create a new session.
 */
export async function createSession(input: CreateSessionInput): Promise<SessionSummary> {
  const row = await prisma.chatSession.create({
    data: {
      title: input.title,
      repoId: input.repoId ?? null,
      providerId: input.providerId ?? "onprem-qwen",
      metadata: input.metadata ?? {},
    },
  });

  return {
    id: row.id,
    title: row.title,
    repoId: row.repoId,
    providerId: row.providerId,
    messageCount: 0,
    lastMessageAt: null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

/**
 * Add a message to an existing session.
 */
export async function addMessage(input: AddMessageInput): Promise<SessionMessage> {
  const msg = await prisma.chatMessage.create({
    data: {
      sessionId: input.sessionId,
      role: input.role,
      content: input.content,
      metadata: input.metadata ?? {},
    },
  });

  // Touch the session's updatedAt
  await prisma.chatSession.update({
    where: { id: input.sessionId },
    data: { updatedAt: new Date() },
  });

  return {
    id: msg.id,
    role: msg.role,
    content: msg.content,
    metadata: (msg.metadata as Record<string, unknown>) ?? null,
    createdAt: msg.createdAt.toISOString(),
  };
}

/**
 * Update session title or metadata.
 */
export async function updateSession(
  sessionId: string,
  patch: { title?: string; metadata?: Record<string, unknown> },
): Promise<SessionSummary> {
  const row = await prisma.chatSession.update({
    where: { id: sessionId },
    data: {
      ...(patch.title !== undefined ? { title: patch.title } : {}),
      ...(patch.metadata !== undefined ? { metadata: patch.metadata } : {}),
    },
    include: {
      _count: { select: { messages: true } },
      messages: {
        orderBy: { createdAt: "desc" },
        take: 1,
        select: { createdAt: true },
      },
    },
  });

  return {
    id: row.id,
    title: row.title,
    repoId: row.repoId,
    providerId: row.providerId,
    messageCount: row._count.messages,
    lastMessageAt: row.messages[0]?.createdAt.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metadata: (row.metadata as Record<string, unknown>) ?? {},
  };
}

/**
 * Delete a session and all its messages.
 */
export async function deleteSession(sessionId: string): Promise<void> {
  await prisma.chatSession.delete({
    where: { id: sessionId },
  });
}
