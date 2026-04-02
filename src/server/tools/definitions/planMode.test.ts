import { describe, it, expect, beforeEach, vi } from "vitest";
import { submitPlanTool, askPlanQuestionTool, getPlanService, setPlanService } from "./planMode";
import { PlanService } from "../../plans/planService";
import type { ToolContext } from "../types";

describe("Plan Mode Tools", () => {
  let mockContext: ToolContext;
  let planService: PlanService;
  const runId = "test-run-123";

  beforeEach(async () => {
    // Create a fresh plan service for each test
    planService = new PlanService();
    setPlanService(planService);

    // Start a planning phase
    await planService.startPlanningPhase(runId);

    // Mock context
    mockContext = {
      runId,
      repoId: "test-repo",
      ticketId: "test-ticket",
      worktreePath: "/test/path",
      actor: "test-actor",
      stage: "build",
      conversationHistory: [],
      createApproval: vi.fn(async (req) => ({ id: "approval-123" })),
      recordEvent: vi.fn(async () => {}),
    } as unknown as ToolContext;
  });

  describe("submitPlanTool", () => {
    it("should have correct metadata", () => {
      expect(submitPlanTool.name).toBe("submit_plan");
      expect(submitPlanTool.description).toContain("implementation plan");
      expect(submitPlanTool.permission.scope).toBe("meta");
      expect(submitPlanTool.alwaysLoad).toBe(false);
      expect(submitPlanTool.concurrencySafe).toBe(true);
      expect(submitPlanTool.searchHints).toContain("plan");
    });

    it("should submit a valid plan", async () => {
      const plan = `# Implementation Plan

## Summary
Build a new feature

## Files to modify
- src/index.ts
- src/config.ts

## Approach
1. Update configuration
2. Implement feature

## Risks
- Breaking changes

## Verification
- Run tests
`;

      const result = await submitPlanTool.execute({ plan }, mockContext);

      expect(result.type).toBe("success");
      expect(result).toHaveProperty("content");
      expect(result).toHaveProperty("metadata");
      expect(mockContext.recordEvent).toHaveBeenCalledWith({
        type: "plan_submitted",
        payload: { planContent: plan },
      });

      // Verify plan state changed
      const storedPlan = await planService.getPlan(runId);
      expect(storedPlan?.phase).toBe("plan_review");
      expect(storedPlan?.planContent).toBe(plan);
    });

    it("should reject plan that is too short", async () => {
      const input = { plan: "short" };

      // This should fail validation from Zod schema
      const parseResult = submitPlanTool.inputSchema.safeParse(input);
      expect(parseResult.success).toBe(false);
    });

    it("should return error if no plan exists for runId", async () => {
      const badContext = { ...mockContext, runId: "non-existent" };
      const result = await submitPlanTool.execute(
        { plan: "Valid plan with enough content" },
        badContext
      );

      expect(result.type).toBe("error");
      expect(result.error).toContain("No plan found");
    });

    it("should return error if plan is not in planning phase", async () => {
      // Submit once to move to review
      await submitPlanTool.execute(
        { plan: "First plan submission" },
        mockContext
      );

      // Try to submit again
      const result = await submitPlanTool.execute(
        { plan: "Second plan submission" },
        mockContext
      );

      expect(result.type).toBe("error");
      expect(result.error).toContain("expected \"planning\"");
    });
  });

  describe("askPlanQuestionTool", () => {
    it("should have correct metadata", () => {
      expect(askPlanQuestionTool.name).toBe("ask_plan_question");
      expect(askPlanQuestionTool.description).toContain("clarifying question");
      expect(askPlanQuestionTool.permission.scope).toBe("meta");
      expect(askPlanQuestionTool.permission.readOnly).toBe(true);
      expect(askPlanQuestionTool.alwaysLoad).toBe(false);
      expect(askPlanQuestionTool.concurrencySafe).toBe(true);
      expect(askPlanQuestionTool.searchHints).toContain("question");
    });

    it("should ask a question and create approval", async () => {
      const question = "What technology stack should we use?";
      const result = await askPlanQuestionTool.execute({ question }, mockContext);

      expect(result.type).toBe("approval_required");
      expect(result.approvalId).toBe("approval-123");
      expect(result.message).toBe(question);

      // Verify approval was created
      expect(mockContext.createApproval).toHaveBeenCalledWith({
        actionType: "plan_question",
        payload: expect.objectContaining({
          question,
          runId,
        }),
      });

      // Verify event was recorded
      expect(mockContext.recordEvent).toHaveBeenCalledWith({
        type: "plan_question_asked",
        payload: expect.objectContaining({
          question,
        }),
      });

      // Verify question was added to plan
      const plan = await planService.getPlan(runId);
      expect(plan?.questions).toHaveLength(1);
      expect(plan?.questions[0].question).toBe(question);
    });

    it("should reject empty question", async () => {
      const input = { question: "" };

      const parseResult = askPlanQuestionTool.inputSchema.safeParse(input);
      expect(parseResult.success).toBe(false);
    });

    it("should return error if no plan exists for runId", async () => {
      const badContext = { ...mockContext, runId: "non-existent" };
      const result = await askPlanQuestionTool.execute(
        { question: "Valid question?" },
        badContext
      );

      expect(result.type).toBe("error");
      expect(result.error).toContain("No plan found");
    });

    it("should return error if plan is not in planning phase", async () => {
      // Submit plan to move to review
      await planService.submitPlan(runId, "Plan content");

      const result = await askPlanQuestionTool.execute(
        { question: "Can I still ask?" },
        mockContext
      );

      expect(result.type).toBe("error");
      expect(result.error).toContain("Questions can only be asked during planning phase");
    });

    it("should allow multiple questions", async () => {
      await askPlanQuestionTool.execute({ question: "Question 1?" }, mockContext);
      await askPlanQuestionTool.execute({ question: "Question 2?" }, mockContext);
      await askPlanQuestionTool.execute({ question: "Question 3?" }, mockContext);

      const plan = await planService.getPlan(runId);
      expect(plan?.questions).toHaveLength(3);
      expect(plan?.questions[0].question).toBe("Question 1?");
      expect(plan?.questions[1].question).toBe("Question 2?");
      expect(plan?.questions[2].question).toBe("Question 3?");
    });
  });

  describe("Integration workflow", () => {
    it("should support asking questions and then submitting plan", async () => {
      // 1. Ask a question
      const questionResult = await askPlanQuestionTool.execute(
        { question: "What should be the scope?" },
        mockContext
      );
      expect(questionResult.type).toBe("approval_required");

      // 2. Answer the question (simulated)
      const plan = await planService.getPlan(runId);
      const questionId = plan?.questions[0].id;
      if (questionId) {
        await planService.answerQuestion(runId, questionId, "Build a status badge");
      }

      // 3. Submit plan
      const submitResult = await submitPlanTool.execute(
        { plan: "# Plan\n\nBuild status badge based on user input" },
        mockContext
      );
      expect(submitResult.type).toBe("success");

      // Verify final state
      const finalPlan = await planService.getPlan(runId);
      expect(finalPlan?.phase).toBe("plan_review");
      expect(finalPlan?.questions[0].answer).toBe("Build a status badge");
    });
  });

  describe("getPlanService", () => {
    it("should return singleton instance", () => {
      const service1 = getPlanService();
      const service2 = getPlanService();
      expect(service1).toBe(service2);
    });

    it("should allow overriding with setPlanService", () => {
      const customService = new PlanService();
      setPlanService(customService);
      const retrieved = getPlanService();
      expect(retrieved).toBe(customService);
    });
  });
});
