import { describe, expect, it, vi, beforeEach } from "vitest";
import { IdePermissionDelegate } from "./idePermissionDelegate";
import type { IdeBridgeServer } from "./ideBridgeServer";
import type { IdeBridgeEvent } from "./ideBridgeTypes";

function createMockBridge() {
  const sentEvents: Array<{ sessionId: string; event: IdeBridgeEvent }> = [];
  const approvalCallbacks = new Map<string, (decision: "approve" | "deny") => void>();
  let hasConnected = true;

  const bridge: IdeBridgeServer = {
    sendToSession(sessionId: string, event: IdeBridgeEvent) {
      sentEvents.push({ sessionId, event });
    },
    onApprovalDecision(approvalId: string, callback: (decision: "approve" | "deny") => void) {
      approvalCallbacks.set(approvalId, callback);
    },
    removeApprovalCallback(approvalId: string) {
      approvalCallbacks.delete(approvalId);
    },
    hasConnectedSessions() {
      return hasConnected;
    },
  } as unknown as IdeBridgeServer;

  return {
    bridge,
    sentEvents,
    approvalCallbacks,
    setConnected(value: boolean) {
      hasConnected = value;
    },
  };
}

describe("IdePermissionDelegate", () => {
  let mock: ReturnType<typeof createMockBridge>;
  let delegate: IdePermissionDelegate;

  beforeEach(() => {
    mock = createMockBridge();
    delegate = new IdePermissionDelegate(mock.bridge);
  });

  describe("requestApproval", () => {
    it("sends an approval_needed event to the specified session", async () => {
      // Set up immediate approval
      const approvalPromise = delegate.requestApproval({
        sessionId: "session-1",
        toolName: "bash",
        toolInput: { command: "rm -rf /tmp/test" },
        message: "Delete test directory?",
        timeoutMs: 100,
      });

      // The event should have been sent immediately
      expect(mock.sentEvents).toHaveLength(1);
      expect(mock.sentEvents[0].sessionId).toBe("session-1");
      const event = mock.sentEvents[0].event;
      expect(event.type).toBe("approval_needed");
      if (event.type === "approval_needed") {
        expect(event.toolName).toBe("bash");
        expect(event.message).toBe("Delete test directory?");
      }

      // Simulate approval response
      const approvalId = (event as { approvalId: string }).approvalId;
      const callback = mock.approvalCallbacks.get(approvalId);
      expect(callback).toBeTruthy();
      callback!("approve");

      const result = await approvalPromise;
      expect(result).toBe("approve");
    });

    it("returns 'deny' when the IDE denies the request", async () => {
      const approvalPromise = delegate.requestApproval({
        sessionId: "session-1",
        toolName: "file_write",
        toolInput: { path: "/etc/hosts" },
        message: "Write to system file?",
        timeoutMs: 100,
      });

      const event = mock.sentEvents[0].event;
      const approvalId = (event as { approvalId: string }).approvalId;
      mock.approvalCallbacks.get(approvalId)!("deny");

      const result = await approvalPromise;
      expect(result).toBe("deny");
    });

    it("returns 'timeout' when no response arrives within the timeout", async () => {
      const result = await delegate.requestApproval({
        sessionId: "session-1",
        toolName: "bash",
        toolInput: { command: "echo hello" },
        message: "Run echo?",
        timeoutMs: 50,
      });

      expect(result).toBe("timeout");
    });

    it("cleans up the callback after timeout", async () => {
      await delegate.requestApproval({
        sessionId: "session-1",
        toolName: "bash",
        toolInput: {},
        message: "Test?",
        timeoutMs: 50,
      });

      // After timeout, the approval callback should have been removed
      expect(mock.approvalCallbacks.size).toBe(0);
    });

    it("ignores late responses after resolution", async () => {
      const approvalPromise = delegate.requestApproval({
        sessionId: "session-1",
        toolName: "bash",
        toolInput: {},
        message: "Test?",
        timeoutMs: 500,
      });

      const event = mock.sentEvents[0].event;
      const approvalId = (event as { approvalId: string }).approvalId;
      const callback = mock.approvalCallbacks.get(approvalId)!;

      // First call resolves the promise
      callback("approve");
      const result = await approvalPromise;
      expect(result).toBe("approve");

      // Second call should be ignored (no error, no change)
      callback("deny");
    });

    it("uses default timeout of 30 seconds when not specified", async () => {
      // Just verify that it sends the event without requiring timeoutMs
      const approvalPromise = delegate.requestApproval({
        sessionId: "session-1",
        toolName: "bash",
        toolInput: {},
        message: "Test?",
      });

      // Immediately resolve to not wait 30s
      const event = mock.sentEvents[0].event;
      const approvalId = (event as { approvalId: string }).approvalId;
      mock.approvalCallbacks.get(approvalId)!("approve");

      const result = await approvalPromise;
      expect(result).toBe("approve");
    });
  });

  describe("hasConnectedIde", () => {
    it("returns true when sessions are connected", () => {
      mock.setConnected(true);
      expect(delegate.hasConnectedIde()).toBe(true);
    });

    it("returns false when no sessions are connected", () => {
      mock.setConnected(false);
      expect(delegate.hasConnectedIde()).toBe(false);
    });
  });
});
