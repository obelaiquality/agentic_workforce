/**
 * Session routes — CRUD for chat sessions with conversation history.
 *
 * Endpoints:
 *   GET  /api/v1/sessions          — List sessions (optionally filtered by repo)
 *   GET  /api/v1/sessions/:id      — Get session with full message history
 *   POST /api/v1/sessions          — Create a new session
 *   POST /api/v1/sessions/:id/messages — Add a message to a session
 *   PATCH /api/v1/sessions/:id     — Update session title/metadata
 *   DELETE /api/v1/sessions/:id    — Delete session and its messages
 */

import type { FastifyInstance } from "fastify";
import {
  listSessions,
  getSession,
  createSession,
  addMessage,
  updateSession,
  deleteSession,
} from "../services/sessionService";

export function registerSessionRoutes(app: FastifyInstance): void {
  // List sessions
  app.get("/api/v1/sessions", async (request) => {
    const query = request.query as {
      repoId?: string;
      limit?: string;
      offset?: string;
      search?: string;
    };

    const result = await listSessions({
      repoId: query.repoId || undefined,
      limit: query.limit ? Number(query.limit) : undefined,
      offset: query.offset ? Number(query.offset) : undefined,
      search: query.search || undefined,
    });

    return { items: result.items, total: result.total };
  });

  // Get session with messages
  app.get("/api/v1/sessions/:id", async (request, reply) => {
    const { id } = request.params as { id: string };
    const session = await getSession(id);
    if (!session) {
      return reply.status(404).send({ error: "Session not found" });
    }
    return { item: session };
  });

  // Create session
  app.post("/api/v1/sessions", async (request) => {
    const body = request.body as {
      title: string;
      repoId?: string;
      providerId?: string;
      metadata?: Record<string, unknown>;
    };

    const session = await createSession({
      title: body.title,
      repoId: body.repoId,
      providerId: body.providerId,
      metadata: body.metadata,
    });

    return { item: session };
  });

  // Add message to session
  app.post("/api/v1/sessions/:id/messages", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      role: "system" | "user" | "assistant";
      content: string;
      metadata?: Record<string, unknown>;
    };

    const message = await addMessage({
      sessionId: id,
      role: body.role,
      content: body.content,
      metadata: body.metadata,
    });

    return { item: message };
  });

  // Update session
  app.patch("/api/v1/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    const body = request.body as {
      title?: string;
      metadata?: Record<string, unknown>;
    };

    const session = await updateSession(id, {
      title: body.title,
      metadata: body.metadata,
    });

    return { item: session };
  });

  // Delete session
  app.delete("/api/v1/sessions/:id", async (request) => {
    const { id } = request.params as { id: string };
    await deleteSession(id);
    return { ok: true };
  });
}
