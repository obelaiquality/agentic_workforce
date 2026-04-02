import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  createSubtaskTool,
  updateSubtaskTool,
  listSubtasksTool,
  _clearSubtasks,
  _getSubtasks,
} from "./taskDecomposition";
import type { ToolContext } from "../types";

describe("taskDecomposition tools", () => {
  let mockContext: ToolContext;
  let mockRecordEvent: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    // Clear subtask storage before each test
    _clearSubtasks();

    mockRecordEvent = vi.fn(async () => {});

    mockContext = {
      runId: "test-run",
      repoId: "test-repo",
      ticketId: "test-ticket",
      worktreePath: "/tmp/test",
      actor: "test-agent",
      stage: "build",
      conversationHistory: [],
      createApproval: vi.fn(async () => ({ id: "approval-123" })),
      recordEvent: mockRecordEvent,
    };
  });

  describe("create_subtask", () => {
    it("should have correct metadata", () => {
      expect(createSubtaskTool.name).toBe("create_subtask");
      expect(createSubtaskTool.description).toContain("Decompose");
      expect(createSubtaskTool.permission.scope).toBe("meta");
      expect(createSubtaskTool.permission.readOnly).toBe(false);
      expect(createSubtaskTool.alwaysLoad).toBe(true);
      expect(createSubtaskTool.concurrencySafe).toBe(true);
    });

    it("should create a subtask with correct fields", async () => {
      const result = await createSubtaskTool.execute(
        {
          title: "Implement login feature",
          description: "Add user authentication with JWT",
        },
        mockContext
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Subtask created");
        expect(result.content).toContain("Implement login feature");
        expect(result.metadata?.subtaskId).toMatch(/^subtask_/);
        expect(result.metadata?.parentTicketId).toBe("test-ticket");
        expect(result.metadata?.status).toBe("backlog");
      }

      // Verify subtask was stored
      const subtasks = await _getSubtasks();
      expect(subtasks).toHaveLength(1);
      const [subtask] = subtasks;
      expect(subtask.title).toBe("Implement login feature");
      expect(subtask.description).toBe("Add user authentication with JWT");
      expect(subtask.status).toBe("backlog");
      expect(subtask.priority).toBe("p2"); // default
      expect(subtask.risk).toBe("medium"); // default

      // Verify event was recorded
      expect(mockRecordEvent).toHaveBeenCalledWith({
        type: "subtask_created",
        payload: expect.objectContaining({
          title: "Implement login feature",
          parentTicketId: "test-ticket",
        }),
      });
    });

    it("should create subtask with dependencies", async () => {
      const result = await createSubtaskTool.execute(
        {
          title: "Write integration tests",
          description: "Test the login flow",
          dependencies: ["subtask_abc123"],
        },
        mockContext
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Depends on: subtask_abc123");
      }

      const subtasks = await _getSubtasks();
      const [subtask] = subtasks;
      expect(subtask.dependencies).toEqual(["subtask_abc123"]);
    });

    it("should create subtask with priority and complexity", async () => {
      const result = await createSubtaskTool.execute(
        {
          title: "Refactor auth module",
          description: "Clean up authentication code",
          priority: "p1",
          estimated_complexity: "high",
        },
        mockContext
      );

      expect(result.type).toBe("success");

      const subtasks = await _getSubtasks();
      const [subtask] = subtasks;
      expect(subtask.priority).toBe("p1");
      expect(subtask.risk).toBe("high");
    });

    it("should validate required fields", () => {
      const parseResult = createSubtaskTool.inputSchema.safeParse({});
      expect(parseResult.success).toBe(false);
    });

    it("should validate title max length", () => {
      const longTitle = "a".repeat(100);
      const parseResult = createSubtaskTool.inputSchema.safeParse({
        title: longTitle,
        description: "Test",
      });
      expect(parseResult.success).toBe(false);
    });
  });

  describe("update_subtask", () => {
    it("should have correct metadata", () => {
      expect(updateSubtaskTool.name).toBe("update_subtask");
      expect(updateSubtaskTool.description).toContain("Update a subtask");
      expect(updateSubtaskTool.permission.scope).toBe("meta");
      expect(updateSubtaskTool.permission.readOnly).toBe(false);
    });

    it("should change status", async () => {
      // First create a subtask
      const createResult = await createSubtaskTool.execute(
        {
          title: "Fix bug",
          description: "Fix the login timeout",
        },
        mockContext
      );

      const subtaskId = (createResult as { metadata?: { subtaskId?: string } }).metadata?.subtaskId;
      expect(subtaskId).toBeTruthy();

      // Update status
      const result = await updateSubtaskTool.execute(
        {
          subtask_id: subtaskId!,
          status: "in_progress",
        },
        mockContext
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Status: backlog -> in_progress");
        expect(result.metadata?.status).toBe("in_progress");
      }

      // Verify storage
      const subtasks = await _getSubtasks();
      const subtask = subtasks.find((item) => item.id === subtaskId);
      expect(subtask?.status).toBe("in_progress");
    });

    it("should add notes", async () => {
      // Create subtask
      const createResult = await createSubtaskTool.execute(
        {
          title: "Write docs",
          description: "Document the API",
        },
        mockContext
      );

      const subtaskId = (createResult as { metadata?: { subtaskId?: string } }).metadata?.subtaskId;

      // Add notes
      const result = await updateSubtaskTool.execute(
        {
          subtask_id: subtaskId!,
          notes: "Completed API endpoints section",
        },
        mockContext
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Note added");
      }

      // Verify storage
      const subtasks = await _getSubtasks();
      const subtask = subtasks.find((item) => item.id === subtaskId);
      expect(subtask?.notes).toEqual(["Completed API endpoints section"]);
    });

    it("should return error for missing subtask", async () => {
      const result = await updateSubtaskTool.execute(
        {
          subtask_id: "nonexistent",
          status: "done",
        },
        mockContext
      );

      expect(result.type).toBe("error");
      if (result.type === "error") {
        expect(result.error).toContain("not found");
      }
    });

    it("should detect all siblings done", async () => {
      // Create two subtasks
      const sub1 = await createSubtaskTool.execute(
        { title: "Task 1", description: "First task" },
        mockContext
      );
      const sub2 = await createSubtaskTool.execute(
        { title: "Task 2", description: "Second task" },
        mockContext
      );

      const sub1Id = (sub1 as { metadata?: { subtaskId?: string } }).metadata?.subtaskId!;
      const sub2Id = (sub2 as { metadata?: { subtaskId?: string } }).metadata?.subtaskId!;

      // Mark first as done
      await updateSubtaskTool.execute(
        { subtask_id: sub1Id, status: "done" },
        mockContext
      );

      // Mark second as done
      const result = await updateSubtaskTool.execute(
        { subtask_id: sub2Id, status: "done" },
        mockContext
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("All subtasks for this ticket are now complete!");
        expect(result.metadata?.allSiblingsDone).toBe(true);
      }
    });

    it("should validate required fields", () => {
      const parseResult = updateSubtaskTool.inputSchema.safeParse({});
      expect(parseResult.success).toBe(false);
    });
  });

  describe("list_subtasks", () => {
    it("should have correct metadata", () => {
      expect(listSubtasksTool.name).toBe("list_subtasks");
      expect(listSubtasksTool.description).toContain("List all subtasks");
      expect(listSubtasksTool.permission.scope).toBe("meta");
      expect(listSubtasksTool.permission.readOnly).toBe(true);
    });

    it("should return active subtasks", async () => {
      // Create subtasks
      await createSubtaskTool.execute(
        { title: "Active task", description: "Active" },
        mockContext
      );

      const result = await listSubtasksTool.execute({}, mockContext);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Active task");
        expect(result.content).toContain("backlog");
        expect(result.metadata?.count).toBe(1);
      }
    });

    it("should include completed subtasks when requested", async () => {
      // Create and complete a subtask
      const createResult = await createSubtaskTool.execute(
        { title: "Done task", description: "Completed" },
        mockContext
      );

      const subtaskId = (createResult as { metadata?: { subtaskId?: string } }).metadata?.subtaskId!;
      await updateSubtaskTool.execute(
        { subtask_id: subtaskId, status: "done" },
        mockContext
      );

      // List without include_completed
      const result1 = await listSubtasksTool.execute({}, mockContext);
      expect(result1.type).toBe("success");
      if (result1.type === "success") {
        expect(result1.content).toContain("No active subtasks found");
      }

      // List with include_completed
      const result2 = await listSubtasksTool.execute(
        { include_completed: true },
        mockContext
      );
      expect(result2.type).toBe("success");
      if (result2.type === "success") {
        expect(result2.content).toContain("Done task");
        expect(result2.content).toContain("done");
      }
    });

    it("should show progress percentage", async () => {
      // Create 3 subtasks
      const sub1 = await createSubtaskTool.execute(
        { title: "Task 1", description: "First" },
        mockContext
      );
      const sub2 = await createSubtaskTool.execute(
        { title: "Task 2", description: "Second" },
        mockContext
      );
      await createSubtaskTool.execute(
        { title: "Task 3", description: "Third" },
        mockContext
      );

      // Complete 2 of them
      const sub1Id = (sub1 as { metadata?: { subtaskId?: string } }).metadata?.subtaskId!;
      const sub2Id = (sub2 as { metadata?: { subtaskId?: string } }).metadata?.subtaskId!;
      await updateSubtaskTool.execute({ subtask_id: sub1Id, status: "done" }, mockContext);
      await updateSubtaskTool.execute({ subtask_id: sub2Id, status: "done" }, mockContext);

      // List
      const result = await listSubtasksTool.execute(
        { include_completed: true },
        mockContext
      );

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Progress: 2/3 (67%)");
        expect(result.metadata?.totalCount).toBe(3);
        expect(result.metadata?.doneCount).toBe(2);
        expect(result.metadata?.progress).toBe(67);
      }
    });

    it("should detect blocked subtasks", async () => {
      // Create subtask with dependency
      const sub1 = await createSubtaskTool.execute(
        { title: "Blocker task", description: "Must complete first" },
        mockContext
      );
      const sub1Id = (sub1 as { metadata?: { subtaskId?: string } }).metadata?.subtaskId!;

      await createSubtaskTool.execute(
        {
          title: "Blocked task",
          description: "Depends on blocker",
          dependencies: [sub1Id],
        },
        mockContext
      );

      // List
      const result = await listSubtasksTool.execute({}, mockContext);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("BLOCKED by");
        expect(result.content).toContain(sub1Id);
      }
    });

    it("should return message when no subtasks exist", async () => {
      const result = await listSubtasksTool.execute({}, mockContext);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("No active subtasks found");
        expect(result.metadata?.count).toBe(0);
      }
    });

    it("should filter subtasks by parent ticket", async () => {
      // Create subtask for test-ticket
      await createSubtaskTool.execute(
        { title: "Task 1", description: "For test-ticket" },
        mockContext
      );

      // Create subtask for different ticket
      const otherContext = { ...mockContext, ticketId: "other-ticket" };
      await createSubtaskTool.execute(
        { title: "Task 2", description: "For other-ticket" },
        otherContext
      );

      // List for test-ticket
      const result = await listSubtasksTool.execute({}, mockContext);

      expect(result.type).toBe("success");
      if (result.type === "success") {
        expect(result.content).toContain("Task 1");
        expect(result.content).not.toContain("Task 2");
        expect(result.metadata?.count).toBe(1);
      }
    });
  });
});
