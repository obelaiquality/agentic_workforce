import Fastify from "fastify";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { IdeBridgeServer } from "./ideBridgeServer";
import { IdeSessionManager } from "./ideSessionManager";

function createHarness() {
  const app = Fastify();
  const sessionManager = new IdeSessionManager();
  const bridgeServer = new IdeBridgeServer(sessionManager);
  bridgeServer.register(app);
  return { app, sessionManager, bridgeServer };
}

async function connectSession(app: ReturnType<typeof Fastify>, clientType = "vscode") {
  const response = await app.inject({
    method: "POST",
    url: "/api/ide/connect",
    payload: { clientType },
  });
  return response.json() as { sessionId: string; token: string; clientType: string; connectedAt: string };
}

describe("IdeBridgeServer", () => {
  let harness: ReturnType<typeof createHarness>;

  beforeEach(() => {
    harness = createHarness();
  });

  afterEach(async () => {
    await harness.app.close();
  });

  describe("POST /api/ide/connect", () => {
    it("creates a new session and returns token", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/ide/connect",
        payload: { clientType: "vscode" },
      });

      expect(response.statusCode).toBe(201);
      const body = response.json();
      expect(body.sessionId).toBeTruthy();
      expect(body.token).toBeTruthy();
      expect(body.clientType).toBe("vscode");
      expect(body.connectedAt).toBeTruthy();
    });

    it("defaults to generic client type for unknown values", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/ide/connect",
        payload: { clientType: "sublime" },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().clientType).toBe("generic");
    });

    it("defaults to generic when no clientType is provided", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/ide/connect",
        payload: {},
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().clientType).toBe("generic");
    });
  });

  describe("DELETE /api/ide/disconnect", () => {
    it("removes a session by its token", async () => {
      const session = await connectSession(harness.app);

      const response = await harness.app.inject({
        method: "DELETE",
        url: `/api/ide/disconnect?token=${session.token}`,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ok).toBe(true);

      // Verify session is gone
      expect(harness.sessionManager.getSession(session.sessionId)).toBeNull();
    });

    it("returns 401 for invalid token", async () => {
      const response = await harness.app.inject({
        method: "DELETE",
        url: "/api/ide/disconnect?token=invalid",
      });

      expect(response.statusCode).toBe(401);
    });

    it("returns 401 when no token is provided", async () => {
      const response = await harness.app.inject({
        method: "DELETE",
        url: "/api/ide/disconnect",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("GET /api/ide/status", () => {
    it("returns session status for a valid token", async () => {
      const session = await connectSession(harness.app);

      const response = await harness.app.inject({
        method: "GET",
        url: `/api/ide/status?token=${session.token}`,
      });

      expect(response.statusCode).toBe(200);
      const body = response.json();
      expect(body.sessionId).toBe(session.sessionId);
      expect(body.clientType).toBe("vscode");
      expect(body.connectedAt).toBeTruthy();
      expect(body.lastActivityAt).toBeTruthy();
      expect(typeof body.hasActiveStream).toBe("boolean");
    });

    it("supports Authorization header", async () => {
      const session = await connectSession(harness.app);

      const response = await harness.app.inject({
        method: "GET",
        url: "/api/ide/status",
        headers: {
          authorization: `Bearer ${session.token}`,
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().sessionId).toBe(session.sessionId);
    });

    it("returns 401 for invalid token", async () => {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/ide/status?token=bad-token",
      });

      expect(response.statusCode).toBe(401);
    });
  });

  describe("POST /api/ide/approval", () => {
    it("accepts an approval decision", async () => {
      const session = await connectSession(harness.app);

      const response = await harness.app.inject({
        method: "POST",
        url: `/api/ide/approval?token=${session.token}`,
        payload: {
          approvalId: "approval-123",
          decision: "approve",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().ok).toBe(true);
      expect(response.json().approvalId).toBe("approval-123");
      expect(response.json().decision).toBe("approve");
    });

    it("accepts a deny decision", async () => {
      const session = await connectSession(harness.app);

      const response = await harness.app.inject({
        method: "POST",
        url: `/api/ide/approval?token=${session.token}`,
        payload: {
          approvalId: "approval-456",
          decision: "deny",
        },
      });

      expect(response.statusCode).toBe(200);
      expect(response.json().decision).toBe("deny");
    });

    it("returns 400 for missing approvalId", async () => {
      const session = await connectSession(harness.app);

      const response = await harness.app.inject({
        method: "POST",
        url: `/api/ide/approval?token=${session.token}`,
        payload: { decision: "approve" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 for invalid decision", async () => {
      const session = await connectSession(harness.app);

      const response = await harness.app.inject({
        method: "POST",
        url: `/api/ide/approval?token=${session.token}`,
        payload: {
          approvalId: "approval-789",
          decision: "maybe",
        },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 401 for invalid token", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/ide/approval?token=invalid",
        payload: {
          approvalId: "approval-123",
          decision: "approve",
        },
      });

      expect(response.statusCode).toBe(401);
    });

    it("invokes the registered approval callback", async () => {
      const session = await connectSession(harness.app);
      let capturedDecision: string | null = null;

      harness.bridgeServer.onApprovalDecision("callback-test", (decision) => {
        capturedDecision = decision;
      });

      await harness.app.inject({
        method: "POST",
        url: `/api/ide/approval?token=${session.token}`,
        payload: {
          approvalId: "callback-test",
          decision: "deny",
        },
      });

      expect(capturedDecision).toBe("deny");
    });
  });

  describe("GET /api/ide/events", () => {
    // NOTE: Fastify's inject() waits for the full response, but SSE streams
    // never close. Auth (401) can still be tested because it returns before
    // hijacking. Queue/subscriber logic is tested via the public API instead.

    it("returns 401 for invalid token", async () => {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/ide/events?token=bad-token",
      });

      expect(response.statusCode).toBe(401);
    });

    it("queues a welcome event on connect that would be flushed by the stream", async () => {
      const session = await connectSession(harness.app);

      // The POST /connect handler queues a session_status:connected event
      const queues = (harness.bridgeServer as unknown as { eventQueues: Map<string, unknown[]> }).eventQueues;
      const queue = queues.get(session.sessionId);
      expect(queue).toBeDefined();
      expect(queue!.length).toBeGreaterThanOrEqual(1);
      expect(queue![0]).toEqual({
        type: "session_status",
        status: "connected",
      });
    });

    it("queued events accumulate before the stream is opened", async () => {
      const session = await connectSession(harness.app);

      harness.bridgeServer.sendToSession(session.sessionId, {
        type: "file_changed",
        path: "/src/main.ts",
        action: "created",
      });

      const queues = (harness.bridgeServer as unknown as { eventQueues: Map<string, unknown[]> }).eventQueues;
      const queue = queues.get(session.sessionId);
      // welcome event + file_changed
      expect(queue!.length).toBe(2);
      expect((queue![1] as Record<string, unknown>).type).toBe("file_changed");
    });
  });

  describe("broadcast", () => {
    it("queues events for connected sessions without active streams", () => {
      const session = harness.sessionManager.createSession("vscode");
      // Initialize the queue (normally done by POST /connect)
      (harness.bridgeServer as unknown as { eventQueues: Map<string, unknown[]> }).eventQueues.set(session.id, []);

      harness.bridgeServer.broadcast({
        type: "session_status",
        status: "running",
      });

      // Access the queue directly
      const queues = (harness.bridgeServer as unknown as { eventQueues: Map<string, unknown[]> }).eventQueues;
      const queue = queues.get(session.id);
      expect(queue).toHaveLength(1);
    });
  });

  describe("sendToSession", () => {
    it("queues an event when no active stream subscriber exists", () => {
      const session = harness.sessionManager.createSession("vscode");
      (harness.bridgeServer as unknown as { eventQueues: Map<string, unknown[]> }).eventQueues.set(session.id, []);

      harness.bridgeServer.sendToSession(session.id, {
        type: "file_changed",
        path: "/src/index.ts",
        action: "modified",
      });

      const queues = (harness.bridgeServer as unknown as { eventQueues: Map<string, unknown[]> }).eventQueues;
      const queue = queues.get(session.id);
      expect(queue).toHaveLength(1);
      expect((queue![0] as Record<string, unknown>).type).toBe("file_changed");
    });
  });

  describe("hasConnectedSessions", () => {
    it("returns false when no sessions exist", () => {
      expect(harness.bridgeServer.hasConnectedSessions()).toBe(false);
    });

    it("returns true when a session exists", async () => {
      await connectSession(harness.app);
      expect(harness.bridgeServer.hasConnectedSessions()).toBe(true);
    });
  });

  describe("POST /api/ide/connect with null body", () => {
    it("defaults to generic when body is null", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/ide/connect",
        // Fastify will send null body for empty content
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().clientType).toBe("generic");
    });
  });

  describe("POST /api/ide/connect with jetbrains clientType", () => {
    it("accepts jetbrains as valid client type", async () => {
      const response = await harness.app.inject({
        method: "POST",
        url: "/api/ide/connect",
        payload: { clientType: "jetbrains" },
      });

      expect(response.statusCode).toBe(201);
      expect(response.json().clientType).toBe("jetbrains");
    });
  });

  describe("POST /api/ide/approval edge cases", () => {
    it("returns 400 when decision is missing", async () => {
      const session = await connectSession(harness.app);

      const response = await harness.app.inject({
        method: "POST",
        url: `/api/ide/approval?token=${session.token}`,
        payload: { approvalId: "test-id" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 400 when approvalId is missing and decision is valid", async () => {
      const session = await connectSession(harness.app);

      const response = await harness.app.inject({
        method: "POST",
        url: `/api/ide/approval?token=${session.token}`,
        payload: { decision: "approve" },
      });

      expect(response.statusCode).toBe(400);
    });

    it("returns 200 even when no callback registered for the approvalId", async () => {
      const session = await connectSession(harness.app);

      const response = await harness.app.inject({
        method: "POST",
        url: `/api/ide/approval?token=${session.token}`,
        payload: { approvalId: "no-callback-registered", decision: "approve" },
      });

      // Should still succeed — callback is optional
      expect(response.statusCode).toBe(200);
      expect(response.json().ok).toBe(true);
    });
  });

  describe("removeApprovalCallback", () => {
    it("removes a pending approval callback", async () => {
      let called = false;
      harness.bridgeServer.onApprovalDecision("removable", () => {
        called = true;
      });

      harness.bridgeServer.removeApprovalCallback("removable");

      const session = await connectSession(harness.app);

      await harness.app.inject({
        method: "POST",
        url: `/api/ide/approval?token=${session.token}`,
        payload: { approvalId: "removable", decision: "approve" },
      });

      expect(called).toBe(false);
    });
  });

  describe("sendToSession with active subscriber", () => {
    it("sends event directly via subscriber when active", () => {
      const session = harness.sessionManager.createSession("vscode");
      const received: unknown[] = [];

      // Register a subscriber directly
      const subscribers = (harness.bridgeServer as any).eventSubscribers as Map<string, (event: any) => void>;
      subscribers.set(session.id, (event: unknown) => {
        received.push(event);
      });

      harness.bridgeServer.sendToSession(session.id, {
        type: "session_status",
        status: "running",
      });

      expect(received).toHaveLength(1);
      expect((received[0] as any).status).toBe("running");
    });

    it("falls back to queue when subscriber throws", () => {
      const session = harness.sessionManager.createSession("vscode");
      (harness.bridgeServer as any).eventQueues.set(session.id, []);

      const subscribers = (harness.bridgeServer as any).eventSubscribers as Map<string, (event: any) => void>;
      subscribers.set(session.id, () => {
        throw new Error("subscriber failed");
      });

      harness.bridgeServer.sendToSession(session.id, {
        type: "session_status",
        status: "error",
      });

      // Subscriber should have been removed
      expect(subscribers.has(session.id)).toBe(false);

      // Event should be queued
      const queue = (harness.bridgeServer as any).eventQueues.get(session.id);
      expect(queue).toHaveLength(1);
    });
  });

  describe("sendToSession without queue", () => {
    it("does nothing when no queue and no subscriber", () => {
      // No session exists at all — should not throw
      expect(() =>
        harness.bridgeServer.sendToSession("nonexistent-session", {
          type: "session_status",
          status: "idle",
        })
      ).not.toThrow();
    });
  });

  describe("broadcast with subscriber that throws", () => {
    it("removes subscriber that throws during broadcast", () => {
      const session = harness.sessionManager.createSession("vscode");
      (harness.bridgeServer as any).eventQueues.set(session.id, []);

      const subscribers = (harness.bridgeServer as any).eventSubscribers as Map<string, (event: any) => void>;
      subscribers.set(session.id, () => {
        throw new Error("crash");
      });

      harness.bridgeServer.broadcast({
        type: "session_status",
        status: "running",
      });

      expect(subscribers.has(session.id)).toBe(false);
    });
  });

  describe("broadcast queue overflow protection", () => {
    it("caps the event queue at 1000 entries", () => {
      const session = harness.sessionManager.createSession("vscode");
      const queue: unknown[] = [];
      (harness.bridgeServer as any).eventQueues.set(session.id, queue);

      // Fill past capacity
      for (let i = 0; i < 1010; i++) {
        harness.bridgeServer.broadcast({
          type: "session_status",
          status: "running",
        });
      }

      expect(queue.length).toBe(1000);
    });
  });

  describe("sendToSession queue overflow protection", () => {
    it("caps the event queue at 1000 entries", () => {
      const session = harness.sessionManager.createSession("vscode");
      const queue: unknown[] = [];
      (harness.bridgeServer as any).eventQueues.set(session.id, queue);

      for (let i = 0; i < 1010; i++) {
        harness.bridgeServer.sendToSession(session.id, {
          type: "session_status",
          status: "idle",
        });
      }

      expect(queue.length).toBe(1000);
    });
  });

  describe("extractSession from Authorization header", () => {
    it("extracts token from Authorization header with array value", async () => {
      const session = await connectSession(harness.app);

      // Test via status endpoint
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/ide/status",
        headers: {
          authorization: `Bearer ${session.token}`,
        },
      });

      expect(response.statusCode).toBe(200);
    });

    it("returns null when no token in query or headers", async () => {
      const response = await harness.app.inject({
        method: "GET",
        url: "/api/ide/status",
      });

      expect(response.statusCode).toBe(401);
    });
  });
});
