import { randomUUID } from "node:crypto";
import { prisma } from "../db";
import type { AgenticRunPlan } from "../../shared/contracts";

export interface PlanPersistence {
  getPlan(runId: string): Promise<AgenticRunPlan | null>;
  savePlan(plan: AgenticRunPlan): Promise<void>;
  removePlan(runId: string): Promise<void>;
}

export function createPrismaPlanPersistence(): PlanPersistence {
  return {
    async getPlan(runId) {
      const row = await prisma.runProjection.findUnique({
        where: { runId },
        select: { metadata: true },
      });
      const metadata = (row?.metadata ?? {}) as Record<string, unknown>;
      const plan = metadata.agenticPlan;
      return plan && typeof plan === "object" ? (plan as AgenticRunPlan) : null;
    },

    async savePlan(plan) {
      const row = await prisma.runProjection.findUnique({
        where: { runId: plan.runId },
        select: { metadata: true, ticketId: true, providerId: true, startedAt: true, status: true },
      });
      const metadata = {
        ...((row?.metadata ?? {}) as Record<string, unknown>),
        agenticPlan: plan,
        agenticPlanPhase: plan.phase,
      };

      await prisma.runProjection.upsert({
        where: { runId: plan.runId },
        update: {
          metadata,
        },
        create: {
          runId: plan.runId,
          ticketId: row?.ticketId ?? null,
          providerId: row?.providerId ?? null,
          status: row?.status ?? "running",
          startedAt: row?.startedAt ?? new Date(),
          metadata,
        },
      });
    },

    async removePlan(runId) {
      const row = await prisma.runProjection.findUnique({
        where: { runId },
        select: { metadata: true },
      });
      if (!row) {
        return;
      }
      const metadata = { ...((row.metadata ?? {}) as Record<string, unknown>) };
      delete metadata.agenticPlan;
      delete metadata.agenticPlanPhase;
      await prisma.runProjection.update({
        where: { runId },
        data: { metadata },
      });
    },
  };
}

export class PlanService {
  private readonly plans = new Map<string, AgenticRunPlan>();

  constructor(private readonly persistence?: PlanPersistence) {}

  async startPlanningPhase(runId: string): Promise<AgenticRunPlan> {
    const existing = await this.getPlan(runId);
    if (existing && (existing.phase === "planning" || existing.phase === "plan_review")) {
      return existing;
    }

    const now = new Date().toISOString();
    const plan: AgenticRunPlan = {
      runId,
      phase: "planning",
      planContent: existing?.planContent ?? null,
      questions: existing?.questions ?? [],
      approved: false,
      reviewedBy: null,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };

    this.plans.set(runId, plan);
    await this.persistence?.savePlan(plan);
    return plan;
  }

  async getPlan(runId: string): Promise<AgenticRunPlan | null> {
    const cached = this.plans.get(runId);
    if (cached) {
      return cached;
    }
    const persisted = await this.persistence?.getPlan(runId);
    if (persisted) {
      this.plans.set(runId, persisted);
      return persisted;
    }
    return null;
  }

  async submitPlan(runId: string, planContent: string): Promise<AgenticRunPlan> {
    const plan = await this.requirePlan(runId);
    if (plan.phase !== "planning") {
      throw new Error(`Plan is in phase "${plan.phase}", expected "planning"`);
    }

    const updated: AgenticRunPlan = {
      ...plan,
      planContent,
      phase: "plan_review",
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(runId, updated);
    await this.persistence?.savePlan(updated);
    return updated;
  }

  async askQuestion(runId: string, question: string): Promise<{ questionId: string }> {
    const plan = await this.requirePlan(runId);
    if (plan.phase !== "planning") {
      throw new Error("Questions can only be asked during planning phase");
    }

    const questionId = `q_${randomUUID().slice(0, 8)}`;
    const updated: AgenticRunPlan = {
      ...plan,
      questions: [
        ...plan.questions,
        {
          id: questionId,
          question,
          answer: null,
          askedAt: new Date().toISOString(),
          answeredAt: null,
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(runId, updated);
    await this.persistence?.savePlan(updated);
    return { questionId };
  }

  async answerQuestion(runId: string, questionId: string, answer: string): Promise<AgenticRunPlan> {
    const plan = await this.requirePlan(runId);
    const questions = plan.questions.map((question) =>
      question.id === questionId
        ? {
            ...question,
            answer,
            answeredAt: new Date().toISOString(),
          }
        : question,
    );

    if (!questions.some((question) => question.id === questionId)) {
      throw new Error(`Question ${questionId} not found`);
    }

    const updated: AgenticRunPlan = {
      ...plan,
      questions,
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(runId, updated);
    await this.persistence?.savePlan(updated);
    return updated;
  }

  async approvePlan(runId: string, reviewedBy: string): Promise<AgenticRunPlan> {
    const plan = await this.requirePlan(runId);
    if (plan.phase !== "plan_review") {
      throw new Error("Plan must be in review to approve");
    }

    const updated: AgenticRunPlan = {
      ...plan,
      approved: true,
      reviewedBy,
      phase: "executing",
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(runId, updated);
    await this.persistence?.savePlan(updated);
    return updated;
  }

  async rejectPlan(runId: string, _reason: string, reviewedBy: string): Promise<AgenticRunPlan> {
    const plan = await this.requirePlan(runId);
    if (plan.phase !== "plan_review") {
      throw new Error("Plan must be in review to reject");
    }

    const updated: AgenticRunPlan = {
      ...plan,
      approved: false,
      reviewedBy,
      phase: "failed",
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(runId, updated);
    await this.persistence?.savePlan(updated);
    return updated;
  }

  async refinePlan(runId: string, feedback: string): Promise<AgenticRunPlan> {
    const plan = await this.requirePlan(runId);
    if (plan.phase !== "plan_review") {
      throw new Error("Plan must be in review to refine");
    }

    const updated: AgenticRunPlan = {
      ...plan,
      phase: "planning",
      questions: [
        ...plan.questions,
        {
          id: `q_${randomUUID().slice(0, 8)}`,
          question: feedback,
          answer: null,
          askedAt: new Date().toISOString(),
          answeredAt: null,
        },
      ],
      updatedAt: new Date().toISOString(),
    };
    this.plans.set(runId, updated);
    await this.persistence?.savePlan(updated);
    return updated;
  }

  async removePlan(runId: string): Promise<void> {
    this.plans.delete(runId);
    await this.persistence?.removePlan(runId);
  }

  private async requirePlan(runId: string): Promise<AgenticRunPlan> {
    const plan = await this.getPlan(runId);
    if (!plan) {
      throw new Error(`No plan found for run ${runId}`);
    }
    return plan;
  }
}
