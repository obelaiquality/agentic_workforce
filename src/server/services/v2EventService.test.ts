import { describe, it, expect, vi, beforeEach } from "vitest";
import { V2EventService } from "./v2EventService";
import type { SidecarClient } from "../sidecar/client";

// Mock the eventBus module
vi.mock("../eventBus", () => ({
  publishEvent: vi.fn(),
}));

// Import publishEvent after mock is set up
import { publishEvent } from "../eventBus";

// Stable UUID for deterministic tests
const FAKE_UUID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
vi.mock("node:crypto", () => ({
  randomUUID: () => FAKE_UUID,
}));

function makeSidecar(overrides: Partial<SidecarClient> = {}): SidecarClient {
  return {
    appendEvent: vi.fn().mockResolvedValue({ ok: true, event_id: FAKE_UUID, message: "ok" }),
    close: vi.fn(),
    evaluatePolicy: vi.fn(),
    allocateTask: vi.fn(),
    planRoute: vi.fn(),
    heartbeat: vi.fn(),
    replay: vi.fn(),
    ...overrides,
  } as unknown as SidecarClient;
}

describe("V2EventService", () => {
  let sidecar: SidecarClient;
  let svc: V2EventService;

  beforeEach(() => {
    vi.clearAllMocks();
    sidecar = makeSidecar();
    svc = new V2EventService(sidecar);
  });

  // ── appendEvent ─────────────────────────────────────────────────────

  describe("appendEvent", () => {
    const baseInput = {
      type: "task.started",
      aggregateId: "ticket-1",
      actor: "agent-1",
      payload: { foo: "bar" },
    };

    it("generates unique event ID", async () => {
      await svc.appendEvent(baseInput);

      const call = (sidecar.appendEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.event_id).toBe(FAKE_UUID);
    });

    it("generates timestamp", async () => {
      const before = new Date().toISOString();
      await svc.appendEvent(baseInput);
      const after = new Date().toISOString();

      const call = (sidecar.appendEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.timestamp).toBeDefined();
      expect(call.timestamp >= before).toBe(true);
      expect(call.timestamp <= after).toBe(true);
    });

    it("calls sidecar appendEvent with correct payload", async () => {
      await svc.appendEvent(baseInput);

      expect(sidecar.appendEvent).toHaveBeenCalledWith({
        event_id: FAKE_UUID,
        aggregate_id: "ticket-1",
        causation_id: "",
        correlation_id: FAKE_UUID,
        actor: "agent-1",
        timestamp: expect.any(String),
        type: "task.started",
        payload_json: JSON.stringify({ foo: "bar" }),
        schema_version: 1,
      });
    });

    it("publishes to event bus on global channel", async () => {
      await svc.appendEvent(baseInput);

      expect(publishEvent).toHaveBeenCalledWith(
        "global",
        "v2.event",
        expect.objectContaining({
          event_id: FAKE_UUID,
          aggregate_id: "ticket-1",
          actor: "agent-1",
          payload: { foo: "bar" },
        }),
      );
    });

    it("includes event type in bus publication", async () => {
      await svc.appendEvent(baseInput);

      const publishCall = (publishEvent as ReturnType<typeof vi.fn>).mock.calls[0];
      expect(publishCall[2].type).toBe("task.started");
    });

    it("propagates correlation ID if provided", async () => {
      await svc.appendEvent({ ...baseInput, correlationId: "corr-123" });

      const call = (sidecar.appendEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.correlation_id).toBe("corr-123");
    });

    it("propagates causation ID if provided", async () => {
      await svc.appendEvent({ ...baseInput, causationId: "cause-456" });

      const call = (sidecar.appendEvent as ReturnType<typeof vi.fn>).mock.calls[0][0];
      expect(call.causation_id).toBe("cause-456");
    });

    it("propagates sidecar errors", async () => {
      const errorSidecar = makeSidecar({
        appendEvent: vi.fn().mockRejectedValue(new Error("gRPC unavailable")),
      });
      const errorSvc = new V2EventService(errorSidecar);

      await expect(errorSvc.appendEvent(baseInput)).rejects.toThrow("gRPC unavailable");
    });

    it("returns the sidecar ack containing the event ID", async () => {
      const result = await svc.appendEvent(baseInput);

      expect(result).toEqual({ ok: true, event_id: FAKE_UUID, message: "ok" });
    });
  });
});
