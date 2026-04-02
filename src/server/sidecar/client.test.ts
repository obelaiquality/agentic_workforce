import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";

// Mock gRPC modules
const mockClose = vi.fn();
const mockAppendEvent = vi.fn();
const mockEvaluatePolicy = vi.fn();
const mockAllocateTask = vi.fn();
const mockPlanRoute = vi.fn();
const mockHeartbeat = vi.fn();
const mockReplay = vi.fn();

const mockClient = {
  close: mockClose,
  appendEvent: mockAppendEvent,
  evaluatePolicy: mockEvaluatePolicy,
  allocateTask: mockAllocateTask,
  planRoute: mockPlanRoute,
  heartbeat: mockHeartbeat,
  replay: mockReplay,
};

// Use a function so it's available during module load
const mockServiceClientConstructor = vi.fn(() => mockClient);

vi.mock("@grpc/grpc-js", () => {
  return {
    credentials: {
      createInsecure: vi.fn(),
    },
    loadPackageDefinition: vi.fn(() => ({
      agentic: {
        v1: {
          ControlPlane: vi.fn(() => mockClient),
        },
      },
    })),
  };
});

vi.mock("@grpc/proto-loader", () => ({
  loadSync: vi.fn(() => ({})),
}));

// Import after mocking
const { SidecarClient } = await import("./client");

describe("SidecarClient", () => {
  let client: SidecarClient;

  beforeEach(() => {
    vi.clearAllMocks();
    client = new SidecarClient("127.0.0.1:50051");
  });

  afterEach(() => {
    client.close();
  });

  describe("constructor", () => {
    it("creates a client with the given address", () => {
      // Client is created - we can verify it exists
      expect(client).toBeDefined();
    });
  });

  describe("close", () => {
    it("closes the underlying gRPC client", () => {
      client.close();
      expect(mockClose).toHaveBeenCalled();
    });
  });

  describe("appendEvent", () => {
    it("appends an event with all required fields", async () => {
      const mockResponse = { ok: true, event_id: "evt-123", message: "Event appended" };
      mockAppendEvent.mockImplementation((req: any, callback: any) => {
        callback(null, mockResponse);
      });

      const result = await client.appendEvent({
        aggregate_id: "agg-1",
        actor: "test-actor",
        timestamp: "2026-04-01T12:00:00Z",
        type: "task.created",
        payload_json: '{"key":"value"}',
      });

      expect(result).toEqual(mockResponse);
      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          aggregate_id: "agg-1",
          actor: "test-actor",
          timestamp: "2026-04-01T12:00:00Z",
          type: "task.created",
          payload_json: '{"key":"value"}',
          schema_version: 1,
        }),
        expect.any(Function)
      );
    });

    it("uses optional fields when provided", async () => {
      const mockResponse = { ok: true, event_id: "evt-456", message: "Event appended" };
      mockAppendEvent.mockImplementation((req: any, callback: any) => {
        callback(null, mockResponse);
      });

      await client.appendEvent({
        event_id: "evt-456",
        aggregate_id: "agg-2",
        causation_id: "cause-1",
        correlation_id: "corr-1",
        actor: "test-actor",
        timestamp: "2026-04-01T12:00:00Z",
        type: "task.updated",
        payload_json: "{}",
        schema_version: 2,
      });

      expect(mockAppendEvent).toHaveBeenCalledWith(
        expect.objectContaining({
          event_id: "evt-456",
          causation_id: "cause-1",
          correlation_id: "corr-1",
          schema_version: 2,
        }),
        expect.any(Function)
      );
    });

    it("rejects when gRPC returns an error", async () => {
      const mockError = new Error("gRPC error");
      mockAppendEvent.mockImplementation((req: any, callback: any) => {
        callback(mockError, null);
      });

      await expect(
        client.appendEvent({
          aggregate_id: "agg-1",
          actor: "test-actor",
          timestamp: "2026-04-01T12:00:00Z",
          type: "task.failed",
          payload_json: "{}",
        })
      ).rejects.toThrow("gRPC error");
    });
  });

  describe("evaluatePolicy", () => {
    it("evaluates a policy decision", async () => {
      const mockResponse = {
        decision: "allow" as const,
        requires_approval: false,
        reasons: ["Low risk action"],
        required_scopes: ["read"],
        policy_version: "1.0",
      };
      mockEvaluatePolicy.mockImplementation((req: any, callback: any) => {
        callback(null, mockResponse);
      });

      const result = await client.evaluatePolicy({
        action_type: "file.read",
        actor: "agent-1",
        risk_level: "low",
        workspace_path: "/workspace",
        payload_json: "{}",
      });

      expect(result).toEqual(mockResponse);
      expect(mockEvaluatePolicy).toHaveBeenCalledWith(
        expect.objectContaining({
          action_type: "file.read",
          actor: "agent-1",
          risk_level: "low",
          workspace_path: "/workspace",
          payload_json: "{}",
          dry_run: false,
        }),
        expect.any(Function)
      );
    });

    it("passes dry_run flag when provided", async () => {
      const mockResponse = {
        decision: "deny" as const,
        requires_approval: true,
        reasons: ["High risk"],
        required_scopes: ["write"],
        policy_version: "1.0",
      };
      mockEvaluatePolicy.mockImplementation((req: any, callback: any) => {
        callback(null, mockResponse);
      });

      await client.evaluatePolicy({
        action_type: "file.write",
        actor: "agent-2",
        risk_level: "high",
        workspace_path: "/workspace",
        payload_json: "{}",
        dry_run: true,
      });

      expect(mockEvaluatePolicy).toHaveBeenCalledWith(
        expect.objectContaining({ dry_run: true }),
        expect.any(Function)
      );
    });

    it("rejects on gRPC error", async () => {
      const mockError = new Error("Policy evaluation failed");
      mockEvaluatePolicy.mockImplementation((req: any, callback: any) => {
        callback(mockError, null);
      });

      await expect(
        client.evaluatePolicy({
          action_type: "file.delete",
          actor: "agent-3",
          risk_level: "high",
          workspace_path: "/workspace",
          payload_json: "{}",
        })
      ).rejects.toThrow("Policy evaluation failed");
    });
  });

  describe("allocateTask", () => {
    it("allocates a task with default values", async () => {
      const mockResponse = {
        found: true,
        ticket_id: "ticket-123",
        strategy: "round-robin",
        score: 0.9,
        reservation_expires_at: "2026-04-01T13:00:00Z",
        message: "Task allocated",
      };
      mockAllocateTask.mockImplementation((req: any, callback: any) => {
        callback(null, mockResponse);
      });

      const result = await client.allocateTask({
        strategy: "round-robin",
        actor: "agent-1",
      });

      expect(result).toEqual(mockResponse);
      expect(mockAllocateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          strategy: "round-robin",
          seed: "",
          actor: "agent-1",
          reservation_ttl_seconds: 0,
        }),
        expect.any(Function)
      );
    });

    it("allocates a task with optional parameters", async () => {
      const mockResponse = {
        found: false,
        ticket_id: "",
        strategy: "priority",
        score: 0,
        reservation_expires_at: "",
        message: "No tasks available",
      };
      mockAllocateTask.mockImplementation((req: any, callback: any) => {
        callback(null, mockResponse);
      });

      await client.allocateTask({
        strategy: "priority",
        seed: "seed-abc",
        actor: "agent-2",
        reservation_ttl_seconds: 300,
      });

      expect(mockAllocateTask).toHaveBeenCalledWith(
        expect.objectContaining({
          seed: "seed-abc",
          reservation_ttl_seconds: 300,
        }),
        expect.any(Function)
      );
    });

    it("rejects on gRPC error", async () => {
      const mockError = new Error("Allocation failed");
      mockAllocateTask.mockImplementation((req: any, callback: any) => {
        callback(mockError, null);
      });

      await expect(
        client.allocateTask({
          strategy: "fifo",
          actor: "agent-3",
        })
      ).rejects.toThrow("Allocation failed");
    });
  });

  describe("planRoute", () => {
    it("plans a route with required fields", async () => {
      const mockResponse = {
        execution_mode: "single_agent" as const,
        model_role: "coder_default" as const,
        provider_id: "qwen-cli" as const,
        max_lanes: 1,
        risk: "low" as const,
        verification_depth: "standard" as const,
        decomposition_score: 0.3,
        estimated_file_overlap: 0.1,
        rationale: ["Simple task", "Low complexity"],
      };
      mockPlanRoute.mockImplementation((req: any, callback: any) => {
        callback(null, mockResponse);
      });

      const result = await client.planRoute({
        actor: "agent-1",
        prompt: "Fix the bug in auth.ts",
        risk_level: "low",
        workspace_path: "/workspace",
      });

      expect(result).toEqual(mockResponse);
      expect(mockPlanRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: "",
          run_id: "",
          actor: "agent-1",
          prompt: "Fix the bug in auth.ts",
          risk_level: "low",
          workspace_path: "/workspace",
          retrieval_context_count: 0,
          active_files_count: 0,
        }),
        expect.any(Function)
      );
    });

    it("plans a route with optional fields", async () => {
      const mockResponse = {
        execution_mode: "centralized_parallel" as const,
        model_role: "review_deep" as const,
        provider_id: "openai-compatible" as const,
        max_lanes: 4,
        risk: "high" as const,
        verification_depth: "deep" as const,
        decomposition_score: 0.8,
        estimated_file_overlap: 0.4,
        rationale: ["Complex refactor", "High file overlap"],
      };
      mockPlanRoute.mockImplementation((req: any, callback: any) => {
        callback(null, mockResponse);
      });

      await client.planRoute({
        ticket_id: "ticket-456",
        run_id: "run-789",
        actor: "agent-2",
        prompt: "Refactor the entire auth module",
        risk_level: "high",
        workspace_path: "/workspace",
        retrieval_context_count: 10,
        active_files_count: 5,
      });

      expect(mockPlanRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          ticket_id: "ticket-456",
          run_id: "run-789",
          retrieval_context_count: 10,
          active_files_count: 5,
        }),
        expect.any(Function)
      );
    });

    it("rejects on gRPC error", async () => {
      const mockError = new Error("Routing failed");
      mockPlanRoute.mockImplementation((req: any, callback: any) => {
        callback(mockError, null);
      });

      await expect(
        client.planRoute({
          actor: "agent-3",
          prompt: "Test prompt",
          risk_level: "medium",
          workspace_path: "/workspace",
        })
      ).rejects.toThrow("Routing failed");
    });
  });

  describe("heartbeat", () => {
    it("sends a heartbeat with required fields", async () => {
      const mockResponse = { ok: true, message: "Heartbeat received" };
      mockHeartbeat.mockImplementation((req: any, callback: any) => {
        callback(null, mockResponse);
      });

      const result = await client.heartbeat({
        agent_id: "agent-1",
        status: "active",
      });

      expect(result).toEqual(mockResponse);
      expect(mockHeartbeat).toHaveBeenCalledWith(
        expect.objectContaining({
          agent_id: "agent-1",
          status: "active",
          summary: "",
          metadata_json: "{}",
        }),
        expect.any(Function)
      );
    });

    it("sends a heartbeat with optional fields", async () => {
      const mockResponse = { ok: true, message: "Heartbeat received" };
      mockHeartbeat.mockImplementation((req: any, callback: any) => {
        callback(null, mockResponse);
      });

      await client.heartbeat({
        agent_id: "agent-2",
        status: "idle",
        summary: "Waiting for tasks",
        metadata_json: '{"cpu":0.1,"memory":512}',
      });

      expect(mockHeartbeat).toHaveBeenCalledWith(
        expect.objectContaining({
          summary: "Waiting for tasks",
          metadata_json: '{"cpu":0.1,"memory":512}',
        }),
        expect.any(Function)
      );
    });

    it("rejects on gRPC error", async () => {
      const mockError = new Error("Heartbeat failed");
      mockHeartbeat.mockImplementation((req: any, callback: any) => {
        callback(mockError, null);
      });

      await expect(
        client.heartbeat({
          agent_id: "agent-3",
          status: "error",
        })
      ).rejects.toThrow("Heartbeat failed");
    });
  });

  describe("replay", () => {
    it("streams events and resolves with array", async () => {
      const mockEvents = [
        {
          event_id: "evt-1",
          aggregate_id: "agg-1",
          causation_id: "",
          correlation_id: "",
          actor: "agent-1",
          timestamp: "2026-04-01T10:00:00Z",
          type: "task.created",
          payload_json: "{}",
          schema_version: 1,
        },
        {
          event_id: "evt-2",
          aggregate_id: "agg-1",
          causation_id: "evt-1",
          correlation_id: "",
          actor: "agent-1",
          timestamp: "2026-04-01T10:05:00Z",
          type: "task.completed",
          payload_json: "{}",
          schema_version: 1,
        },
      ];

      const mockStream = {
        on: vi.fn((event: string, handler: any) => {
          if (event === "data") {
            mockEvents.forEach((evt) => handler(evt));
          } else if (event === "end") {
            handler();
          }
          return mockStream;
        }),
      };

      mockReplay.mockReturnValue(mockStream);

      const result = await client.replay({
        aggregate_id: "agg-1",
      });

      expect(result).toEqual(mockEvents);
      expect(mockReplay).toHaveBeenCalledWith({
        aggregate_id: "agg-1",
        from_timestamp: "",
        to_timestamp: "",
        limit: 500,
      });
    });

    it("uses optional parameters", async () => {
      const mockStream = {
        on: vi.fn((event: string, handler: any) => {
          if (event === "end") {
            handler();
          }
          return mockStream;
        }),
      };

      mockReplay.mockReturnValue(mockStream);

      await client.replay({
        aggregate_id: "agg-2",
        from_timestamp: "2026-04-01T00:00:00Z",
        to_timestamp: "2026-04-01T23:59:59Z",
        limit: 100,
      });

      expect(mockReplay).toHaveBeenCalledWith({
        aggregate_id: "agg-2",
        from_timestamp: "2026-04-01T00:00:00Z",
        to_timestamp: "2026-04-01T23:59:59Z",
        limit: 100,
      });
    });

    it("rejects on stream error", async () => {
      const mockError = new Error("Stream error");
      const mockStream = {
        on: vi.fn((event: string, handler: any) => {
          if (event === "error") {
            handler(mockError);
          }
          return mockStream;
        }),
      };

      mockReplay.mockReturnValue(mockStream);

      await expect(
        client.replay({
          aggregate_id: "agg-3",
        })
      ).rejects.toThrow("Stream error");
    });

    it("defaults to empty string for optional fields", async () => {
      const mockStream = {
        on: vi.fn((event: string, handler: any) => {
          if (event === "end") {
            handler();
          }
          return mockStream;
        }),
      };

      mockReplay.mockReturnValue(mockStream);

      await client.replay({});

      expect(mockReplay).toHaveBeenCalledWith({
        aggregate_id: "",
        from_timestamp: "",
        to_timestamp: "",
        limit: 500,
      });
    });
  });
});
