import { describe, it, expect, vi, beforeEach } from "vitest";
import { askUser, completeTask, rollbackFile } from "./meta";
import type { ToolContext } from "../types";

vi.mock("../../services/shadowGitService", () => {
  return {
    ShadowGitService: vi.fn().mockImplementation(() => ({
      initialize: vi.fn(),
      rollback: vi.fn(),
    })),
  };
});

vi.mock("node:fs/promises", () => ({
  default: {
    writeFile: vi.fn(async () => {}),
  },
  writeFile: vi.fn(async () => {}),
}));

describe("meta tools", () => {
  let mockContext: ToolContext;
  let mockCreateApproval: ReturnType<typeof vi.fn>;
  let mockRecordEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    mockCreateApproval = vi.fn(async () => ({ id: "approval-123" }));
    mockRecordEvent = vi.fn(async () => {});

    mockContext = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      stage: "build",
      conversationHistory: [],
      createApproval: mockCreateApproval,
      recordEvent: mockRecordEvent,
    };
  });

  describe("ask_user", () => {
    it("should have correct metadata", () => {
      expect(askUser.name).toBe("ask_user");
      expect(askUser.description).toContain("user");
      expect(askUser.permission.scope).toBe("meta");
    });

    it("should create approval request and return approval_required", async () => {
      const result = await askUser.execute(
        { question: "Should I proceed?" },
        mockContext
      );

      expect(result.type).toBe("approval_required");
      if (result.type === "approval_required") {
        expect(result.approvalId).toBe("approval-123");
        expect(result.message).toContain("Should I proceed?");
      }

      expect(mockCreateApproval).toHaveBeenCalledWith({
        actionType: "ask_user",
        payload: expect.objectContaining({
          question: "Should I proceed?",
        }),
      });
    });

    it("should validate question is required", () => {
      const parseResult = askUser.inputSchema.safeParse({});
      expect(parseResult.success).toBe(false);
    });

    it("should accept valid question", () => {
      const parseResult = askUser.inputSchema.safeParse({
        question: "Is this correct?"
      });
      expect(parseResult.success).toBe(true);
    });
  });

  describe("complete_task", () => {
    it("should have correct metadata", () => {
      expect(completeTask.name).toBe("complete_task");
      expect(completeTask.description).toContain("complete");
      expect(completeTask.permission.scope).toBe("meta");
    });

    it("should record completion event and return success", async () => {
      const result = await completeTask.execute(
        { summary: "Task completed successfully" },
        mockContext
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Task completed");
        expect(result.content).toContain("Task completed successfully");
      }

      expect(mockRecordEvent).toHaveBeenCalledWith({
        type: "task_completed",
        payload: expect.objectContaining({
          summary: "Task completed successfully",
          runId: "test-run",
          ticketId: "test-ticket",
        }),
      });
    });

    it("should validate summary is required", () => {
      const parseResult = completeTask.inputSchema.safeParse({});
      expect(parseResult.success).toBe(false);
    });

    it("should accept valid summary", () => {
      const parseResult = completeTask.inputSchema.safeParse({
        summary: "All tests passing"
      });
      expect(parseResult.success).toBe(true);
    });
  });

  describe("rollback_file", () => {
    it("should have correct metadata", () => {
      expect(rollbackFile.name).toBe("rollback_file");
      expect(rollbackFile.description).toContain("Rollback");
      expect(rollbackFile.permission.scope).toBe("repo.edit");
      // Note: destructive is not set, so it's undefined
    });

    it("should validate required parameters", () => {
      // Both file_path and step_id are required
      const parseResult = rollbackFile.inputSchema.safeParse({});
      expect(parseResult.success).toBe(false);
    });

    it("should accept valid parameters", () => {
      const parseResult = rollbackFile.inputSchema.safeParse({
        file_path: "src/index.ts",
        step_id: "step-123"
      });
      expect(parseResult.success).toBe(true);
    });

    it("should return error when no snapshot found for step_id", async () => {
      const { ShadowGitService } = await import("../../services/shadowGitService");
      const mockInstance = {
        initialize: vi.fn(),
        rollback: vi.fn().mockReturnValue(null),
      };
      vi.mocked(ShadowGitService).mockImplementation(() => mockInstance as any);

      const result = await rollbackFile.execute(
        { file_path: "src/index.ts", step_id: "step-missing" },
        mockContext,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("No snapshot found");
      }
    });

    it("should return error when snapshot file path does not match", async () => {
      const { ShadowGitService } = await import("../../services/shadowGitService");
      const mockInstance = {
        initialize: vi.fn(),
        rollback: vi.fn().mockReturnValue({
          filePath: "src/other.ts",
          content: "old content",
        }),
      };
      vi.mocked(ShadowGitService).mockImplementation(() => mockInstance as any);

      const result = await rollbackFile.execute(
        { file_path: "src/index.ts", step_id: "step-123" },
        mockContext,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("src/other.ts");
        expect(result.error).toContain("src/index.ts");
      }
    });

    it("should successfully rollback a file", async () => {
      const { ShadowGitService } = await import("../../services/shadowGitService");
      const mockInstance = {
        initialize: vi.fn(),
        rollback: vi.fn().mockReturnValue({
          filePath: "src/index.ts",
          content: "restored content here",
        }),
      };
      vi.mocked(ShadowGitService).mockImplementation(() => mockInstance as any);

      const result = await rollbackFile.execute(
        { file_path: "src/index.ts", step_id: "step-123" },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Successfully rolled back");
        expect(result.metadata?.filePath).toBe("src/index.ts");
        expect(result.metadata?.stepId).toBe("step-123");
        expect(result.metadata?.bytes).toBe("restored content here".length);
      }
    });

    it("should handle rollback errors gracefully", async () => {
      const { ShadowGitService } = await import("../../services/shadowGitService");
      vi.mocked(ShadowGitService).mockImplementation(() => {
        throw new Error("Git not initialized");
      });

      const result = await rollbackFile.execute(
        { file_path: "src/index.ts", step_id: "step-123" },
        mockContext,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Rollback failed");
        expect(result.error).toContain("Git not initialized");
      }
    });
  });

  describe("ask_user (additional)", () => {
    it("should handle createApproval errors gracefully", async () => {
      mockCreateApproval.mockRejectedValue(new Error("Approval service down"));

      const result = await askUser.execute(
        { question: "Should I proceed?" },
        mockContext,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Failed to create user question");
        expect(result.error).toContain("Approval service down");
      }
    });
  });

  describe("complete_task (additional)", () => {
    it("should include files_changed in output when provided", async () => {
      const result = await completeTask.execute(
        {
          summary: "Implemented feature X",
          files_changed: ["src/a.ts", "src/b.ts"],
        },
        mockContext,
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Files changed (2)");
        expect(result.content).toContain("src/a.ts");
        expect(result.content).toContain("src/b.ts");
        expect(result.metadata?.filesChanged).toEqual(["src/a.ts", "src/b.ts"]);
        expect(result.metadata?.completedAt).toBeDefined();
      }
    });

    it("should handle recordEvent errors gracefully", async () => {
      mockRecordEvent.mockRejectedValue(new Error("Database offline"));

      const result = await completeTask.execute(
        { summary: "Done" },
        mockContext,
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("Failed to record task completion");
        expect(result.error).toContain("Database offline");
      }
    });

    it("should include correct payload in recordEvent call", async () => {
      await completeTask.execute(
        { summary: "All done", files_changed: ["file.ts"] },
        mockContext,
      );

      expect(mockRecordEvent).toHaveBeenCalledWith({
        type: "task_completed",
        payload: expect.objectContaining({
          summary: "All done",
          filesChanged: ["file.ts"],
          ticketId: "test-ticket",
          runId: "test-run",
          actor: "test-agent",
          stage: "build",
        }),
      });
    });
  });
});
