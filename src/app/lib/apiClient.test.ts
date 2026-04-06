import { beforeEach, describe, expect, it, vi } from "vitest";
import * as apiClient from "./apiClient";

// Mock the desktopBridge module
const mockDesktopBridge = {
  apiRequest: vi.fn(),
  openStream: vi.fn(),
  onStreamEvent: vi.fn(),
  closeStream: vi.fn(),
};

vi.mock("./desktopBridge", () => ({
  getDesktopBridge: vi.fn(() => mockDesktopBridge),
}));

// Import getDesktopBridge after mocking
import { getDesktopBridge } from "./desktopBridge";

describe("apiClient", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("apiRequest with desktop bridge", () => {
    it("uses desktop bridge when available", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { items: [{ id: "1" }] },
      });

      const result = await apiClient.apiRequest<{ items: Array<{ id: string }> }>("/api/v1/test");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: undefined,
        path: "/api/v1/test",
        body: undefined,
        headers: undefined,
      });
      expect(result).toEqual({ items: [{ id: "1" }] });
    });

    it("sends POST request with JSON body via desktop bridge", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 201,
        body: { ok: true, item: { id: "new-1" } },
      });

      const result = await apiClient.apiRequest<{ ok: boolean; item: { id: string } }>("/api/v1/test", {
        method: "POST",
        body: JSON.stringify({ name: "Test" }),
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/test",
        body: { name: "Test" },
        headers: undefined,
      });
      expect(result).toEqual({ ok: true, item: { id: "new-1" } });
    });

    it("handles 204 No Content via desktop bridge", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 204,
      });

      const result = await apiClient.apiRequest("/api/v1/test", { method: "DELETE" });

      expect(result).toBeUndefined();
    });

    it("throws error on non-ok desktop bridge response with error body", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: false,
        status: 400,
        body: { error: "Validation failed" },
      });

      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow("Validation failed");
    });

    it("throws error on non-ok desktop bridge response with text", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: false,
        status: 500,
        text: "Internal server error",
      });

      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow("Internal server error");
    });

    it("throws generic error when no error details available", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: false,
        status: 404,
      });

      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow("API request failed with 404");
    });

    it("appends query parameters to path", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { items: [] },
      });

      await apiClient.getMissionSnapshotV8({ projectId: "proj-1", ticketId: "ticket-1" });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api/v8/mission/snapshot?projectId=proj-1&ticketId=ticket-1",
        })
      );
    });
  });

  describe("apiRequest with fetch", () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // Disable desktop bridge for browser tests
      vi.mocked(getDesktopBridge).mockReturnValue(undefined);

      // Mock global fetch
      mockFetch = vi.fn();
      globalThis.fetch = mockFetch;

      // Set required env var
      import.meta.env.VITE_API_TOKEN = "test-token";
      import.meta.env.VITE_API_BASE_URL = "http://localhost:8787";
    });

    it("uses fetch when desktop bridge is not available", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ items: [{ id: "1" }] }),
      });

      const result = await apiClient.apiRequest<{ items: Array<{ id: string }> }>("/api/v1/test");

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8787/api/v1/test",
        expect.objectContaining({
          headers: expect.objectContaining({
            "content-type": "application/json",
            "x-local-api-token": "test-token",
          }),
        })
      );
      expect(result).toEqual({ items: [{ id: "1" }] });
    });

    it("includes Content-Type header in fetch requests", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });

      await apiClient.apiRequest("/api/v1/test", {
        method: "POST",
        body: JSON.stringify({ data: "test" }),
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8787/api/v1/test",
        expect.objectContaining({
          method: "POST",
          body: JSON.stringify({ data: "test" }),
          headers: expect.objectContaining({
            "content-type": "application/json",
          }),
        })
      );
    });

    it("sends body as-is for POST requests", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => ({ ok: true }),
      });

      const body = JSON.stringify({ name: "Test", value: 42 });
      await apiClient.apiRequest("/api/v1/test", {
        method: "POST",
        body,
      });

      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8787/api/v1/test",
        expect.objectContaining({
          method: "POST",
          body,
        })
      );
    });

    it("throws on non-ok fetch response", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 400,
        text: async () => "Bad request error",
      });

      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow("Bad request error");
    });

    it("returns parsed JSON from response", async () => {
      const responseData = { items: [{ id: "1", name: "Item 1" }] };
      mockFetch.mockResolvedValue({
        ok: true,
        status: 200,
        json: async () => responseData,
      });

      const result = await apiClient.apiRequest("/api/v1/test");

      expect(result).toEqual(responseData);
    });

    it("handles 204 No Content in fetch mode", async () => {
      mockFetch.mockResolvedValue({
        ok: true,
        status: 204,
        json: async () => ({}),
      });

      const result = await apiClient.apiRequest("/api/v1/test", { method: "DELETE" });

      expect(result).toBeUndefined();
    });

    it("throws when VITE_API_TOKEN is missing", async () => {
      import.meta.env.VITE_API_TOKEN = "";

      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow(
        "VITE_API_TOKEN is required when running the web preview outside Electron."
      );
    });
  });

  describe("Plan API functions", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { item: {} },
      });
    });

    it("approveAgenticRunPlan sends POST to correct path", async () => {
      await apiClient.approveAgenticRunPlan("run-123");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/agentic/runs/run-123/plan/approve",
        body: undefined,
        headers: undefined,
      });
    });

    it("rejectAgenticRunPlan sends POST with reason in body", async () => {
      await apiClient.rejectAgenticRunPlan("run-123", "Not safe");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/agentic/runs/run-123/plan/reject",
        body: { reason: "Not safe" },
        headers: undefined,
      });
    });

    it("refineAgenticRunPlan sends POST with feedback in body", async () => {
      await apiClient.refineAgenticRunPlan("run-123", "Add more tests");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/agentic/runs/run-123/plan/refine",
        body: { feedback: "Add more tests" },
        headers: undefined,
      });
    });

    it("answerAgenticRunPlanQuestion sends POST with questionId and answer", async () => {
      await apiClient.answerAgenticRunPlanQuestion("run-123", "q-1", "Yes, proceed");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/agentic/runs/run-123/plan/answer",
        body: { questionId: "q-1", answer: "Yes, proceed" },
        headers: undefined,
      });
    });
  });

  describe("Agentic run APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { runId: "run-123" },
      });
    });

    it("startAgenticRun sends POST with correct body structure", async () => {
      await apiClient.startAgenticRun({
        actor: "user",
        project_id: "proj-1",
        objective: "Build feature X",
        max_iterations: 10,
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/agentic/start",
        body: {
          actor: "user",
          project_id: "proj-1",
          objective: "Build feature X",
          max_iterations: 10,
        },
        headers: undefined,
      });
    });

    it("startAgenticRun includes coordinator options when provided", async () => {
      await apiClient.startAgenticRun({
        actor: "user",
        project_id: "proj-1",
        objective: "Build feature X",
        coordinator: true,
        coordinator_options: {
          max_agents: 5,
          max_concurrent: 2,
          allow_respawn: true,
          conflict_resolution: "merge",
        },
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/agentic/start",
        body: {
          actor: "user",
          project_id: "proj-1",
          objective: "Build feature X",
          coordinator: true,
          coordinator_options: {
            max_agents: 5,
            max_concurrent: 2,
            allow_respawn: true,
            conflict_resolution: "merge",
          },
        },
        headers: undefined,
      });
    });

    it("resumeAgenticRun sends POST to correct path", async () => {
      await apiClient.resumeAgenticRun("run-123");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/agentic/runs/run-123/resume",
        body: undefined,
        headers: undefined,
      });
    });

    it("getAgenticRunPlan sends GET to correct path", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { item: { id: "plan-1" } },
      });

      await apiClient.getAgenticRunPlan("run-123");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: undefined,
        path: "/api/agentic/runs/run-123/plan",
        body: undefined,
        headers: undefined,
      });
    });
  });

  describe("Settings/Config APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
    });

    it("getContextCompactionConfig sends GET to correct path", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          thresholds: { summarize: 70, compress: 80, dropFiles: 85, merge: 90, emergency: 99 },
          microcompact: { enabled: true, cacheWindowSize: 10, minAgeForRemoval: 5 },
          snipCompact: { protectedTailTurns: 3, minPressureThreshold: 0.7 },
        },
      });

      const result = await apiClient.getContextCompactionConfig();

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: undefined,
        path: "/api/settings/context-compaction",
        body: undefined,
        headers: undefined,
      });
      expect(result.thresholds.summarize).toBe(70);
    });

    it("updateContextCompactionConfig sends PATCH with body", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { ok: true },
      });

      const config = {
        thresholds: { summarize: 75 },
        microcompact: { enabled: false },
      };

      await apiClient.updateContextCompactionConfig(config);

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "PATCH",
        path: "/api/settings/context-compaction",
        body: config,
        headers: undefined,
      });
    });

    it("getPrivacyConfig sends GET to correct path", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          redactionEnabled: true,
          patterns: [{ type: "email", label: "Email", enabled: true }],
          stats: { totalRedactions: 42, byType: { email: 42 } },
        },
      });

      const result = await apiClient.getPrivacyConfig();

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: undefined,
        path: "/api/settings/privacy",
        body: undefined,
        headers: undefined,
      });
      expect(result.redactionEnabled).toBe(true);
    });

    it("listSecrets sends GET to correct path", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          items: [
            { name: "API_KEY", source: "stored", updatedAt: "2024-01-01T00:00:00Z" },
            { name: "DB_PASSWORD", source: "env", updatedAt: null },
          ],
        },
      });

      const result = await apiClient.listSecrets();

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: undefined,
        path: "/api/settings/secrets",
        body: undefined,
        headers: undefined,
      });
      expect(result.items).toHaveLength(2);
      expect(result.items[0]?.name).toBe("API_KEY");
    });

    it("addSecret sends POST with name and value", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { ok: true },
      });

      await apiClient.addSecret("NEW_SECRET", "secret-value");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/settings/secrets",
        body: { name: "NEW_SECRET", value: "secret-value" },
        headers: undefined,
      });
    });

    it("deleteSecret sends DELETE to correct path", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { ok: true },
      });

      await apiClient.deleteSecret("OLD_SECRET");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "DELETE",
        path: "/api/settings/secrets/OLD_SECRET",
        body: undefined,
        headers: undefined,
      });
    });
  });

  describe("Provider APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: {},
      });
    });

    it("listProviders sends GET request", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { activeProvider: "qwen-cli", providers: [] },
      });

      await apiClient.listProviders();

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: undefined,
        path: "/api/v1/providers",
        body: undefined,
        headers: undefined,
      });
    });

    it("setActiveProvider sends POST with providerId", async () => {
      await apiClient.setActiveProvider("openai-compatible");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/providers/active",
        body: { providerId: "openai-compatible" },
        headers: undefined,
      });
    });
  });

  describe("Error handling", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
    });

    it("handles network errors gracefully in desktop mode", async () => {
      mockDesktopBridge.apiRequest.mockRejectedValue(new Error("Network failure"));

      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow("Network failure");
    });

    it("parses error body when available", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: false,
        status: 422,
        body: { error: "Invalid input parameters" },
      });

      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow("Invalid input parameters");
    });

    it("handles error without body gracefully", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: false,
        status: 503,
      });

      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow("API request failed with 503");
    });
  });

  describe("Query parameter handling", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { items: [] },
      });
    });

    it("appends query parameters correctly", async () => {
      await apiClient.getMissionSnapshotV8({
        projectId: "proj-1",
        ticketId: "ticket-1",
        runId: "run-1",
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining("projectId=proj-1"),
        })
      );
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining("ticketId=ticket-1"),
        })
      );
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: expect.stringContaining("runId=run-1"),
        })
      );
    });

    it("omits undefined and null query parameters", async () => {
      await apiClient.getMissionSnapshotV8({
        projectId: "proj-1",
        ticketId: undefined,
        runId: null,
      });

      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("projectId=proj-1");
      expect(callPath).not.toContain("ticketId");
      expect(callPath).not.toContain("runId");
    });

    it("handles boolean query parameters", async () => {
      await apiClient.listHooks({ projectId: "proj-1", enabled: true });

      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("enabled=true");
    });

    it("handles number query parameters", async () => {
      await apiClient.listRecentCommandsV2(50);

      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("limit=50");
    });
  });

  describe("Mission Control APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { item: {} },
      });
    });

    it("getMissionCodebaseTreeV8 sends request with projectId", async () => {
      await apiClient.getMissionCodebaseTreeV8("proj-1");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api/v8/mission/codebase/tree?projectId=proj-1",
        })
      );
    });

    it("getMissionCodeFileV8 sends request with projectId and path", async () => {
      await apiClient.getMissionCodeFileV8("proj-1", "src/index.ts");

      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("projectId=proj-1");
      expect(callPath).toContain("path=src%2Findex.ts");
    });

    it("decideMissionApprovalV8 sends POST with decision", async () => {
      await apiClient.decideMissionApprovalV8({
        approval_id: "approval-1",
        decision: "approved",
        reason: "Looks good",
        decided_by: "user",
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/mission/approval/decide",
        body: {
          approval_id: "approval-1",
          decision: "approved",
          reason: "Looks good",
          decided_by: "user",
        },
        headers: undefined,
      });
    });
  });

  describe("Ticket/Board APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { items: [] },
      });
    });

    it("createTicket sends POST with input", async () => {
      await apiClient.createTicket({
        title: "New ticket",
        repoId: "repo-1",
        description: "Description",
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/tickets",
        body: {
          title: "New ticket",
          repoId: "repo-1",
          description: "Description",
        },
        headers: undefined,
      });
    });

    it("updateTicket sends PATCH with patch data", async () => {
      await apiClient.updateTicket("ticket-1", {
        status: "in_progress",
        assignedTo: "user-1",
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "PATCH",
        path: "/api/v1/tickets/ticket-1",
        body: {
          status: "in_progress",
          assignedTo: "user-1",
        },
        headers: undefined,
      });
    });

    it("moveTicket sends POST with status", async () => {
      await apiClient.moveTicket("ticket-1", "completed");

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/tickets/ticket-1/move",
        body: { status: "completed" },
        headers: undefined,
      });
    });
  });

  describe("V2 Command APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { command_id: "cmd-1" },
      });
    });

    it("intakeTaskV2 sends POST with strategy and actor", async () => {
      await apiClient.intakeTaskV2({
        strategy: "weighted-random-next",
        actor: "agent-1",
        seed: "seed-123",
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/task.intake",
        body: {
          strategy: "weighted-random-next",
          actor: "agent-1",
          seed: "seed-123",
        },
        headers: undefined,
      });
    });

    it("transitionTaskV2 sends POST with ticket_id and status", async () => {
      await apiClient.transitionTaskV2({
        ticket_id: "ticket-1",
        actor: "agent-1",
        status: "in_progress",
        risk_level: "low",
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/task.transition",
        body: {
          ticket_id: "ticket-1",
          actor: "agent-1",
          status: "in_progress",
          risk_level: "low",
        },
        headers: undefined,
      });
    });

    it("policyDecideV2 sends POST with action_type and actor", async () => {
      await apiClient.policyDecideV2({
        action_type: "file.write",
        actor: "agent-1",
        risk_level: "medium",
        dry_run: true,
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/policy.decide",
        body: {
          action_type: "file.write",
          actor: "agent-1",
          risk_level: "medium",
          dry_run: true,
        },
        headers: undefined,
      });
    });
  });

  describe("Skills and Hooks APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { items: [] },
      });
    });

    it("listSkills sends GET with optional filters", async () => {
      await apiClient.listSkills({ tags: "automation", builtIn: true });

      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("tags=automation");
      expect(callPath).toContain("builtIn=true");
    });

    it("createSkill sends POST with skill data", async () => {
      await apiClient.createSkill({
        name: "New Skill",
        description: "A test skill",
        triggerPattern: "test",
        implementation: "console.log('test')",
        tags: ["test"],
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/skills",
        body: {
          name: "New Skill",
          description: "A test skill",
          triggerPattern: "test",
          implementation: "console.log('test')",
          tags: ["test"],
        },
        headers: { "content-type": "application/json" },
      });
    });

    it("listHooks sends GET with optional filters", async () => {
      await apiClient.listHooks({
        projectId: "proj-1",
        eventType: "PreToolUse",
        enabled: true,
      });

      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("projectId=proj-1");
      expect(callPath).toContain("eventType=PreToolUse");
      expect(callPath).toContain("enabled=true");
    });

    it("testHook sends POST with testPayload", async () => {
      await apiClient.testHook("hook-1", { tool_name: "bash" });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/hooks/hook-1/test",
        body: { testPayload: { tool_name: "bash" } },
        headers: { "content-type": "application/json" },
      });
    });
  });

  describe("Project and Repo APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { items: [] },
      });
    });

    it("connectLocalProjectV8 sends POST with source_path", async () => {
      await apiClient.connectLocalProjectV8({
        actor: "user",
        source_path: "/path/to/project",
        display_name: "My Project",
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/projects/connect/local",
        body: {
          actor: "user",
          source_path: "/path/to/project",
          display_name: "My Project",
        },
        headers: undefined,
      });
    });

    it("bootstrapEmptyProjectV8 sends POST with folder details", async () => {
      await apiClient.bootstrapEmptyProjectV8({
        actor: "user",
        folderPath: "/empty/folder",
        displayName: "New Project",
        starterId: "react-ts",
        initializeGit: true,
      });

      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/projects/bootstrap/empty",
        body: {
          actor: "user",
          folderPath: "/empty/folder",
          displayName: "New Project",
          starterId: "react-ts",
          initializeGit: true,
        },
        headers: undefined,
      });
    });
  });
});
