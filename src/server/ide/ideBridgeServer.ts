import type { FastifyInstance } from "fastify";
import type { IdeSessionManager } from "./ideSessionManager";
import type { IdeBridgeEvent } from "./ideBridgeTypes";
import { buildStreamHeaders } from "../routes/shared/http";

/**
 * The IDE Bridge Server registers HTTP/SSE endpoints on the Fastify instance
 * to allow external IDE clients (VS Code, JetBrains, etc.) to connect,
 * receive real-time events, and submit approval decisions.
 *
 * Endpoints:
 *   POST   /api/ide/connect       - Create a new IDE session
 *   DELETE /api/ide/disconnect     - Close an existing session
 *   GET    /api/ide/events         - SSE stream of events for a session
 *   POST   /api/ide/approval       - Submit an approval decision from the IDE
 *   GET    /api/ide/status         - Get current session status
 */
export class IdeBridgeServer {
  private sessionManager: IdeSessionManager;
  private eventSubscribers = new Map<string, (event: IdeBridgeEvent) => void>();
  private eventQueues = new Map<string, IdeBridgeEvent[]>();
  private approvalCallbacks = new Map<string, (decision: "approve" | "deny") => void>();

  constructor(sessionManager: IdeSessionManager) {
    this.sessionManager = sessionManager;
  }

  /**
   * Register all IDE bridge routes on the given Fastify instance.
   */
  register(app: FastifyInstance): void {
    // ── POST /api/ide/connect ────────────────────────────────────────
    app.post("/api/ide/connect", async (request, reply) => {
      const body = request.body as Record<string, unknown> | null;
      const clientType = (body?.clientType as string) || "generic";
      const validTypes = ["vscode", "jetbrains", "generic"] as const;
      const normalizedType = validTypes.includes(clientType as typeof validTypes[number])
        ? (clientType as typeof validTypes[number])
        : "generic";

      const session = this.sessionManager.createSession(normalizedType);
      this.eventQueues.set(session.id, []);

      // Send a welcome event
      this.sendToSession(session.id, {
        type: "session_status",
        status: "connected",
      });

      return reply.code(201).send({
        sessionId: session.id,
        token: session.token,
        clientType: session.clientType,
        connectedAt: session.connectedAt,
      });
    });

    // ── DELETE /api/ide/disconnect ───────────────────────────────────
    app.delete("/api/ide/disconnect", async (request, reply) => {
      const session = this.extractSession(request);
      if (!session) {
        return reply.code(401).send({ error: "Invalid or missing session token" });
      }

      this.eventSubscribers.delete(session.id);
      this.eventQueues.delete(session.id);
      this.sessionManager.removeSession(session.id);

      return reply.code(200).send({ ok: true });
    });

    // ── GET /api/ide/events ──────────────────────────────────────────
    app.get("/api/ide/events", async (request, reply) => {
      const session = this.extractSession(request);
      if (!session) {
        return reply.code(401).send({ error: "Invalid or missing session token" });
      }

      this.sessionManager.touchSession(session.id);

      reply.hijack();
      reply.raw.writeHead(
        200,
        buildStreamHeaders(
          typeof request.headers.origin === "string" ? request.headers.origin : null,
        ),
      );

      // Flush any queued events
      const queue = this.eventQueues.get(session.id) ?? [];
      for (const event of queue) {
        reply.raw.write(`event: ide_event\n`);
        reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
      }
      this.eventQueues.set(session.id, []);

      // Register a live subscriber
      const subscriber = (event: IdeBridgeEvent) => {
        try {
          reply.raw.write(`event: ide_event\n`);
          reply.raw.write(`data: ${JSON.stringify(event)}\n\n`);
        } catch {
          // Client disconnected
          this.eventSubscribers.delete(session.id);
        }
      };
      this.eventSubscribers.set(session.id, subscriber);

      // Send a heartbeat to keep connection alive
      const heartbeat = setInterval(() => {
        try {
          reply.raw.write(`: heartbeat\n\n`);
        } catch {
          clearInterval(heartbeat);
          this.eventSubscribers.delete(session.id);
        }
      }, 15_000);

      // Clean up on close
      request.raw.on("close", () => {
        clearInterval(heartbeat);
        this.eventSubscribers.delete(session.id);
      });
    });

    // ── POST /api/ide/approval ───────────────────────────────────────
    app.post("/api/ide/approval", async (request, reply) => {
      const session = this.extractSession(request);
      if (!session) {
        return reply.code(401).send({ error: "Invalid or missing session token" });
      }

      this.sessionManager.touchSession(session.id);

      const body = request.body as Record<string, unknown> | null;
      const approvalId = body?.approvalId as string | undefined;
      const decision = body?.decision as string | undefined;

      if (!approvalId || !decision || (decision !== "approve" && decision !== "deny")) {
        return reply.code(400).send({
          error: "Request body must include approvalId and decision ('approve' | 'deny')",
        });
      }

      const callback = this.approvalCallbacks.get(approvalId);
      if (callback) {
        callback(decision as "approve" | "deny");
        this.approvalCallbacks.delete(approvalId);
      }

      // Broadcast the resolution
      this.broadcast({
        type: "approval_resolved",
        approvalId,
        decision: decision as "approve" | "deny",
      });

      return reply.code(200).send({ ok: true, approvalId, decision });
    });

    // ── GET /api/ide/status ──────────────────────────────────────────
    app.get("/api/ide/status", async (request, reply) => {
      const session = this.extractSession(request);
      if (!session) {
        return reply.code(401).send({ error: "Invalid or missing session token" });
      }

      this.sessionManager.touchSession(session.id);

      return reply.code(200).send({
        sessionId: session.id,
        clientType: session.clientType,
        connectedAt: session.connectedAt,
        lastActivityAt: session.lastActivityAt,
        hasActiveStream: this.eventSubscribers.has(session.id),
      });
    });
  }

  /**
   * Broadcast an event to all connected IDE sessions.
   */
  broadcast(event: IdeBridgeEvent): void {
    for (const [sessionId, subscriber] of this.eventSubscribers.entries()) {
      try {
        subscriber(event);
      } catch {
        this.eventSubscribers.delete(sessionId);
      }
    }

    // Also queue for sessions that are connected but not currently streaming
    for (const [sessionId, queue] of this.eventQueues.entries()) {
      if (!this.eventSubscribers.has(sessionId)) {
        queue.push(event);
        // Cap the queue to prevent unbounded memory growth
        if (queue.length > 1000) {
          queue.splice(0, queue.length - 1000);
        }
      }
    }
  }

  /**
   * Send an event to a specific session by ID.
   */
  sendToSession(sessionId: string, event: IdeBridgeEvent): void {
    const subscriber = this.eventSubscribers.get(sessionId);
    if (subscriber) {
      try {
        subscriber(event);
        return;
      } catch {
        this.eventSubscribers.delete(sessionId);
      }
    }

    // Queue the event if no active subscriber
    const queue = this.eventQueues.get(sessionId);
    if (queue) {
      queue.push(event);
      if (queue.length > 1000) {
        queue.splice(0, queue.length - 1000);
      }
    }
  }

  /**
   * Register a callback for an approval decision from an IDE client.
   * Used internally by IdePermissionDelegate.
   */
  onApprovalDecision(approvalId: string, callback: (decision: "approve" | "deny") => void): void {
    this.approvalCallbacks.set(approvalId, callback);
  }

  /**
   * Remove a pending approval callback.
   */
  removeApprovalCallback(approvalId: string): void {
    this.approvalCallbacks.delete(approvalId);
  }

  /**
   * Check whether any IDE sessions are currently connected.
   */
  hasConnectedSessions(): boolean {
    return this.sessionManager.listSessions().length > 0;
  }

  // ── Private helpers ──────────────────────────────────────────────

  private extractSession(request: { query: unknown; headers: Record<string, string | string[] | undefined> }) {
    // Token can come from query string or Authorization header
    const query = request.query as Record<string, string> | undefined;
    let token = query?.token;
    if (!token) {
      const auth = request.headers.authorization;
      const authStr = Array.isArray(auth) ? auth[0] : auth;
      if (authStr?.startsWith("Bearer ")) {
        token = authStr.slice(7);
      }
    }
    if (!token) {
      return null;
    }
    return this.sessionManager.validateToken(token);
  }
}
