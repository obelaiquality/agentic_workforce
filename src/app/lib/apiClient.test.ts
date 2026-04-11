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

  describe("apiRequestText", () => {
    it("returns string result via desktop bridge", async () => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: "plain text response",
      });

      const result = await apiClient.apiRequestText("/api/v1/test");
      expect(result).toBe("plain text response");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          method: "GET",
          path: "/api/v1/test",
          headers: { accept: "text/plain" },
        })
      );
    });

    it("JSON-stringifies non-string desktop bridge result", async () => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: { foo: "bar" },
      });

      const result = await apiClient.apiRequestText("/api/v1/test");
      expect(result).toBe('{"foo":"bar"}');
    });

    it("falls back to fetch when desktop bridge is unavailable", async () => {
      vi.mocked(getDesktopBridge).mockReturnValue(undefined);
      import.meta.env.VITE_API_TOKEN = "test-token";
      import.meta.env.VITE_API_BASE_URL = "http://localhost:8787";

      const mockFetch = vi.fn().mockResolvedValue({
        text: async () => "fetched text",
      });
      globalThis.fetch = mockFetch;

      const result = await apiClient.apiRequestText("/api/v1/test");
      expect(result).toBe("fetched text");
      expect(mockFetch).toHaveBeenCalledWith(
        "http://localhost:8787/api/v1/test",
        expect.objectContaining({
          headers: expect.objectContaining({ accept: "text/plain" }),
        })
      );
    });
  });

  describe("LocalEventStream and openDesktopEventStream", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
    });

    it("openSessionStream opens a stream and emits events", async () => {
      const unsubscribe = vi.fn();
      mockDesktopBridge.openStream.mockResolvedValue({ streamId: "stream-1" });
      mockDesktopBridge.onStreamEvent.mockImplementation((_streamId: string, cb: (evt: { event: string; data: string }) => void) => {
        // Simulate an event
        setTimeout(() => cb({ event: "message", data: '{"text":"hello"}' }), 10);
        return unsubscribe;
      });

      const stream = await apiClient.openSessionStream("session-1");
      expect(mockDesktopBridge.openStream).toHaveBeenCalledWith({
        path: "/api/v1/chat/sessions/session-1/stream",
        query: undefined,
      });

      const received: string[] = [];
      stream.addEventListener("message", ((e: MessageEvent) => {
        received.push(e.data);
      }) as EventListener);

      await new Promise((r) => setTimeout(r, 50));
      expect(received).toContain('{"text":"hello"}');

      stream.close();
      expect(unsubscribe).toHaveBeenCalled();
      expect(mockDesktopBridge.closeStream).toHaveBeenCalledWith("stream-1");
    });

    it("openDesktopEventStream handles __close__ event", async () => {
      const unsubscribe = vi.fn();
      mockDesktopBridge.openStream.mockResolvedValue({ streamId: "stream-2" });
      mockDesktopBridge.onStreamEvent.mockImplementation((_streamId: string, cb: (evt: { event: string; data: string }) => void) => {
        setTimeout(() => cb({ event: "__close__", data: "" }), 10);
        return unsubscribe;
      });

      const stream = await apiClient.openSessionStream("session-2");
      await new Promise((r) => setTimeout(r, 50));
      // stream should be closed now - further events should not emit
      const received: string[] = [];
      stream.addEventListener("message", ((e: MessageEvent) => {
        received.push(e.data);
      }) as EventListener);
      expect(received).toHaveLength(0);
    });

    it("openDesktopEventStream handles __error__ event", async () => {
      const unsubscribe = vi.fn();
      mockDesktopBridge.openStream.mockResolvedValue({ streamId: "stream-3" });
      mockDesktopBridge.onStreamEvent.mockImplementation((_streamId: string, cb: (evt: { event: string; data: string }) => void) => {
        setTimeout(() => cb({ event: "__error__", data: "Stream error" }), 10);
        return unsubscribe;
      });

      const stream = await apiClient.openSessionStream("session-3");
      const errors: string[] = [];
      stream.addEventListener("error", ((e: MessageEvent) => {
        errors.push(e.data);
      }) as EventListener);

      await new Promise((r) => setTimeout(r, 50));
      expect(errors).toContain("Stream error");
    });

    it("LocalEventStream supports handleEvent listener interface", async () => {
      const unsubscribe = vi.fn();
      mockDesktopBridge.openStream.mockResolvedValue({ streamId: "stream-4" });
      mockDesktopBridge.onStreamEvent.mockImplementation((_streamId: string, cb: (evt: { event: string; data: string }) => void) => {
        setTimeout(() => cb({ event: "message", data: "test-data" }), 10);
        return unsubscribe;
      });

      const stream = await apiClient.openSessionStream("session-4");
      const received: string[] = [];
      const listenerObj = {
        handleEvent(e: Event) {
          received.push((e as MessageEvent).data);
        },
      };
      stream.addEventListener("message", listenerObj);

      await new Promise((r) => setTimeout(r, 50));
      expect(received).toContain("test-data");
      stream.close();
    });

    it("close is idempotent", async () => {
      const unsubscribe = vi.fn();
      mockDesktopBridge.openStream.mockResolvedValue({ streamId: "stream-5" });
      mockDesktopBridge.onStreamEvent.mockReturnValue(unsubscribe);

      const stream = await apiClient.openSessionStream("session-5");
      stream.close();
      stream.close(); // second call should not throw
      expect(unsubscribe).toHaveBeenCalledTimes(1);
    });
  });

  describe("openAgenticRunStream", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
    });

    it("opens a stream for an agentic run", async () => {
      const unsubscribe = vi.fn();
      mockDesktopBridge.openStream.mockResolvedValue({ streamId: "agentic-stream-1" });
      mockDesktopBridge.onStreamEvent.mockReturnValue(unsubscribe);

      const stream = await apiClient.openAgenticRunStream("run-123");
      expect(mockDesktopBridge.openStream).toHaveBeenCalledWith({
        path: "/api/agentic/runs/run-123/stream",
        query: undefined,
      });
      stream.close();
    });
  });

  describe("openEventStreamV2", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
    });

    it("opens the v2 event stream", async () => {
      const unsubscribe = vi.fn();
      mockDesktopBridge.openStream.mockResolvedValue({ streamId: "v2-stream" });
      mockDesktopBridge.onStreamEvent.mockReturnValue(unsubscribe);

      const stream = await apiClient.openEventStreamV2();
      expect(mockDesktopBridge.openStream).toHaveBeenCalledWith({
        path: "/api/v2/stream",
        query: undefined,
      });
      stream.close();
    });
  });

  describe("openMissionConsoleStreamV8", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
    });

    it("opens console stream with projectId", async () => {
      const unsubscribe = vi.fn();
      mockDesktopBridge.openStream.mockResolvedValue({ streamId: "console-stream" });
      mockDesktopBridge.onStreamEvent.mockReturnValue(unsubscribe);

      const stream = await apiClient.openMissionConsoleStreamV8("proj-1");
      expect(mockDesktopBridge.openStream).toHaveBeenCalledWith({
        path: "/api/v8/mission/console/stream",
        query: { projectId: "proj-1" },
      });
      stream.close();
    });

    it("opens console stream without projectId", async () => {
      const unsubscribe = vi.fn();
      mockDesktopBridge.openStream.mockResolvedValue({ streamId: "console-stream-2" });
      mockDesktopBridge.onStreamEvent.mockReturnValue(unsubscribe);

      const stream = await apiClient.openMissionConsoleStreamV8();
      expect(mockDesktopBridge.openStream).toHaveBeenCalledWith({
        path: "/api/v8/mission/console/stream",
        query: undefined,
      });
      stream.close();
    });
  });

  describe("Provider APIs - extended", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: {},
      });
    });

    it("activateProviderV2 sends POST with provider_id and actor", async () => {
      await apiClient.activateProviderV2("openai-compatible", "admin");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/provider.activate",
        body: { provider_id: "openai-compatible", actor: "admin" },
        headers: undefined,
      });
    });

    it("activateProviderV2 defaults actor to user", async () => {
      await apiClient.activateProviderV2("qwen-cli");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          body: { provider_id: "qwen-cli", actor: "user" },
        })
      );
    });

    it("listQwenAccounts sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listQwenAccounts();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/providers/qwen/accounts" }));
    });

    it("listOnPremQwenPlugins sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listOnPremQwenPlugins();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/providers/onprem/plugins" }));
    });

    it("listOnPremInferenceBackends sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listOnPremInferenceBackends();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/providers/onprem/backends" }));
    });

    it("listOnPremRoleRuntimes sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listOnPremRoleRuntimes();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(expect.objectContaining({ path: "/api/v1/providers/onprem/role-runtimes" }));
    });

    it("testOnPremRoleRuntime sends POST", async () => {
      await apiClient.testOnPremRoleRuntime({ actor: "user", role: "coder_default" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/providers/onprem/role-runtimes/test",
        body: { actor: "user", role: "coder_default" },
        headers: undefined,
      });
    });

    it("startOnPremRoleRuntime sends POST", async () => {
      await apiClient.startOnPremRoleRuntime({ actor: "user", role: "utility_fast" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/providers/onprem/role-runtimes/start",
        body: { actor: "user", role: "utility_fast" },
        headers: undefined,
      });
    });

    it("stopOnPremRoleRuntime sends POST", async () => {
      await apiClient.stopOnPremRoleRuntime({ actor: "user", role: "review_deep" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/providers/onprem/role-runtimes/stop",
        body: { actor: "user", role: "review_deep" },
        headers: undefined,
      });
    });

    it("startEnabledOnPremRoleRuntimes sends POST with default actor", async () => {
      await apiClient.startEnabledOnPremRoleRuntimes();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/providers/onprem/role-runtimes/start-enabled",
        body: { actor: "user" },
        headers: undefined,
      });
    });

    it("createQwenAccount sends POST", async () => {
      await apiClient.createQwenAccount({ label: "test", profilePath: "/path" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/providers/qwen/accounts",
        body: { label: "test", profilePath: "/path" },
        headers: undefined,
      });
    });

    it("bootstrapQwenAccount sends POST", async () => {
      await apiClient.bootstrapQwenAccount({ label: "bootstrap" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/providers/qwen/accounts/bootstrap",
        body: { label: "bootstrap" },
        headers: undefined,
      });
    });

    it("updateQwenAccount sends PATCH", async () => {
      await apiClient.updateQwenAccount("acc-1", { label: "updated" } as any);
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "PATCH",
        path: "/api/v1/providers/qwen/accounts/acc-1",
        body: { label: "updated" },
        headers: undefined,
      });
    });

    it("reauthQwenAccount sends POST", async () => {
      await apiClient.reauthQwenAccount("acc-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/providers/qwen/accounts/acc-1/reauth",
        body: {},
        headers: undefined,
      });
    });

    it("startQwenAccountAuth sends POST", async () => {
      await apiClient.startQwenAccountAuth("acc-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/providers/qwen/accounts/acc-1/auth/start",
        body: {},
        headers: undefined,
      });
    });

    it("listQwenAccountAuthSessions sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listQwenAccountAuthSessions();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/providers/qwen/accounts/auth-sessions" })
      );
    });
  });

  describe("Ticket/Board APIs - extended", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
    });

    it("listTickets sends GET without repoId", async () => {
      await apiClient.listTickets();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/tickets" })
      );
    });

    it("listTickets sends GET with repoId", async () => {
      await apiClient.listTickets("repo-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/tickets?repoId=repo-1" })
      );
    });

    it("listTicketComments sends GET", async () => {
      await apiClient.listTicketComments("ticket-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/tickets/ticket-1/comments" })
      );
    });

    it("addTicketComment sends POST", async () => {
      await apiClient.addTicketComment("ticket-1", { body: "A comment", author: "user" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/tickets/ticket-1/comments",
        body: { body: "A comment", author: "user" },
        headers: undefined,
      });
    });

    it("getBoardV2 sends GET without repoId", async () => {
      await apiClient.getBoardV2();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/tasks/board" })
      );
    });

    it("getBoardV2 sends GET with repoId", async () => {
      await apiClient.getBoardV2("repo-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/tasks/board?repoId=repo-1" })
      );
    });

    it("reserveTaskV2 sends POST", async () => {
      await apiClient.reserveTaskV2({ ticket_id: "t-1", actor: "agent-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/task.reserve",
        body: { ticket_id: "t-1", actor: "agent-1" },
        headers: undefined,
      });
    });
  });

  describe("V2 Execution and Inference APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("requestExecutionV2 sends POST", async () => {
      await apiClient.requestExecutionV2({
        ticket_id: "t-1",
        actor: "agent-1",
        prompt: "Write code",
        retrieval_context_ids: ["ctx-1"],
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/execution.request",
        body: {
          ticket_id: "t-1",
          actor: "agent-1",
          prompt: "Write code",
          retrieval_context_ids: ["ctx-1"],
        },
        headers: undefined,
      });
    });

    it("runInferenceAutotuneV2 sends POST", async () => {
      await apiClient.runInferenceAutotuneV2({ actor: "user", profile: "interactive" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/inference.autotune",
        body: { actor: "user", profile: "interactive" },
        headers: undefined,
      });
    });

    it("startInferenceBackendV2 sends POST", async () => {
      await apiClient.startInferenceBackendV2({ actor: "user", backend_id: "mlx-lm" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/inference.backend.start",
        body: { actor: "user", backend_id: "mlx-lm" },
        headers: undefined,
      });
    });

    it("stopInferenceBackendV2 sends POST", async () => {
      await apiClient.stopInferenceBackendV2({ actor: "user", backend_id: "vllm-openai" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/inference.backend.stop",
        body: { actor: "user", backend_id: "vllm-openai" },
        headers: undefined,
      });
    });

    it("switchInferenceBackendV2 sends POST", async () => {
      await apiClient.switchInferenceBackendV2({ actor: "user", backend_id: "sglang" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/inference.backend.switch",
        body: { actor: "user", backend_id: "sglang" },
        headers: undefined,
      });
    });

    it("listInferenceBackendsV2 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listInferenceBackendsV2();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/inference/backends" })
      );
    });

    it("getLatestInferenceBenchmarksV2 sends GET without profile", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getLatestInferenceBenchmarksV2();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/inference/benchmarks/latest" })
      );
    });

    it("getLatestInferenceBenchmarksV2 sends GET with profile", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getLatestInferenceBenchmarksV2("batch");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/inference/benchmarks/latest?profile=batch" })
      );
    });

    it("getInferenceBenchmarkHistoryV2 sends GET with params", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getInferenceBenchmarkHistoryV2({ profile: "interactive", limit: 10 });
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("profile=interactive");
      expect(callPath).toContain("limit=10");
    });

    it("getInferenceBenchmarkHistoryV2 sends GET without params", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getInferenceBenchmarkHistoryV2();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/inference/benchmarks/history" })
      );
    });

    it("listModelPluginsV2 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listModelPluginsV2();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/model/plugins" })
      );
    });

    it("activateModelPluginV2 sends POST", async () => {
      await apiClient.activateModelPluginV2({ actor: "user", plugin_id: "plugin-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/model.plugin.activate",
        body: { actor: "user", plugin_id: "plugin-1" },
        headers: undefined,
      });
    });
  });

  describe("Distillation APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("generateDistillDatasetV2 sends POST", async () => {
      await apiClient.generateDistillDatasetV2({
        actor: "user",
        title: "Dataset 1",
        sample_count: 50,
        retrieval_context_ids: ["ctx-1"],
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/distill.dataset.generate",
        body: { actor: "user", title: "Dataset 1", sample_count: 50, retrieval_context_ids: ["ctx-1"] },
        headers: undefined,
      });
    });

    it("reviewDistillDatasetV2 sends POST", async () => {
      await apiClient.reviewDistillDatasetV2({
        actor: "user",
        dataset_id: "ds-1",
        decisions: [{ example_id: "ex-1", decision: "approved" as any }],
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/distill.dataset.review",
        body: { actor: "user", dataset_id: "ds-1", decisions: [{ example_id: "ex-1", decision: "approved" }] },
        headers: undefined,
      });
    });

    it("startDistillTrainingV2 sends POST", async () => {
      await apiClient.startDistillTrainingV2({
        actor: "user",
        dataset_id: "ds-1",
        stage: "sft",
        student_model_id: "model-1",
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/distill.train.start",
        body: { actor: "user", dataset_id: "ds-1", stage: "sft", student_model_id: "model-1" },
        headers: undefined,
      });
    });

    it("runDistillEvalV2 sends POST", async () => {
      await apiClient.runDistillEvalV2({ actor: "user", run_id: "run-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/distill.eval.run",
        body: { actor: "user", run_id: "run-1" },
        headers: undefined,
      });
    });

    it("promoteDistillModelV2 sends POST", async () => {
      await apiClient.promoteDistillModelV2({ actor: "user", run_id: "run-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v2/commands/distill.model.promote",
        body: { actor: "user", run_id: "run-1" },
        headers: undefined,
      });
    });

    it("getDistillDatasetV2 sends GET", async () => {
      await apiClient.getDistillDatasetV2("ds-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/distill/datasets/ds-1" })
      );
    });

    it("getDistillRunV2 sends GET", async () => {
      await apiClient.getDistillRunV2("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/distill/runs/run-1" })
      );
    });

    it("getDistillRunLogsV2 sends GET", async () => {
      await apiClient.getDistillRunLogsV2("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/distill/runs/run-1/logs" })
      );
    });

    it("getDistillEvalV2 sends GET", async () => {
      await apiClient.getDistillEvalV2("eval-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/distill/evals/eval-1" })
      );
    });

    it("getDistillQuotaV2 sends GET", async () => {
      await apiClient.getDistillQuotaV2();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/distill/quota" })
      );
    });

    it("getDistillReadinessV2 sends GET", async () => {
      await apiClient.getDistillReadinessV2();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/distill/readiness" })
      );
    });

    it("listDistillModelsV2 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listDistillModelsV2();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/distill/models" })
      );
    });
  });

  describe("V2 Query/Policy/Timeline APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
    });

    it("listPendingPolicyV2 sends GET", async () => {
      await apiClient.listPendingPolicyV2();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/policy/pending" })
      );
    });

    it("getTaskTimelineV2 sends GET with ticketId", async () => {
      await apiClient.getTaskTimelineV2("ticket-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/tasks/ticket-1/timeline" })
      );
    });

    it("getRunReplayV2 sends GET with runId", async () => {
      await apiClient.getRunReplayV2("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/runs/run-1/replay" })
      );
    });

    it("searchKnowledgeV2 sends GET with encoded query", async () => {
      await apiClient.searchKnowledgeV2("test query");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v2/knowledge/search?q=test%20query" })
      );
    });
  });

  describe("Approval and Audit APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
    });

    it("listApprovals sends GET", async () => {
      await apiClient.listApprovals();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/approvals" })
      );
    });

    it("decideApproval sends POST with decision", async () => {
      await apiClient.decideApproval("appr-1", "approved", "Looks good");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/approvals/appr-1/decide",
        body: { decision: "approved", reason: "Looks good" },
        headers: undefined,
      });
    });

    it("decideApproval sends POST without reason", async () => {
      await apiClient.decideApproval("appr-1", "rejected");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/approvals/appr-1/decide",
        body: { decision: "rejected" },
        headers: undefined,
      });
    });

    it("listAuditEvents sends GET", async () => {
      await apiClient.listAuditEvents();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/audit/events" })
      );
    });
  });

  describe("Settings APIs - extended", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("getSettings sends GET", async () => {
      await apiClient.getSettings();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/settings" })
      );
    });

    it("updateSettings sends PATCH", async () => {
      await apiClient.updateSettings({ runtimeMode: "local_qwen" } as any);
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "PATCH",
        path: "/api/v1/settings",
        body: { runtimeMode: "local_qwen" },
        headers: undefined,
      });
    });

    it("setRuntimeMode sends POST", async () => {
      await apiClient.setRuntimeMode({ mode: "openai_api", openAiApiKey: "key-123" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/settings/runtime-mode",
        body: { mode: "openai_api", openAiApiKey: "key-123" },
        headers: undefined,
      });
    });

    it("listOpenAiModels sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listOpenAiModels();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/openai/models" })
      );
    });

    it("updatePrivacyConfig sends PATCH", async () => {
      await apiClient.updatePrivacyConfig({ redactionEnabled: false });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "PATCH",
        path: "/api/settings/privacy",
        body: { redactionEnabled: false },
        headers: undefined,
      });
    });

    it("listExperimentalChannelActivity sends GET without projectId", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: {} } });
      await apiClient.listExperimentalChannelActivity();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/experimental/channels/activity" })
      );
    });

    it("listExperimentalChannelActivity sends GET with projectId", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: {} } });
      await apiClient.listExperimentalChannelActivity("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/experimental/channels/activity?projectId=proj-1" })
      );
    });
  });

  describe("MCP Integration APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("getMcpIntegrations sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getMcpIntegrations();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/settings/integrations/mcp" })
      );
    });

    it("createOrUpdateMcpIntegration sends POST", async () => {
      await apiClient.createOrUpdateMcpIntegration({
        id: "mcp-1",
        name: "Test MCP",
        transport: "stdio",
        command: "node",
        args: ["server.js"],
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/settings/integrations/mcp",
        body: { server: { id: "mcp-1", name: "Test MCP", transport: "stdio", command: "node", args: ["server.js"] } },
        headers: undefined,
      });
    });

    it("patchMcpIntegration sends PATCH", async () => {
      await apiClient.patchMcpIntegration("mcp-1", { enabled: false });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "PATCH",
        path: "/api/v1/settings/integrations/mcp/mcp-1",
        body: { enabled: false },
        headers: undefined,
      });
    });

    it("deleteMcpIntegration sends DELETE", async () => {
      await apiClient.deleteMcpIntegration("mcp-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "DELETE",
        path: "/api/v1/settings/integrations/mcp/mcp-1",
        body: undefined,
        headers: undefined,
      });
    });

    it("connectMcpIntegration sends POST", async () => {
      await apiClient.connectMcpIntegration("mcp-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/settings/integrations/mcp/mcp-1/connect",
        body: undefined,
        headers: undefined,
      });
    });

    it("disconnectMcpIntegration sends POST", async () => {
      await apiClient.disconnectMcpIntegration("mcp-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/settings/integrations/mcp/mcp-1/disconnect",
        body: undefined,
        headers: undefined,
      });
    });

    it("listMcpIntegrationResources sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listMcpIntegrationResources("mcp-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/settings/integrations/mcp/mcp-1/resources" })
      );
    });

    it("readMcpIntegrationResource sends POST", async () => {
      await apiClient.readMcpIntegrationResource("mcp-1", "file://test.txt");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/settings/integrations/mcp/mcp-1/resources/read",
        body: { uri: "file://test.txt" },
        headers: undefined,
      });
    });

    it("getLspIntegrations sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getLspIntegrations();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/settings/integrations/lsp" })
      );
    });

    it("getMcpServerHealth sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { status: "healthy" } });
      await apiClient.getMcpServerHealth("mcp-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v1/settings/integrations/mcp/mcp-1/health" })
      );
    });
  });

  describe("V3 Routing and Context APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("planRouteV3 sends POST", async () => {
      await apiClient.planRouteV3({ actor: "user", prompt: "Build feature" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v3/commands/router.plan",
        body: { actor: "user", prompt: "Build feature" },
        headers: undefined,
      });
    });

    it("materializeContextV3 sends POST", async () => {
      await apiClient.materializeContextV3({
        actor: "user",
        aggregate_id: "agg-1",
        aggregate_type: "ticket",
        goal: "implement feature",
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v3/commands/context.materialize",
        body: { actor: "user", aggregate_id: "agg-1", aggregate_type: "ticket", goal: "implement feature" },
        headers: undefined,
      });
    });

    it("commitMemoryV3 sends POST", async () => {
      await apiClient.commitMemoryV3({
        actor: "user",
        aggregate_id: "agg-1",
        kind: "observation" as any,
        content: "Learned something",
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v3/commands/memory.commit",
        body: { actor: "user", aggregate_id: "agg-1", kind: "observation", content: "Learned something" },
        headers: undefined,
      });
    });

    it("spawnAgentLaneV3 sends POST", async () => {
      await apiClient.spawnAgentLaneV3({
        actor: "user",
        ticket_id: "t-1",
        role: "coder" as any,
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v3/commands/agent.spawn",
        body: { actor: "user", ticket_id: "t-1", role: "coder" },
        headers: undefined,
      });
    });

    it("reclaimAgentLaneV3 sends POST", async () => {
      await apiClient.reclaimAgentLaneV3({ actor: "user", lane_id: "lane-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v3/commands/agent.reclaim",
        body: { actor: "user", lane_id: "lane-1" },
        headers: undefined,
      });
    });

    it("prepareMergeV3 sends POST", async () => {
      await apiClient.prepareMergeV3({
        actor: "user",
        run_id: "run-1",
        changed_files: ["src/index.ts"],
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v3/commands/run.merge.prepare",
        body: { actor: "user", run_id: "run-1", changed_files: ["src/index.ts"] },
        headers: undefined,
      });
    });

    it("registerChallengeV3 sends POST", async () => {
      await apiClient.registerChallengeV3({
        actor: "user",
        model_plugin_id: "plugin-1",
        dataset_id: "ds-1",
        eval_run_id: "eval-1",
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v3/commands/model.challenge.register",
        body: { actor: "user", model_plugin_id: "plugin-1", dataset_id: "ds-1", eval_run_id: "eval-1" },
        headers: undefined,
      });
    });

    it("reviewChallengeV3 sends POST", async () => {
      await apiClient.reviewChallengeV3({ actor: "user", candidate_id: "cand-1", status: "approved" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v3/commands/model.challenge.review",
        body: { actor: "user", candidate_id: "cand-1", status: "approved" },
        headers: undefined,
      });
    });

    it("getTaskContextV3 sends GET", async () => {
      await apiClient.getTaskContextV3("task-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v3/tasks/task-1/context" })
      );
    });

    it("getWorkflowStateV3 sends GET", async () => {
      await apiClient.getWorkflowStateV3("task-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v3/tasks/task-1/workflow-state" })
      );
    });

    it("searchMemoryV3 sends GET with encoded query", async () => {
      await apiClient.searchMemoryV3("memory test");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v3/memory/search?q=memory%20test" })
      );
    });

    it("listAgentLanesV3 sends GET without filter", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listAgentLanesV3();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v3/agents/lanes" })
      );
    });

    it("listAgentLanesV3 sends GET with filter", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listAgentLanesV3({ ticketId: "t-1", runId: "run-1" });
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("ticketId=t-1");
      expect(callPath).toContain("runId=run-1");
    });

    it("getMergeReportV3 sends GET", async () => {
      await apiClient.getMergeReportV3("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v3/runs/run-1/merge-report" })
      );
    });

    it("getRunSummaryV3 sends GET", async () => {
      await apiClient.getRunSummaryV3("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v3/runs/run-1/summary" })
      );
    });

    it("getRetrievalTraceV3 sends GET", async () => {
      await apiClient.getRetrievalTraceV3("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v3/runs/run-1/retrieval-trace" })
      );
    });

    it("getOpenAiBudgetV3 sends GET", async () => {
      await apiClient.getOpenAiBudgetV3();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v3/providers/openai/budget" })
      );
    });

    it("getChampionVsChallengerV3 sends GET", async () => {
      await apiClient.getChampionVsChallengerV3();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v3/evals/champion-vs-challenger" })
      );
    });
  });

  describe("V4 Repo APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("listReposV4 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listReposV4();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/repos" })
      );
    });

    it("getActiveRepoV4 sends GET", async () => {
      await apiClient.getActiveRepoV4();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/repos/active" })
      );
    });

    it("attachLocalRepoV4 sends POST", async () => {
      await apiClient.attachLocalRepoV4({ actor: "user", source_path: "/code" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v4/commands/repo.attach-local",
        body: { actor: "user", source_path: "/code" },
        headers: undefined,
      });
    });

    it("cloneRepoV4 sends POST", async () => {
      await apiClient.cloneRepoV4({ actor: "user", url: "https://github.com/test/repo.git" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v4/commands/repo.clone",
        body: { actor: "user", url: "https://github.com/test/repo.git" },
        headers: undefined,
      });
    });

    it("importManagedPackV4 sends POST", async () => {
      await apiClient.importManagedPackV4({ actor: "user", project_key: "my-project" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v4/commands/repo.register",
        body: { actor: "user", project_key: "my-project" },
        headers: undefined,
      });
    });

    it("activateRepoV4 sends POST", async () => {
      await apiClient.activateRepoV4({ actor: "user", repo_id: "repo-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v4/commands/repo.activate",
        body: { actor: "user", repo_id: "repo-1" },
        headers: undefined,
      });
    });

    it("prepareRepoSwitchV4 sends POST", async () => {
      await apiClient.prepareRepoSwitchV4({ actor: "user", to_repo_id: "repo-2" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v4/commands/repo.switch-prepare",
        body: { actor: "user", to_repo_id: "repo-2" },
        headers: undefined,
      });
    });

    it("commitRepoSwitchV4 sends POST", async () => {
      await apiClient.commitRepoSwitchV4({ actor: "user", checkpoint_id: "cp-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v4/commands/repo.switch-commit",
        body: { actor: "user", checkpoint_id: "cp-1" },
        headers: undefined,
      });
    });

    it("getRepoGuidelinesV4 sends GET", async () => {
      await apiClient.getRepoGuidelinesV4("repo-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/repos/repo-1/guidelines" })
      );
    });

    it("getRepoStateV4 sends GET", async () => {
      await apiClient.getRepoStateV4("repo-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/repos/repo-1/state" })
      );
    });

    it("getRepoContextV4 sends GET", async () => {
      await apiClient.getRepoContextV4("repo-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/repos/repo-1/context" })
      );
    });
  });

  describe("V4 Benchmark APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("listBenchmarkProjectsV4 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listBenchmarkProjectsV4();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/benchmarks/projects" })
      );
    });

    it("getBenchmarkProjectV4 sends GET", async () => {
      await apiClient.getBenchmarkProjectV4("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/benchmarks/projects/proj-1" })
      );
    });

    it("startBenchmarkRunV4 sends POST", async () => {
      await apiClient.startBenchmarkRunV4({ actor: "user", project_id: "proj-1", task_id: "task-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v4/commands/benchmark.run.start",
        body: { actor: "user", project_id: "proj-1", task_id: "task-1" },
        headers: undefined,
      });
    });

    it("executeBenchmarkTaskV4 sends POST", async () => {
      await apiClient.executeBenchmarkTaskV4({ actor: "user", run_id: "run-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v4/commands/benchmark.task.execute",
        body: { actor: "user", run_id: "run-1" },
        headers: undefined,
      });
    });

    it("recomputeBenchmarkScoreV4 sends POST", async () => {
      await apiClient.recomputeBenchmarkScoreV4({ actor: "user", run_id: "run-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v4/commands/benchmark.score.recompute",
        body: { actor: "user", run_id: "run-1" },
        headers: undefined,
      });
    });

    it("getBenchmarkRunV4 sends GET", async () => {
      await apiClient.getBenchmarkRunV4("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/benchmarks/runs/run-1" })
      );
    });

    it("getBenchmarkScorecardV4 sends GET", async () => {
      await apiClient.getBenchmarkScorecardV4("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/benchmarks/runs/run-1/scorecard" })
      );
    });

    it("getBenchmarkArtifactsV4 sends GET", async () => {
      await apiClient.getBenchmarkArtifactsV4("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/benchmarks/runs/run-1/artifacts" })
      );
    });

    it("getBenchmarkLeaderboardV4 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getBenchmarkLeaderboardV4();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/benchmarks/leaderboard" })
      );
    });

    it("getBenchmarkFailuresV4 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getBenchmarkFailuresV4();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v4/benchmarks/failures" })
      );
    });
  });

  describe("V5 Project APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("listProjectsV5 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listProjectsV5();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v5/projects" })
      );
    });

    it("getProjectV5 sends GET", async () => {
      await apiClient.getProjectV5("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v5/projects/proj-1" })
      );
    });

    it("connectLocalProjectV5 sends POST", async () => {
      await apiClient.connectLocalProjectV5({ actor: "user", source_path: "/code" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v5/commands/project.connect.local",
        body: { actor: "user", source_path: "/code" },
        headers: undefined,
      });
    });

    it("connectGithubProjectV5 sends POST", async () => {
      await apiClient.connectGithubProjectV5({ actor: "user", owner: "test", repo: "repo" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v5/commands/project.connect.github",
        body: { actor: "user", owner: "test", repo: "repo" },
        headers: undefined,
      });
    });

    it("activateProjectV5 sends POST", async () => {
      await apiClient.activateProjectV5({ actor: "user", repo_id: "repo-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v5/commands/project.activate",
        body: { actor: "user", repo_id: "repo-1" },
        headers: undefined,
      });
    });

    it("syncProjectV5 sends POST", async () => {
      await apiClient.syncProjectV5({ actor: "user", repo_id: "repo-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v5/commands/project.sync",
        body: { actor: "user", repo_id: "repo-1" },
        headers: undefined,
      });
    });

    it("getProjectStateV5 sends GET", async () => {
      await apiClient.getProjectStateV5("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v5/projects/proj-1/state" })
      );
    });

    it("getProjectGuidelinesV5 sends GET", async () => {
      await apiClient.getProjectGuidelinesV5("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v5/projects/proj-1/guidelines" })
      );
    });

    it("getCodeGraphStatusV5 sends GET", async () => {
      await apiClient.getCodeGraphStatusV5("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v5/projects/proj-1/codegraph/status" })
      );
    });

    it("getLatestContextPackV5 sends GET", async () => {
      await apiClient.getLatestContextPackV5("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v5/projects/proj-1/context-pack" })
      );
    });

    it("queryCodeGraphV5 sends GET with params", async () => {
      await apiClient.queryCodeGraphV5("repo-1", "test query", "semantic" as any);
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("repoId=repo-1");
      expect(callPath).toContain("q=test+query");
      expect(callPath).toContain("mode=semantic");
    });

    it("buildContextPackV5 sends POST", async () => {
      await apiClient.buildContextPackV5({ actor: "user", repo_id: "repo-1", objective: "build feature" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v5/commands/context.pack.build",
        body: { actor: "user", repo_id: "repo-1", objective: "build feature" },
        headers: undefined,
      });
    });
  });

  describe("V5 Execution APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("planExecutionV5 sends POST", async () => {
      await apiClient.planExecutionV5({
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        objective: "implement feature",
        worktree_path: "/worktree",
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v5/commands/execution.plan",
        body: { actor: "user", run_id: "run-1", repo_id: "repo-1", objective: "implement feature", worktree_path: "/worktree" },
        headers: undefined,
      });
    });

    it("startExecutionV5 sends POST", async () => {
      await apiClient.startExecutionV5({
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        worktree_path: "/worktree",
        objective: "do stuff",
        model_role: "coder_default",
        provider_id: "qwen-cli",
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v5/commands/execution.start",
        body: {
          actor: "user",
          run_id: "run-1",
          repo_id: "repo-1",
          worktree_path: "/worktree",
          objective: "do stuff",
          model_role: "coder_default",
          provider_id: "qwen-cli",
        },
        headers: undefined,
      });
    });

    it("verifyExecutionV5 sends POST", async () => {
      await apiClient.verifyExecutionV5({
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        worktree_path: "/worktree",
        commands: ["npm test"],
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v5/commands/execution.verify",
        body: {
          actor: "user",
          run_id: "run-1",
          repo_id: "repo-1",
          worktree_path: "/worktree",
          commands: ["npm test"],
        },
        headers: undefined,
      });
    });

    it("executeBenchmarkRunV5 sends POST", async () => {
      await apiClient.executeBenchmarkRunV5({ actor: "user", run_id: "run-1" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v5/commands/benchmark.run.execute",
        body: { actor: "user", run_id: "run-1" },
        headers: undefined,
      });
    });

    it("listRunAttemptsV5 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listRunAttemptsV5("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v5/runs/run-1/attempts" })
      );
    });

    it("getVerificationV5 sends GET", async () => {
      await apiClient.getVerificationV5("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v5/runs/run-1/verification" })
      );
    });

    it("getShareReportV5 sends GET", async () => {
      await apiClient.getShareReportV5("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v5/runs/run-1/share" })
      );
    });
  });

  describe("V8 Mission APIs - extended", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("getMissionSnapshotV8 without query params", async () => {
      await apiClient.getMissionSnapshotV8();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v8/mission/snapshot" })
      );
    });

    it("getMissionSnapshotV8 with sessionId", async () => {
      await apiClient.getMissionSnapshotV8({ sessionId: "sess-1" });
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("sessionId=sess-1");
    });

    it("getMissionBacklogV8 sends GET without params", async () => {
      await apiClient.getMissionBacklogV8();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v8/mission/backlog" })
      );
    });

    it("getMissionBacklogV8 sends GET with params", async () => {
      await apiClient.getMissionBacklogV8({ projectId: "proj-1", ticketId: "t-1" });
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("projectId=proj-1");
      expect(callPath).toContain("ticketId=t-1");
    });

    it("getMissionTaskDetailV8 sends GET", async () => {
      await apiClient.getMissionTaskDetailV8({ taskId: "task-1", projectId: "proj-1" });
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("taskId=task-1");
      expect(callPath).toContain("projectId=proj-1");
    });

    it("getMissionTaskDetailV8 sends GET without projectId", async () => {
      await apiClient.getMissionTaskDetailV8({ taskId: "task-1" });
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("taskId=task-1");
      expect(callPath).not.toContain("projectId");
    });

    it("moveMissionWorkflowV8 sends POST", async () => {
      await apiClient.moveMissionWorkflowV8({ ticketId: "t-1", targetStatus: "done" } as any);
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/mission/workflow.move",
        body: { ticketId: "t-1", targetStatus: "done" },
        headers: undefined,
      });
    });

    it("setMissionWorkflowExecutionProfileV8 sends POST", async () => {
      await apiClient.setMissionWorkflowExecutionProfileV8({
        workflowId: "wf-1",
        executionProfileId: "profile-1",
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/mission/workflow.execution-profile",
        body: { workflowId: "wf-1", executionProfileId: "profile-1" },
        headers: undefined,
      });
    });

    it("getMissionCodeFileDiffV8 sends GET", async () => {
      await apiClient.getMissionCodeFileDiffV8("proj-1", "src/index.ts");
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("projectId=proj-1");
      expect(callPath).toContain("path=src%2Findex.ts");
    });

    it("getMissionConsoleV8 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getMissionConsoleV8("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v8/mission/console?projectId=proj-1" })
      );
    });

    it("getProjectBlueprintV8 sends GET", async () => {
      await apiClient.getProjectBlueprintV8("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v8/projects/proj-1/blueprint" })
      );
    });

    it("getProjectBlueprintSourcesV8 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getProjectBlueprintSourcesV8("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v8/projects/proj-1/blueprint/sources" })
      );
    });

    it("getProjectStartersV8 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.getProjectStartersV8();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v8/project-starters" })
      );
    });

    it("generateProjectBlueprintV8 sends POST", async () => {
      await apiClient.generateProjectBlueprintV8("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/projects/proj-1/blueprint/generate",
        body: {},
        headers: undefined,
      });
    });

    it("updateProjectBlueprintV8 sends POST", async () => {
      await apiClient.updateProjectBlueprintV8("proj-1", { name: "updated" } as any);
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/projects/proj-1/blueprint/update",
        body: { name: "updated" },
        headers: undefined,
      });
    });

    it("connectGithubProjectV8 sends POST", async () => {
      await apiClient.connectGithubProjectV8({ actor: "user", owner: "test", repo: "repo" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/projects/connect/github",
        body: { actor: "user", owner: "test", repo: "repo" },
        headers: undefined,
      });
    });

    it("openRecentProjectV8 sends POST", async () => {
      await apiClient.openRecentProjectV8({ actor: "user", source_path: "/code" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/projects/open-recent",
        body: { actor: "user", source_path: "/code" },
        headers: undefined,
      });
    });

    it("getScaffoldPlanV8 sends POST", async () => {
      await apiClient.getScaffoldPlanV8("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/projects/proj-1/scaffold/plan",
        body: {},
        headers: undefined,
      });
    });

    it("getScaffoldPlanV8 sends POST with starterId", async () => {
      await apiClient.getScaffoldPlanV8("proj-1", { starterId: "react-ts" as any });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/projects/proj-1/scaffold/plan",
        body: { starterId: "react-ts" },
        headers: undefined,
      });
    });

    it("executeScaffoldV8 sends POST", async () => {
      await apiClient.executeScaffoldV8("proj-1", { actor: "user", objective: "setup project" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/projects/proj-1/scaffold/execute",
        body: { actor: "user", objective: "setup project" },
        headers: undefined,
      });
    });

    it("getScaffoldStatusV8 sends GET", async () => {
      await apiClient.getScaffoldStatusV8("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v8/projects/proj-1/scaffold/status" })
      );
    });

    it("getLatestProjectReportV8 sends GET", async () => {
      await apiClient.getLatestProjectReportV8("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v8/projects/proj-1/report/latest" })
      );
    });
  });

  describe("V8/V9 Overseer and Execute APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("sendOverseerMessageV8 sends POST", async () => {
      await apiClient.sendOverseerMessageV8({ actor: "user", content: "Hello" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/mission/overseer/chat",
        body: { actor: "user", content: "Hello" },
        headers: undefined,
      });
    });

    it("reviewOverseerRouteV8 sends POST", async () => {
      await apiClient.reviewOverseerRouteV8({ actor: "user", project_id: "proj-1", prompt: "Do thing" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v8/mission/overseer/route.review",
        body: { actor: "user", project_id: "proj-1", prompt: "Do thing" },
        headers: undefined,
      });
    });

    it("executeOverseerRouteV8 sends POST", async () => {
      await apiClient.executeOverseerRouteV8({ actor: "user", project_id: "proj-1", prompt: "Execute thing" });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v9/mission/execute",
        body: { actor: "user", project_id: "proj-1", prompt: "Execute thing" },
        headers: undefined,
      });
    });

    it("getMissionTicketPermissionV9 sends GET", async () => {
      await apiClient.getMissionTicketPermissionV9("ticket-1");
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("ticketId=ticket-1");
    });

    it("setMissionTicketPermissionV9 sends POST", async () => {
      await apiClient.setMissionTicketPermissionV9({
        ticket_id: "t-1",
        mode: "strict",
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v9/mission/ticket.permission",
        body: { ticket_id: "t-1", mode: "strict" },
        headers: undefined,
      });
    });

    it("listRunToolEventsV9 sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listRunToolEventsV9("run-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/v9/mission/run/run-1/tool-events" })
      );
    });

    it("requestDependencyBootstrapV9 sends POST", async () => {
      await apiClient.requestDependencyBootstrapV9({
        actor: "user",
        run_id: "run-1",
        repo_id: "repo-1",
        ticket_id: "t-1",
        stage: "scope",
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v9/mission/dependency.bootstrap",
        body: { actor: "user", run_id: "run-1", repo_id: "repo-1", ticket_id: "t-1", stage: "scope" },
        headers: undefined,
      });
    });
  });

  describe("Skills APIs - extended", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("getSkill sends GET", async () => {
      await apiClient.getSkill("skill-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/skills/skill-1" })
      );
    });

    it("updateSkill sends PATCH", async () => {
      await apiClient.updateSkill("skill-1", { name: "Updated Skill" } as any);
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "PATCH",
        path: "/api/skills/skill-1",
        body: { name: "Updated Skill" },
        headers: { "content-type": "application/json" },
      });
    });

    it("deleteSkill sends DELETE", async () => {
      await apiClient.deleteSkill("skill-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "DELETE",
        path: "/api/skills/skill-1",
        body: undefined,
        headers: undefined,
      });
    });

    it("listSkillInvocations sends GET without filter", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listSkillInvocations();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/skills/invocations" })
      );
    });

    it("listSkillInvocations sends GET with filter", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listSkillInvocations({ runId: "run-1", limit: 10 });
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("runId=run-1");
      expect(callPath).toContain("limit=10");
    });
  });

  describe("Hooks APIs - extended", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("getHook sends GET", async () => {
      await apiClient.getHook("hook-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/hooks/hook-1" })
      );
    });

    it("createHook sends POST", async () => {
      await apiClient.createHook({
        name: "Test Hook",
        eventType: "PreToolUse",
        enabled: true,
        projectId: "proj-1",
        implementation: "console.log('hook')",
      } as any);
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/hooks",
        body: {
          name: "Test Hook",
          eventType: "PreToolUse",
          enabled: true,
          projectId: "proj-1",
          implementation: "console.log('hook')",
        },
        headers: { "content-type": "application/json" },
      });
    });

    it("updateHook sends PATCH", async () => {
      await apiClient.updateHook("hook-1", { enabled: false } as any);
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "PATCH",
        path: "/api/hooks/hook-1",
        body: { enabled: false },
        headers: { "content-type": "application/json" },
      });
    });

    it("deleteHook sends DELETE", async () => {
      await apiClient.deleteHook("hook-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "DELETE",
        path: "/api/hooks/hook-1",
        body: undefined,
        headers: undefined,
      });
    });

    it("listHookExecutions sends GET without filter", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listHookExecutions();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/hooks/executions" })
      );
    });

    it("listHookExecutions sends GET with filter", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
      await apiClient.listHookExecutions({ hookId: "hook-1", runId: "run-1", limit: 5 });
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("hookId=hook-1");
      expect(callPath).toContain("runId=run-1");
      expect(callPath).toContain("limit=5");
    });
  });

  describe("Telemetry APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
    });

    it("getTelemetrySpans sends GET without filter", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { spans: [] } });
      await apiClient.getTelemetrySpans();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/telemetry/spans" })
      );
    });

    it("getTelemetrySpans sends GET with filter", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { spans: [] } });
      await apiClient.getTelemetrySpans({ name: "execution", status: "error" });
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("name=execution");
      expect(callPath).toContain("status=error");
    });

    it("getTelemetryMetrics uses apiRequestText", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: "# HELP metric_name\nmetric_name 42",
      });
      const result = await apiClient.getTelemetryMetrics();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({
          path: "/api/telemetry/metrics",
          headers: { accept: "text/plain" },
        })
      );
      expect(result).toBe("# HELP metric_name\nmetric_name 42");
    });
  });

  describe("Diagnostics APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
    });

    it("getCacheBreakDiagnostics sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          baselineCacheReadTokens: 100,
          sampleCount: 5,
          emaAlpha: 0.3,
          recentBreaks: [],
          hitRateEstimate: 0.85,
        },
      });
      const result = await apiClient.getCacheBreakDiagnostics();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/diagnostics/cache-breaks" })
      );
      expect(result.hitRateEstimate).toBe(0.85);
    });

    it("getEnvironmentDiagnostics sends GET", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: true,
        status: 200,
        body: {
          gitVersion: "2.40",
          nodeVersion: "20.0",
          osVersion: "Darwin 24.0",
          arch: "arm64",
          cpuCount: 8,
          cpuModel: "Apple M1",
          totalMemory: "16GB",
          freeMemory: "8GB",
          diskSpace: { available: "100GB", total: "500GB" },
          dbLatencyMs: 2,
          uptime: "24h",
          hardware: { platform: "apple-silicon", unifiedMemoryMb: 16384 },
        },
      });
      const result = await apiClient.getEnvironmentDiagnostics();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/diagnostics/environment" })
      );
      expect(result.hardware.platform).toBe("apple-silicon");
    });
  });

  describe("Learnings and Self-Learning APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
    });

    it("listLearnings sends GET without filter", async () => {
      await apiClient.listLearnings();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/learnings" })
      );
    });

    it("listLearnings sends GET with filter", async () => {
      await apiClient.listLearnings({ projectId: "proj-1", category: "code" } as any);
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("projectId=proj-1");
      expect(callPath).toContain("category=code");
    });

    it("listPrinciples sends GET without projectId", async () => {
      await apiClient.listPrinciples();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/learnings/principles" })
      );
    });

    it("listPrinciples sends GET with projectId", async () => {
      await apiClient.listPrinciples("proj-1");
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("projectId=proj-1");
    });

    it("deleteLearning sends DELETE", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { ok: true } });
      await apiClient.deleteLearning("learning-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "DELETE",
        path: "/api/learnings/learning-1",
        body: undefined,
        headers: undefined,
      });
    });

    it("triggerDreamCycle sends POST", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { ok: true, principlesCreated: 3 } });
      await apiClient.triggerDreamCycle("proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/learnings/dream/trigger",
        body: { projectId: "proj-1" },
        headers: { "content-type": "application/json" },
      });
    });

    it("triggerDreamCycle sends POST without projectId", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { ok: true, principlesCreated: 0 } });
      await apiClient.triggerDreamCycle();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/learnings/dream/trigger",
        body: {},
        headers: { "content-type": "application/json" },
      });
    });

    it("getDreamStats sends GET without projectId", async () => {
      await apiClient.getDreamStats();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/learnings/dream/stats" })
      );
    });

    it("getDreamStats sends GET with projectId", async () => {
      await apiClient.getDreamStats("proj-1");
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("projectId=proj-1");
    });

    it("listSuggestedSkills sends GET without projectId", async () => {
      await apiClient.listSuggestedSkills();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/learnings/skills/suggested" })
      );
    });

    it("listSuggestedSkills sends GET with projectId", async () => {
      await apiClient.listSuggestedSkills("proj-1");
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("projectId=proj-1");
    });

    it("approveSuggestedSkill sends POST", async () => {
      await apiClient.approveSuggestedSkill("skill-1", "proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/learnings/skills/suggested/skill-1/approve",
        body: { projectId: "proj-1" },
        headers: { "content-type": "application/json" },
      });
    });

    it("dismissSuggestedSkill sends POST", async () => {
      await apiClient.dismissSuggestedSkill("skill-1", "proj-1");
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/learnings/skills/suggested/skill-1/dismiss",
        body: { projectId: "proj-1" },
        headers: { "content-type": "application/json" },
      });
    });
  });

  describe("Global Knowledge APIs", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: { items: [] } });
    });

    it("listGlobalLearnings sends GET without opts", async () => {
      await apiClient.listGlobalLearnings();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/learnings/global" })
      );
    });

    it("listGlobalLearnings sends GET with opts", async () => {
      await apiClient.listGlobalLearnings({
        techFingerprint: ["react", "typescript"],
        limit: 10,
        minConfidence: 0.8,
      });
      const callPath = mockDesktopBridge.apiRequest.mock.calls[0]?.[0]?.path;
      expect(callPath).toContain("techFingerprint=react%2Ctypescript");
      expect(callPath).toContain("limit=10");
      expect(callPath).toContain("minConfidence=0.8");
    });

    it("listGlobalPrinciples sends GET", async () => {
      await apiClient.listGlobalPrinciples();
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith(
        expect.objectContaining({ path: "/api/learnings/global/principles" })
      );
    });
  });

  describe("apiRequest with headers forwarding via desktop bridge", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
      mockDesktopBridge.apiRequest.mockResolvedValue({ ok: true, status: 200, body: {} });
    });

    it("forwards custom headers via desktop bridge", async () => {
      await apiClient.apiRequest("/api/v1/test", {
        headers: { "x-custom-header": "custom-value" },
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: undefined,
        path: "/api/v1/test",
        body: undefined,
        headers: { "x-custom-header": "custom-value" },
      });
    });

    it("handles non-string body in desktop bridge path", async () => {
      const body = { key: "value" };
      await apiClient.apiRequest("/api/v1/test", {
        method: "POST",
        body: body as any,
      });
      expect(mockDesktopBridge.apiRequest).toHaveBeenCalledWith({
        method: "POST",
        path: "/api/v1/test",
        body: { key: "value" },
        headers: undefined,
      });
    });
  });

  describe("parseDesktopError edge cases", () => {
    beforeEach(() => {
      vi.mocked(getDesktopBridge).mockReturnValue(mockDesktopBridge);
    });

    it("handles empty error string in body", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: false,
        status: 400,
        body: { error: "  " },
      });
      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow("API request failed with 400");
    });

    it("handles non-string error in body", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: false,
        status: 400,
        body: { error: 42 },
      });
      // Falls through to text or default message
      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow("API request failed with 400");
    });

    it("handles empty text", async () => {
      mockDesktopBridge.apiRequest.mockResolvedValue({
        ok: false,
        status: 400,
        text: "  ",
      });
      await expect(apiClient.apiRequest("/api/v1/test")).rejects.toThrow("API request failed with 400");
    });
  });

  describe("openBrowserEventStream (fetch-based SSE)", () => {
    let mockFetch: ReturnType<typeof vi.fn>;

    beforeEach(() => {
      // No openStream on desktopBridge so it falls through to browser path
      vi.mocked(getDesktopBridge).mockReturnValue(undefined);
      mockFetch = vi.fn();
      globalThis.fetch = mockFetch;
      import.meta.env.VITE_API_TOKEN = "test-token";
      import.meta.env.VITE_API_BASE_URL = "http://localhost:8787";
    });

    function makeDelayedReadableStream(chunks: string[], delayMs = 20): ReadableStream<Uint8Array> {
      const encoder = new TextEncoder();
      let index = 0;
      return new ReadableStream<Uint8Array>({
        async pull(controller) {
          await new Promise((r) => setTimeout(r, delayMs));
          if (index < chunks.length) {
            controller.enqueue(encoder.encode(chunks[index]!));
            index++;
          } else {
            controller.close();
          }
        },
      });
    }

    it("throws when response is not ok", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 500,
        body: null,
        text: async () => "Server error",
      });

      await expect(apiClient.openEventStreamV2()).rejects.toThrow("Server error");
    });

    it("throws generic error when response text is empty", async () => {
      mockFetch.mockResolvedValue({
        ok: false,
        status: 502,
        body: null,
        text: async () => "",
      });

      await expect(apiClient.openEventStreamV2()).rejects.toThrow("Failed to open stream (502)");
    });

    it("throws when VITE_API_TOKEN is missing", async () => {
      import.meta.env.VITE_API_TOKEN = "";
      await expect(apiClient.openEventStreamV2()).rejects.toThrow(
        "VITE_API_TOKEN is required when running the web preview outside Electron."
      );
    });

    it("parses SSE data events from stream", async () => {
      const body = makeDelayedReadableStream([
        'data: {"msg":"hello"}\n\n',
        'data: {"msg":"world"}\n\n',
      ]);

      mockFetch.mockResolvedValue({ ok: true, status: 200, body });

      const stream = await apiClient.openEventStreamV2();
      const received: string[] = [];
      stream.addEventListener("message", ((e: MessageEvent) => {
        received.push(e.data);
      }) as EventListener);

      // Wait for the async reader to process all delayed chunks
      await new Promise((r) => setTimeout(r, 200));

      expect(received).toContain('{"msg":"hello"}');
      expect(received).toContain('{"msg":"world"}');
    });

    it("parses SSE event: lines for custom event types", async () => {
      const body = makeDelayedReadableStream([
        "event: custom\ndata: payload\n\n",
      ]);

      mockFetch.mockResolvedValue({ ok: true, status: 200, body });

      const stream = await apiClient.openEventStreamV2();
      const received: string[] = [];
      stream.addEventListener("custom", ((e: MessageEvent) => {
        received.push(e.data);
      }) as EventListener);

      await new Promise((r) => setTimeout(r, 200));
      expect(received).toContain("payload");
    });

    it("handles multi-line data fields", async () => {
      const body = makeDelayedReadableStream([
        "data: line1\ndata: line2\n\n",
      ]);

      mockFetch.mockResolvedValue({ ok: true, status: 200, body });

      const stream = await apiClient.openEventStreamV2();
      const received: string[] = [];
      stream.addEventListener("message", ((e: MessageEvent) => {
        received.push(e.data);
      }) as EventListener);

      await new Promise((r) => setTimeout(r, 200));
      expect(received).toContain("line1\nline2");
    });

    it("emits remaining data when stream ends without trailing newline", async () => {
      const body = makeDelayedReadableStream([
        "data: final\n\n",
      ]);

      mockFetch.mockResolvedValue({ ok: true, status: 200, body });

      const stream = await apiClient.openEventStreamV2();
      const received: string[] = [];
      stream.addEventListener("message", ((e: MessageEvent) => {
        received.push(e.data);
      }) as EventListener);

      await new Promise((r) => setTimeout(r, 200));
      expect(received).toContain("final");
    });

    it("handles stream read error gracefully", async () => {
      let errorTriggered = false;
      const body = new ReadableStream<Uint8Array>({
        async pull(controller) {
          if (!errorTriggered) {
            errorTriggered = true;
            await new Promise((r) => setTimeout(r, 20));
            controller.error(new Error("Network died"));
          }
        },
      });

      mockFetch.mockResolvedValue({ ok: true, status: 200, body });

      const stream = await apiClient.openEventStreamV2();
      const errors: string[] = [];
      stream.addEventListener("error", ((e: MessageEvent) => {
        errors.push(e.data);
      }) as EventListener);

      await new Promise((r) => setTimeout(r, 200));
      expect(errors).toContain("Network died");
    });

    it("does not emit error when stream is closed by user (abort)", async () => {
      let pullResolve: () => void;
      const body = new ReadableStream<Uint8Array>({
        async pull(_controller) {
          await new Promise<void>((r) => { pullResolve = r; });
        },
        cancel() {
          pullResolve?.();
        },
      });

      mockFetch.mockResolvedValue({ ok: true, status: 200, body });

      const stream = await apiClient.openEventStreamV2();
      const errors: string[] = [];
      stream.addEventListener("error", ((e: MessageEvent) => {
        errors.push(e.data);
      }) as EventListener);

      stream.close();
      await new Promise((r) => setTimeout(r, 100));
      expect(errors).toHaveLength(0);
    });

    it("resets event name to 'message' after empty line", async () => {
      const body = makeDelayedReadableStream([
        "event: custom\ndata: first\n\ndata: second\n\n",
      ]);

      mockFetch.mockResolvedValue({ ok: true, status: 200, body });

      const stream = await apiClient.openEventStreamV2();
      const customReceived: string[] = [];
      const messageReceived: string[] = [];
      stream.addEventListener("custom", ((e: MessageEvent) => {
        customReceived.push(e.data);
      }) as EventListener);
      stream.addEventListener("message", ((e: MessageEvent) => {
        messageReceived.push(e.data);
      }) as EventListener);

      await new Promise((r) => setTimeout(r, 200));
      expect(customReceived).toContain("first");
      expect(messageReceived).toContain("second");
    });
  });
});
