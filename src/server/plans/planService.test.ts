import { beforeEach, describe, expect, it } from "vitest";
import { PlanService, type PlanPersistence } from "./planService";

function createMemoryPersistence(): PlanPersistence & {
  plans: Map<string, any>;
} {
  return {
    plans: new Map(),
    async getPlan(runId) {
      return this.plans.get(runId) ?? null;
    },
    async savePlan(plan) {
      this.plans.set(plan.runId, { ...plan });
    },
    async removePlan(runId) {
      this.plans.delete(runId);
    },
  };
}

describe("PlanService", () => {
  let persistence: ReturnType<typeof createMemoryPersistence>;
  let service: PlanService;
  const runId = "test-run-123";

  beforeEach(() => {
    persistence = createMemoryPersistence();
    service = new PlanService(persistence);
  });

  it("starts a planning phase and allows retrieval", async () => {
    const plan = await service.startPlanningPhase(runId);

    expect(plan.runId).toBe(runId);
    expect(plan.phase).toBe("planning");
    expect(plan.planContent).toBeNull();
    expect(plan.questions).toEqual([]);
    expect(plan.approved).toBe(false);
    expect(await service.getPlan(runId)).toMatchObject({ runId, phase: "planning" });
  });

  it("submits a plan and transitions to review", async () => {
    await service.startPlanningPhase(runId);

    const plan = await service.submitPlan(runId, "# Plan\n\nImplement the feature.");

    expect(plan.phase).toBe("plan_review");
    expect(plan.planContent).toContain("Implement the feature");
  });

  it("tracks questions and answers", async () => {
    await service.startPlanningPhase(runId);

    const { questionId } = await service.askQuestion(runId, "What framework should we use?");
    const answered = await service.answerQuestion(runId, questionId, "React");

    expect(answered.questions).toHaveLength(1);
    expect(answered.questions[0]).toMatchObject({
      id: questionId,
      question: "What framework should we use?",
      answer: "React",
    });
  });

  it("approves, rejects, and refines only from review", async () => {
    await service.startPlanningPhase(runId);
    await service.submitPlan(runId, "# Plan\n\nShip it.");

    const approved = await service.approvePlan(runId, "user@example.com");
    expect(approved.phase).toBe("executing");
    expect(approved.approved).toBe(true);

    await service.removePlan(runId);
    await service.startPlanningPhase(runId);
    await service.submitPlan(runId, "# Plan\n\nShip it.");

    const rejected = await service.rejectPlan(runId, "Needs more detail", "user@example.com");
    expect(rejected.phase).toBe("failed");
    expect(rejected.approved).toBe(false);

    await service.removePlan(runId);
    await service.startPlanningPhase(runId);
    await service.submitPlan(runId, "# Plan\n\nShip it.");

    const refined = await service.refinePlan(runId, "Add rollback details");
    expect(refined.phase).toBe("planning");
    expect(refined.questions.at(-1)?.question).toBe("Add rollback details");
  });

  it("persists plans across service instances", async () => {
    await service.startPlanningPhase(runId);
    await service.askQuestion(runId, "Need clarification?");
    await service.submitPlan(runId, "# Plan\n\nPersistent plan.");

    const reloaded = new PlanService(persistence);
    const restored = await reloaded.getPlan(runId);

    expect(restored).not.toBeNull();
    expect(restored?.phase).toBe("plan_review");
    expect(restored?.questions).toHaveLength(1);
    expect(restored?.planContent).toContain("Persistent plan");
  });

  it("throws for invalid state transitions or missing data", async () => {
    await expect(service.submitPlan("missing", "plan")).rejects.toThrow("No plan found");

    await service.startPlanningPhase(runId);
    await service.submitPlan(runId, "# Plan\n\nShip it.");

    await expect(service.askQuestion(runId, "Can I still ask?")).rejects.toThrow(
      "Questions can only be asked during planning phase",
    );
    await expect(service.submitPlan(runId, "# Plan\n\nAgain")).rejects.toThrow(
      'Plan is in phase "plan_review", expected "planning"',
    );
    await expect(service.answerQuestion(runId, "missing-question", "answer")).rejects.toThrow(
      "Question missing-question not found",
    );
  });

  it("startPlanningPhase returns existing plan if already in planning", async () => {
    const first = await service.startPlanningPhase(runId);
    const second = await service.startPlanningPhase(runId);

    expect(second.runId).toBe(first.runId);
    expect(second.phase).toBe("planning");
    expect(second.createdAt).toBe(first.createdAt);
  });

  it("startPlanningPhase returns existing plan if in plan_review", async () => {
    await service.startPlanningPhase(runId);
    await service.submitPlan(runId, "# Review me");

    const plan = await service.startPlanningPhase(runId);
    expect(plan.phase).toBe("plan_review");
  });

  it("startPlanningPhase re-creates plan after removal", async () => {
    await service.startPlanningPhase(runId);
    await service.submitPlan(runId, "# Plan 1");
    await service.approvePlan(runId, "user@example.com");

    // Now plan is in 'executing' phase
    // Start planning again should create a new plan preserving some fields
    const plan = await service.startPlanningPhase(runId);
    expect(plan.phase).toBe("planning");
  });

  it("removePlan clears plan from memory and persistence", async () => {
    await service.startPlanningPhase(runId);

    await service.removePlan(runId);

    const plan = await service.getPlan(runId);
    expect(plan).toBeNull();
    expect(persistence.plans.has(runId)).toBe(false);
  });

  it("removePlan is safe to call for non-existent plan", async () => {
    await service.removePlan("nonexistent-run-id");
    // Should not throw
    expect(true).toBe(true);
  });

  it("approvePlan throws if not in review phase", async () => {
    await service.startPlanningPhase(runId);
    // Plan is in 'planning' phase, not 'plan_review'
    await expect(service.approvePlan(runId, "user")).rejects.toThrow(
      "Plan must be in review to approve",
    );
  });

  it("rejectPlan throws if not in review phase", async () => {
    await service.startPlanningPhase(runId);
    await expect(service.rejectPlan(runId, "bad plan", "user")).rejects.toThrow(
      "Plan must be in review to reject",
    );
  });

  it("refinePlan throws if not in review phase", async () => {
    await service.startPlanningPhase(runId);
    await expect(service.refinePlan(runId, "feedback")).rejects.toThrow(
      "Plan must be in review to refine",
    );
  });

  it("getPlan returns null for unknown runId", async () => {
    const plan = await service.getPlan("unknown-run-id");
    expect(plan).toBeNull();
  });

  it("works without persistence (in-memory only)", async () => {
    const memService = new PlanService();

    const plan = await memService.startPlanningPhase("mem-run");
    expect(plan.phase).toBe("planning");

    await memService.submitPlan("mem-run", "# Memory only plan");
    const submitted = await memService.getPlan("mem-run");
    expect(submitted?.phase).toBe("plan_review");

    await memService.approvePlan("mem-run", "reviewer");
    const approved = await memService.getPlan("mem-run");
    expect(approved?.phase).toBe("executing");

    await memService.removePlan("mem-run");
    const removed = await memService.getPlan("mem-run");
    expect(removed).toBeNull();
  });

  it("answerQuestion updates the correct question", async () => {
    await service.startPlanningPhase(runId);

    const q1 = await service.askQuestion(runId, "Question 1?");
    const q2 = await service.askQuestion(runId, "Question 2?");

    const answered = await service.answerQuestion(runId, q2.questionId, "Answer 2");

    expect(answered.questions).toHaveLength(2);
    expect(answered.questions[0]!.answer).toBeNull();
    expect(answered.questions[1]!.answer).toBe("Answer 2");
    expect(answered.questions[1]!.answeredAt).not.toBeNull();
  });

  it("refinePlan adds feedback as a question and returns to planning", async () => {
    await service.startPlanningPhase(runId);
    await service.submitPlan(runId, "# Plan\n\nDo stuff.");

    const refined = await service.refinePlan(runId, "Please add error handling");

    expect(refined.phase).toBe("planning");
    expect(refined.questions.length).toBeGreaterThan(0);
    const lastQuestion = refined.questions.at(-1);
    expect(lastQuestion?.question).toBe("Please add error handling");
    expect(lastQuestion?.answer).toBeNull();
  });

  it("rejectPlan sets approved=false and phase=failed with reviewedBy", async () => {
    await service.startPlanningPhase(runId);
    await service.submitPlan(runId, "# Plan\n\nBad plan.");

    const rejected = await service.rejectPlan(runId, "Too risky", "reviewer@co.com");

    expect(rejected.phase).toBe("failed");
    expect(rejected.approved).toBe(false);
    expect(rejected.reviewedBy).toBe("reviewer@co.com");
  });

  it("getPlan returns persisted plan even if not in memory cache", async () => {
    // Write directly to persistence, bypassing the in-memory cache
    const plan = {
      runId: "persisted-only",
      phase: "executing" as const,
      planContent: "# Direct write",
      questions: [],
      approved: true,
      reviewedBy: "admin",
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    await persistence.savePlan(plan);

    // Create a new service instance that has no memory cache for this plan
    const freshService = new PlanService(persistence);
    const retrieved = await freshService.getPlan("persisted-only");

    expect(retrieved).not.toBeNull();
    expect(retrieved?.phase).toBe("executing");
    expect(retrieved?.planContent).toBe("# Direct write");
  });

  it("startPlanningPhase preserves existing planContent and questions when re-entering planning", async () => {
    await service.startPlanningPhase(runId);
    await service.askQuestion(runId, "What framework?");
    await service.submitPlan(runId, "# Plan v1");
    await service.approvePlan(runId, "user");

    // Plan is now in 'executing' phase. Re-enter planning.
    const plan = await service.startPlanningPhase(runId);

    expect(plan.phase).toBe("planning");
    // Should preserve planContent and questions from the previous plan
    expect(plan.planContent).toBe("# Plan v1");
    expect(plan.questions).toHaveLength(1);
    expect(plan.questions[0].question).toBe("What framework?");
  });

  it("answerQuestion throws if question not found in plan", async () => {
    await service.startPlanningPhase(runId);
    await service.askQuestion(runId, "Real question?");

    await expect(service.answerQuestion(runId, "nonexistent-id", "an answer")).rejects.toThrow(
      "Question nonexistent-id not found",
    );
  });

  it("requirePlan throws when plan does not exist", async () => {
    await expect(service.submitPlan("no-such-run", "content")).rejects.toThrow(
      "No plan found for run no-such-run",
    );
    await expect(service.askQuestion("no-such-run", "q")).rejects.toThrow(
      "No plan found for run no-such-run",
    );
    await expect(service.answerQuestion("no-such-run", "q1", "a")).rejects.toThrow(
      "No plan found for run no-such-run",
    );
    await expect(service.approvePlan("no-such-run", "user")).rejects.toThrow(
      "No plan found for run no-such-run",
    );
    await expect(service.rejectPlan("no-such-run", "reason", "user")).rejects.toThrow(
      "No plan found for run no-such-run",
    );
    await expect(service.refinePlan("no-such-run", "feedback")).rejects.toThrow(
      "No plan found for run no-such-run",
    );
  });
});
