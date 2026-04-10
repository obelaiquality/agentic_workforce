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
});
