import { describe, it, expect, vi, beforeEach } from "vitest";
import { askUser, completeTask, rollbackFile } from "./meta";
import type { ToolContext } from "../types";

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
  });
});
