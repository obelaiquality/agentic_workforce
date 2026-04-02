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
});
