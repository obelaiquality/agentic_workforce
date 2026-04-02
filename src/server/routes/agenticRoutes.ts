import { randomUUID } from "node:crypto";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { eventBus, publishEvent } from "../eventBus";
import type { ExecutionService } from "../services/executionService";
import type { PlanService } from "../plans/planService";
import type { RepoService } from "../services/repoService";
import type { TicketService } from "../services/ticketService";
import type { ToolRegistry } from "../tools/registry";
import type { AgenticEvent, AgenticExecutionInput } from "../tools/types";
import { buildStreamHeaders } from "./shared/http";
import { syncTaskProjectionFromTicket } from "./shared/ticketProjection";

const agenticExecuteSchema = z.object({
  actor: z.string().min(1),
  project_id: z.string().min(1),
  ticket_id: z.string().optional(),
  objective: z.string().min(1),
  max_iterations: z.number().int().positive().optional(),
  initial_model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]).optional(),
  use_deferred_tools: z.boolean().optional(),
  plan_mode: z.boolean().optional(),
  budget: z.object({
    max_tokens: z.number().int().positive().optional(),
    max_cost_usd: z.number().positive().optional(),
    max_duration_ms: z.number().int().positive().optional(),
  }).optional(),
});

const agenticRunParamsSchema = z.object({
  id: z.string().min(1),
});

const planAnswerSchema = z.object({
  questionId: z.string().min(1),
  answer: z.string().min(1),
});

const planFeedbackSchema = z.object({
  feedback: z.string().min(1),
});

const planRejectSchema = z.object({
  reason: z.string().min(1),
});

type AgenticExecuteInput = z.infer<typeof agenticExecuteSchema>;

interface AgenticRouteDeps {
  app: FastifyInstance;
  toolRegistry: ToolRegistry;
  executionService: ExecutionService;
  repoService: RepoService;
  ticketService: TicketService;
  planService: PlanService;
}

type PreparedExecution = Awaited<ReturnType<typeof prepareAgenticExecution>>;

function toRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function toEventPayload(input: {
  runId: string;
  projectId: string;
  ticketId: string;
  event: AgenticEvent;
}) {
  return {
    runId: input.runId,
    run_id: input.runId,
    projectId: input.projectId,
    project_id: input.projectId,
    ticketId: input.ticketId,
    ticket_id: input.ticketId,
    event: input.event,
    event_type: input.event.type,
  };
}

function shouldPersistEvent(event: AgenticEvent) {
  return event.type !== "assistant_token" && event.type !== "assistant_thinking";
}

async function ensureAgenticTicket(ticketService: TicketService, repoId: string, objective: string, ticketId?: string) {
  if (ticketId) {
    const existing = await ticketService.getTicket(ticketId);
    if (existing) {
      return existing;
    }
  }

  const title = objective.split("\n")[0].trim().slice(0, 96) || "Agentic objective";
  return ticketService.createTicket({
    repoId,
    title,
    description: objective,
    status: "backlog",
    priority: "p2",
    risk: "medium",
    acceptanceCriteria: [
      "Implement the requested change.",
      "Verify impacted behavior before handing off.",
      "Leave enough tracking detail for follow-up review.",
    ],
  });
}

async function upsertAgenticRunProjection(input: {
  runId: string;
  ticketId: string;
  status: string;
  providerId: string | null;
  metadata: Record<string, unknown>;
}) {
  await prisma.runProjection.upsert({
    where: { runId: input.runId },
    update: {
      ticketId: input.ticketId,
      status: input.status,
      providerId: input.providerId,
      metadata: input.metadata,
      endedAt: ["completed", "failed", "aborted"].includes(input.status) ? new Date() : null,
    },
    create: {
      runId: input.runId,
      ticketId: input.ticketId,
      status: input.status,
      providerId: input.providerId,
      startedAt: new Date(),
      metadata: input.metadata,
    },
  });
}

async function prepareAgenticExecution(input: AgenticExecuteInput, deps: {
  repoService: RepoService;
  ticketService: TicketService;
}) {
  const repo = await deps.repoService.getRepo(input.project_id);
  if (!repo) {
    throw new Error(`Project not found: ${input.project_id}`);
  }

  let ticket = await ensureAgenticTicket(deps.ticketService, repo.id, input.objective, input.ticket_id);
  if (ticket.status !== "in_progress") {
    ticket = await deps.ticketService.moveTicket(ticket.id, "in_progress");
  }
  await syncTaskProjectionFromTicket(ticket);

  const runId = `agentic_${randomUUID()}`;
  const worktreePath = await deps.repoService.getActiveWorktreePath(repo.id);

  await deps.repoService.activateRepo({
    actor: input.actor,
    repo_id: repo.id,
    state: {
      selectedTicketId: ticket.id,
      selectedRunId: runId,
    },
  });

  const executionInput: AgenticExecutionInput = {
    runId,
    repoId: repo.id,
    ticketId: ticket.id,
    projectId: repo.id,
    objective: input.objective,
    worktreePath,
    actor: input.actor,
    maxIterations: input.max_iterations,
    initialModelRole: input.initial_model_role,
    providerId: input.provider_id,
    useDeferredTools: input.use_deferred_tools ?? true,
    planMode: input.plan_mode ?? false,
    budget: input.budget
      ? {
          maxTokens: input.budget.max_tokens,
          maxCostUsd: input.budget.max_cost_usd,
          maxDurationMs: input.budget.max_duration_ms,
        }
      : undefined,
  };

  const metadata = {
    repo_id: repo.id,
    project_id: repo.id,
    ticket_id: ticket.id,
    objective: input.objective,
    worktree_path: worktreePath,
    model_role: input.initial_model_role ?? "coder_default",
    provider_id: input.provider_id ?? null,
    execution_mode: "single_agent",
    verification_depth: "standard",
    use_deferred_tools: executionInput.useDeferredTools,
    plan_mode: executionInput.planMode,
    budget: executionInput.budget ?? null,
  } satisfies Record<string, unknown>;

  await upsertAgenticRunProjection({
    runId,
    ticketId: ticket.id,
    status: "running",
    providerId: input.provider_id ?? null,
    metadata,
  });

  return {
    repo,
    ticket,
    worktreePath,
    runId,
    executionInput,
    projectionMetadata: metadata,
  };
}

async function loadPreparedAgenticRun(input: {
  runId: string;
  actor?: string;
  repoService: RepoService;
  ticketService: TicketService;
  overrides?: Partial<Pick<AgenticExecutionInput, "planMode" | "systemPromptSuffix">>;
}): Promise<PreparedExecution> {
  const row = await prisma.runProjection.findUnique({
    where: { runId: input.runId },
  });
  if (!row) {
    throw new Error(`Run not found: ${input.runId}`);
  }
  if (!row.ticketId) {
    throw new Error(`Run ${input.runId} is missing a ticket binding`);
  }

  const metadata = toRecord(row.metadata);
  const repoId = typeof metadata.repo_id === "string" ? metadata.repo_id : typeof metadata.project_id === "string" ? metadata.project_id : null;
  const objective = typeof metadata.objective === "string" ? metadata.objective : null;
  const worktreePath = typeof metadata.worktree_path === "string" ? metadata.worktree_path : null;

  if (!repoId || !objective || !worktreePath) {
    throw new Error(`Run ${input.runId} is missing execution metadata`);
  }

  const [repo, ticket] = await Promise.all([
    input.repoService.getRepo(repoId),
    input.ticketService.getTicket(row.ticketId),
  ]);
  if (!repo || !ticket) {
    throw new Error(`Run ${input.runId} could not resolve its project or ticket`);
  }

  const budget = toRecord(metadata.budget);
  const executionInput: AgenticExecutionInput = {
    runId: input.runId,
    repoId: repo.id,
    projectId: repo.id,
    ticketId: ticket.id,
    objective,
    worktreePath,
    actor: input.actor || "user",
    initialModelRole:
      metadata.model_role === "utility_fast" ||
      metadata.model_role === "coder_default" ||
      metadata.model_role === "review_deep" ||
      metadata.model_role === "overseer_escalation"
        ? metadata.model_role
        : undefined,
    providerId:
      metadata.provider_id === "qwen-cli" ||
      metadata.provider_id === "openai-compatible" ||
      metadata.provider_id === "onprem-qwen" ||
      metadata.provider_id === "openai-responses"
        ? metadata.provider_id
        : undefined,
    useDeferredTools: metadata.use_deferred_tools !== false,
    planMode: input.overrides?.planMode ?? (metadata.plan_mode === true),
    systemPromptSuffix: input.overrides?.systemPromptSuffix,
    budget: {
      maxTokens: typeof budget.maxTokens === "number" ? budget.maxTokens : undefined,
      maxCostUsd: typeof budget.maxCostUsd === "number" ? budget.maxCostUsd : undefined,
      maxDurationMs: typeof budget.maxDurationMs === "number" ? budget.maxDurationMs : undefined,
    },
  };

  return {
    repo,
    ticket,
    worktreePath,
    runId: input.runId,
    executionInput,
    projectionMetadata: metadata,
  };
}

async function handleAgenticEvent(input: {
  event: AgenticEvent;
  runId: string;
  projectId: string;
  ticketId: string;
  providerId: string | null;
  projectionMetadata: Record<string, unknown>;
  ticketService: TicketService;
}) {
  const payload = toEventPayload({
    runId: input.runId,
    projectId: input.projectId,
    ticketId: input.ticketId,
    event: input.event,
  });

  if (shouldPersistEvent(input.event)) {
    await prisma.runEvent.create({
      data: {
        runId: input.runId,
        kind: input.event.type,
        payload,
      },
    });
  }

  publishEvent(`agentic:${input.runId}`, `agentic.${input.event.type}`, payload);

  const currentRow = await prisma.runProjection.findUnique({
    where: { runId: input.runId },
    select: { metadata: true },
  });
  const currentMetadata = {
    ...(currentRow?.metadata as Record<string, unknown> | null),
    ...input.projectionMetadata,
  };

  if (input.event.type === "plan_started") {
    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "running",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        agentic_plan_phase: "planning",
      },
    });
    return;
  }

  if (input.event.type === "plan_submitted") {
    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "running",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        agentic_plan_phase: "plan_review",
        last_plan_content: input.event.planContent,
      },
    });
    return;
  }

  if (input.event.type === "plan_question_asked") {
    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "running",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        agentic_plan_phase: "planning",
        last_plan_question_id: input.event.questionId,
        last_plan_question: input.event.question,
      },
    });
    return;
  }

  if (input.event.type === "plan_question_answered" || input.event.type === "plan_refine_requested") {
    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "running",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        agentic_plan_phase: "planning",
      },
    });
    return;
  }

  if (input.event.type === "plan_approved") {
    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "running",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        agentic_plan_phase: "executing",
        plan_reviewed_by: input.event.reviewedBy,
      },
    });
    return;
  }

  if (input.event.type === "plan_rejected") {
    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "failed",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        agentic_plan_phase: "failed",
        last_error: input.event.reason,
        plan_reviewed_by: input.event.reviewedBy,
      },
    });
    return;
  }

  if (input.event.type === "execution_complete") {
    const refreshedTicket = await input.ticketService.getTicket(input.ticketId);
    if (refreshedTicket && refreshedTicket.status !== "review" && refreshedTicket.status !== "done") {
      const moved = await input.ticketService.moveTicket(input.ticketId, "review");
      await syncTaskProjectionFromTicket(moved);
    }

    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "completed",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        agentic_plan_phase: "completed",
        final_message: input.event.finalMessage,
        total_iterations: input.event.totalIterations,
        total_tool_calls: input.event.totalToolCalls,
      },
    });
    return;
  }

  if (input.event.type === "execution_aborted") {
    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "aborted",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        abort_reason: input.event.reason,
      },
    });
    return;
  }

  if (input.event.type === "error" && input.event.recoverable === false) {
    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "failed",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        last_error: input.event.error,
      },
    });
    return;
  }

  if (input.event.type === "tool_approval_needed") {
    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "running",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        last_approval_id: input.event.approvalId,
      },
    });
    return;
  }

  if (input.event.type === "memory_extracted") {
    await upsertAgenticRunProjection({
      runId: input.runId,
      ticketId: input.ticketId,
      status: "running",
      providerId: input.providerId,
      metadata: {
        ...currentMetadata,
        last_memory_id: input.event.memoryId,
      },
    });
  }
}

async function executeAgenticRun(input: {
  toolRegistry: ToolRegistry;
  executionService: ExecutionService;
  ticketService: TicketService;
  prepared: PreparedExecution;
}) {
  for await (const event of input.executionService.executeAgentic(input.toolRegistry, input.prepared.executionInput)) {
    await handleAgenticEvent({
      event,
      runId: input.prepared.runId,
      projectId: input.prepared.repo.id,
      ticketId: input.prepared.ticket.id,
      providerId: input.prepared.executionInput.providerId ?? null,
      projectionMetadata: input.prepared.projectionMetadata,
      ticketService: input.ticketService,
    });
  }
}

export function registerAgenticRoutes(deps: AgenticRouteDeps) {
  const { app, toolRegistry, executionService, repoService, ticketService, planService } = deps;

  app.post<{ Body: AgenticExecuteInput }>("/api/agentic/start", async (request, reply) => {
    const parsed = agenticExecuteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues,
      });
    }

    const prepared = await prepareAgenticExecution(parsed.data, {
      repoService,
      ticketService,
    });

    void executeAgenticRun({
      toolRegistry,
      executionService,
      ticketService,
      prepared,
    }).catch(async (error) => {
      const message = error instanceof Error ? error.message : String(error);
      await upsertAgenticRunProjection({
        runId: prepared.runId,
        ticketId: prepared.ticket.id,
        status: "failed",
        providerId: prepared.executionInput.providerId ?? null,
        metadata: {
          ...prepared.projectionMetadata,
          last_error: message,
        },
      });
      publishEvent(`agentic:${prepared.runId}`, "agentic.error", {
        runId: prepared.runId,
        run_id: prepared.runId,
        projectId: prepared.repo.id,
        project_id: prepared.repo.id,
        ticketId: prepared.ticket.id,
        ticket_id: prepared.ticket.id,
        event: {
          type: "error",
          error: message,
          recoverable: false,
        } satisfies AgenticEvent,
      });
    });

    return {
      runId: prepared.runId,
      ticket: prepared.ticket,
      projectId: prepared.repo.id,
      worktreePath: prepared.worktreePath,
    };
  });

  app.get("/api/agentic/runs/:id/stream", async (request, reply) => {
    const params = agenticRunParamsSchema.parse(request.params);

    reply.hijack();
    reply.raw.writeHead(200, buildStreamHeaders(typeof request.headers.origin === "string" ? request.headers.origin : null));

    const send = (eventName: string, payload: unknown) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    const existingEvents = await prisma.runEvent.findMany({
      where: { runId: params.id },
      orderBy: { createdAt: "asc" },
      take: 200,
    });
    for (const row of existingEvents) {
      send("agentic", row.payload);
    }

    send("connected", {
      runId: params.id,
      now: new Date().toISOString(),
    });

    const unsubscribe = eventBus.subscribe(`agentic:${params.id}`, (event) => {
      send("agentic", event.payload);
    });

    const heartbeat = setInterval(() => {
      send("heartbeat", { runId: params.id, now: new Date().toISOString() });
    }, 15000);

    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      unsubscribe();
      reply.raw.end();
    });

    return reply;
  });

  app.get("/api/agentic/runs/:id/plan", async (request, reply) => {
    const params = agenticRunParamsSchema.parse(request.params);
    const item = await planService.getPlan(params.id);
    return reply.send({ item });
  });

  app.post("/api/agentic/runs/:id/plan/approve", async (request, reply) => {
    const params = agenticRunParamsSchema.parse(request.params);
    const plan = await planService.approvePlan(params.id, "user");
    const prepared = await loadPreparedAgenticRun({
      runId: params.id,
      repoService,
      ticketService,
      overrides: {
        planMode: false,
        systemPromptSuffix: plan.planContent ? `Approved plan:\n${plan.planContent}\nImplement this approved plan.` : undefined,
      },
    });

    await handleAgenticEvent({
      event: { type: "plan_approved", reviewedBy: "user" },
      runId: prepared.runId,
      projectId: prepared.repo.id,
      ticketId: prepared.ticket.id,
      providerId: prepared.executionInput.providerId ?? null,
      projectionMetadata: prepared.projectionMetadata,
      ticketService,
    });

    void executeAgenticRun({
      toolRegistry,
      executionService,
      ticketService,
      prepared,
    });

    return reply.send({ item: plan });
  });

  app.post("/api/agentic/runs/:id/plan/reject", async (request, reply) => {
    const params = agenticRunParamsSchema.parse(request.params);
    const body = planRejectSchema.parse(request.body);
    const plan = await planService.rejectPlan(params.id, body.reason, "user");
    const prepared = await loadPreparedAgenticRun({
      runId: params.id,
      repoService,
      ticketService,
    });

    await handleAgenticEvent({
      event: { type: "plan_rejected", reason: body.reason, reviewedBy: "user" },
      runId: prepared.runId,
      projectId: prepared.repo.id,
      ticketId: prepared.ticket.id,
      providerId: prepared.executionInput.providerId ?? null,
      projectionMetadata: prepared.projectionMetadata,
      ticketService,
    });

    return reply.send({ item: plan });
  });

  app.post("/api/agentic/runs/:id/plan/refine", async (request, reply) => {
    const params = agenticRunParamsSchema.parse(request.params);
    const body = planFeedbackSchema.parse(request.body);
    const plan = await planService.refinePlan(params.id, body.feedback);
    const prepared = await loadPreparedAgenticRun({
      runId: params.id,
      repoService,
      ticketService,
      overrides: {
        planMode: true,
        systemPromptSuffix: `The user requested plan refinement. Feedback:\n${body.feedback}`,
      },
    });

    await handleAgenticEvent({
      event: { type: "plan_refine_requested", feedback: body.feedback },
      runId: prepared.runId,
      projectId: prepared.repo.id,
      ticketId: prepared.ticket.id,
      providerId: prepared.executionInput.providerId ?? null,
      projectionMetadata: prepared.projectionMetadata,
      ticketService,
    });

    void executeAgenticRun({
      toolRegistry,
      executionService,
      ticketService,
      prepared,
    });

    return reply.send({ item: plan });
  });

  app.post("/api/agentic/runs/:id/plan/answer", async (request, reply) => {
    const params = agenticRunParamsSchema.parse(request.params);
    const body = planAnswerSchema.parse(request.body);
    const plan = await planService.answerQuestion(params.id, body.questionId, body.answer);
    const prepared = await loadPreparedAgenticRun({
      runId: params.id,
      repoService,
      ticketService,
      overrides: {
        planMode: true,
        systemPromptSuffix: `The user answered plan question ${body.questionId}:\n${body.answer}\nContinue planning.`,
      },
    });

    await handleAgenticEvent({
      event: { type: "plan_question_answered", questionId: body.questionId, answer: body.answer },
      runId: prepared.runId,
      projectId: prepared.repo.id,
      ticketId: prepared.ticket.id,
      providerId: prepared.executionInput.providerId ?? null,
      projectionMetadata: prepared.projectionMetadata,
      ticketService,
    });

    void executeAgenticRun({
      toolRegistry,
      executionService,
      ticketService,
      prepared,
    });

    return reply.send({ item: plan });
  });

  app.post<{ Body: AgenticExecuteInput }>("/api/agentic/execute", async (request, reply) => {
    const parsed = agenticExecuteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: "Invalid request body",
        details: parsed.error.issues,
      });
    }

    const prepared = await prepareAgenticExecution(parsed.data, {
      repoService,
      ticketService,
    });

    reply.hijack();
    reply.raw.writeHead(200, buildStreamHeaders(typeof request.headers.origin === "string" ? request.headers.origin : null));

    try {
      for await (const event of executionService.executeAgentic(toolRegistry, prepared.executionInput)) {
        await handleAgenticEvent({
          event,
          runId: prepared.runId,
          projectId: prepared.repo.id,
          ticketId: prepared.ticket.id,
          providerId: prepared.executionInput.providerId ?? null,
          projectionMetadata: prepared.projectionMetadata,
          ticketService,
        });

        reply.raw.write(`event: agentic\ndata: ${JSON.stringify(toEventPayload({
          runId: prepared.runId,
          projectId: prepared.repo.id,
          ticketId: prepared.ticket.id,
          event,
        }))}\n\n`);
      }

      reply.raw.write("event: done\ndata: {}\n\n");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      const errorEvent: AgenticEvent = {
        type: "error",
        error: message,
        recoverable: false,
      };
      await handleAgenticEvent({
        event: errorEvent,
        runId: prepared.runId,
        projectId: prepared.repo.id,
        ticketId: prepared.ticket.id,
        providerId: prepared.executionInput.providerId ?? null,
        projectionMetadata: prepared.projectionMetadata,
        ticketService,
      });
      reply.raw.write(`event: error\ndata: ${JSON.stringify(toEventPayload({
        runId: prepared.runId,
        projectId: prepared.repo.id,
        ticketId: prepared.ticket.id,
        event: errorEvent,
      }))}\n\n`);
    } finally {
      reply.raw.end();
    }
  });
}
