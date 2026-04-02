import { z } from "zod";
import type { ToolDefinition, ToolContext } from "../types";
import { PlanService } from "../../plans/planService";

// ---------------------------------------------------------------------------
// Singleton Plan Service
// ---------------------------------------------------------------------------

let _planService: PlanService | null = null;

export function getPlanService(): PlanService {
  if (!_planService) {
    _planService = new PlanService();
  }
  return _planService;
}

export function setPlanService(service: PlanService): void {
  _planService = service;
}

// ---------------------------------------------------------------------------
// 1. submit_plan — Submit implementation plan for review
// ---------------------------------------------------------------------------

const submitPlanSchema = z.object({
  plan: z.string().min(10).describe("Markdown-formatted implementation plan. Include: Summary, Files to modify, Approach, Risks, Verification steps."),
});

export const submitPlanTool: ToolDefinition<z.infer<typeof submitPlanSchema>> = {
  name: "submit_plan",
  description: "Submit your implementation plan for user review. The plan should be a structured markdown document covering what files will be modified, the approach, risks, and how to verify. Execution will pause until the user approves.",
  inputSchema: submitPlanSchema,
  permission: { scope: "meta", readOnly: false },
  alwaysLoad: false, // Only loaded during plan mode
  concurrencySafe: true,
  searchHints: ["plan", "submit", "proposal", "review"],

  async execute(input, ctx) {
    const service = getPlanService();

    try {
      await service.submitPlan(ctx.runId, input.plan);

      await ctx.recordEvent({
        type: "plan_submitted",
        payload: { planContent: input.plan },
      });

      return {
        type: "success",
        content: "Plan submitted for review. Execution is paused until the user approves, rejects, or requests changes.",
        metadata: { runId: ctx.runId, planLength: input.plan.length },
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { type: "error", error: `Failed to submit plan: ${message}` };
    }
  },
};

// ---------------------------------------------------------------------------
// 2. ask_plan_question — Ask clarifying question during planning
// ---------------------------------------------------------------------------

const askPlanQuestionSchema = z.object({
  question: z.string().min(1).describe("A clear, specific question for the user to answer before you can finalize the plan."),
});

export const askPlanQuestionTool: ToolDefinition<z.infer<typeof askPlanQuestionSchema>> = {
  name: "ask_plan_question",
  description: "Ask the user a clarifying question during planning. Use when you need more context about requirements, constraints, or preferences before building the plan. The question will be shown in the plan review panel.",
  inputSchema: askPlanQuestionSchema,
  permission: { scope: "meta", readOnly: true },
  alwaysLoad: false, // Only loaded during plan mode
  concurrencySafe: true,
  searchHints: ["ask", "question", "clarify", "plan"],

  async execute(input, ctx) {
    const service = getPlanService();

    try {
      const { questionId } = await service.askQuestion(ctx.runId, input.question);

      await ctx.recordEvent({
        type: "plan_question_asked",
        payload: { questionId, question: input.question },
      });

      // Create an approval request so the UI can show the question
      const approval = await ctx.createApproval({
        actionType: "plan_question",
        payload: {
          questionId,
          question: input.question,
          runId: ctx.runId,
        },
      });

      return {
        type: "approval_required",
        approvalId: approval.id,
        message: input.question,
      };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return { type: "error", error: `Failed to ask question: ${message}` };
    }
  },
};

export const planModeTools: ToolDefinition[] = [submitPlanTool, askPlanQuestionTool];
