import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { eventBus, publishEvent } from "../eventBus";
import { listOnPremInferenceBackends } from "../providers/inferenceBackends";
import { listOnPremQwenModelPlugins } from "../providers/modelPlugins";
import { ChallengeService } from "../services/challengeService";
import { ContextService } from "../services/contextService";
import { DistillService } from "../services/distillService";
import { InferenceTuningService } from "../services/inferenceTuningService";
import { LaneService } from "../services/laneService";
import { MergeService } from "../services/mergeService";
import { RouterService } from "../services/routerService";
import { V2CommandService } from "../services/v2CommandService";
import { V2EventService } from "../services/v2EventService";
import { V2QueryService } from "../services/v2QueryService";
import { buildStreamHeaders } from "./shared/http";
import type { DistillReviewDecision, DistillStage, OnPremInferenceBackendId } from "../../shared/contracts";

const taskIntakeCommandSchema = z.object({
  strategy: z.enum(["weighted-random-next", "deterministic-next"]),
  actor: z.string().min(1),
  seed: z.string().optional(),
  reservation_ttl_seconds: z.number().int().positive().optional(),
});

const taskReserveCommandSchema = z.object({
  ticket_id: z.string().min(1),
  actor: z.string().min(1),
  reservation_ttl_seconds: z.number().int().positive().optional(),
});

const taskTransitionCommandSchema = z.object({
  ticket_id: z.string().min(1),
  actor: z.string().min(1),
  status: z.enum(["inactive", "reserved", "active", "in_progress", "blocked", "completed"]),
  risk_level: z.enum(["low", "medium", "high"]).optional(),
});

const executionRequestCommandSchema = z.object({
  ticket_id: z.string().min(1),
  repo_id: z.string().optional(),
  actor: z.string().min(1),
  prompt: z.string().min(1),
  retrieval_context_ids: z.array(z.string()).min(1),
  workspace_path: z.string().optional(),
  risk_level: z.enum(["low", "medium", "high"]).optional(),
  routing_decision_id: z.string().optional(),
  model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]).optional(),
});

const policyDecideCommandSchema = z.object({
  action_type: z.string().min(1),
  actor: z.string().min(1),
  risk_level: z.enum(["low", "medium", "high"]).default("medium"),
  workspace_path: z.string().default(""),
  payload: z.record(z.unknown()).default({}),
  dry_run: z.boolean().default(false),
  aggregate_id: z.string().optional(),
});

const providerActivateCommandSchema = z.object({
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]),
  actor: z.string().min(1),
});

const inferenceAutotuneCommandSchema = z.object({
  actor: z.string().min(1),
  profile: z.enum(["interactive", "batch", "tool_heavy"]).default("interactive"),
  dry_run: z.boolean().optional(),
});

const inferenceBackendSwitchSchema = z.object({
  actor: z.string().min(1),
  backend_id: z.enum([
    "mlx-lm",
    "sglang",
    "vllm-openai",
    "trtllm-openai",
    "llama-cpp-openai",
    "transformers-openai",
    "ollama-openai",
  ]),
});

const inferenceBackendStartStopSchema = z.object({
  actor: z.string().min(1),
  backend_id: z.enum([
    "mlx-lm",
    "sglang",
    "vllm-openai",
    "trtllm-openai",
    "llama-cpp-openai",
    "transformers-openai",
    "ollama-openai",
  ]),
});

const modelPluginActivateSchema = z.object({
  actor: z.string().min(1),
  plugin_id: z.string().min(1),
});

const distillDatasetGenerateSchema = z.object({
  actor: z.string().min(1),
  title: z.string().min(1),
  sample_count: z.number().int().min(1).max(500).default(40),
  retrieval_context_ids: z.array(z.string()).min(1),
  model: z.string().optional(),
});

const distillDatasetReviewSchema = z.object({
  actor: z.string().min(1),
  dataset_id: z.string().min(1),
  decisions: z.array(
    z.object({
      example_id: z.string().min(1),
      decision: z.enum(["pending", "approved", "rejected", "needs_edit"]),
      note: z.string().optional(),
    })
  ),
});

const distillTrainStartSchema = z.object({
  actor: z.string().min(1),
  dataset_id: z.string().min(1),
  stage: z.enum(["sft", "orpo", "tool_rl"]),
  student_model_id: z.string().min(1),
});

const distillEvalRunSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
  baseline_model_id: z.string().optional(),
});

const distillModelPromoteSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
});

const routerPlanSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().optional(),
  ticket_id: z.string().optional(),
  run_id: z.string().optional(),
  prompt: z.string().min(1),
  risk_level: z.enum(["low", "medium", "high"]).optional(),
  workspace_path: z.string().optional(),
  retrieval_context_ids: z.array(z.string()).default([]),
  active_files: z.array(z.string()).default([]),
});

const contextMaterializeSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().optional(),
  aggregate_id: z.string().min(1),
  aggregate_type: z.enum(["ticket", "run", "lane"]),
  goal: z.string().min(1),
  query: z.string().optional(),
  constraints: z.array(z.string()).optional(),
  active_files: z.array(z.string()).optional(),
  retrieval_ids: z.array(z.string()).optional(),
  memory_refs: z.array(z.string()).optional(),
  open_questions: z.array(z.string()).optional(),
  verification_plan: z.array(z.string()).optional(),
  rollback_plan: z.array(z.string()).optional(),
  policy_scopes: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
});

const memoryCommitSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().optional(),
  aggregate_id: z.string().min(1),
  kind: z.enum(["scratchpad", "episodic", "fact", "procedural", "user", "reflection"]),
  content: z.string().min(1),
  citations: z.array(z.string()).optional(),
  confidence: z.number().min(0).max(1).optional(),
  stale_after: z.string().nullable().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const agentSpawnSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().optional(),
  ticket_id: z.string().min(1),
  run_id: z.string().optional(),
  role: z.enum(["planner", "implementer", "verifier", "integrator", "researcher"]),
  context_manifest_id: z.string().optional(),
  lease_minutes: z.number().int().positive().optional(),
  summary: z.string().optional(),
});

const agentReclaimSchema = z.object({
  actor: z.string().min(1),
  lane_id: z.string().optional(),
  reason: z.string().optional(),
});

const mergePrepareSchema = z.object({
  actor: z.string().min(1),
  repo_id: z.string().optional(),
  run_id: z.string().min(1),
  changed_files: z.array(z.string()).min(1),
  semantic_conflicts: z.array(z.string()).optional(),
  required_checks: z.array(z.string()).optional(),
  overlap_score: z.number().optional(),
  metadata: z.record(z.unknown()).optional(),
});

const challengeRegisterSchema = z.object({
  actor: z.string().min(1),
  model_plugin_id: z.string().min(1),
  parent_model_plugin_id: z.string().nullable().optional(),
  dataset_id: z.string().min(1),
  eval_run_id: z.string().min(1),
});

const challengeReviewSchema = z.object({
  actor: z.string().min(1),
  candidate_id: z.string().min(1),
  status: z.enum(["approved", "rejected", "promoted"]),
});

type RuntimeRouteDeps = {
  app: FastifyInstance;
  challengeService: ChallengeService;
  contextService: ContextService;
  distillService: DistillService;
  inferenceTuningService: InferenceTuningService;
  laneService: LaneService;
  mergeService: MergeService;
  routerService: RouterService;
  v2CommandService: V2CommandService;
  v2EventService: V2EventService;
  v2QueryService: V2QueryService;
};

export function registerRuntimeRoutes(deps: RuntimeRouteDeps) {
  const {
    app,
    challengeService,
    contextService,
    distillService,
    inferenceTuningService,
    laneService,
    mergeService,
    routerService,
    v2CommandService,
    v2EventService,
    v2QueryService,
  } = deps;

  app.get("/api/v2/stream", async (request, reply) => {
    reply.hijack();
    reply.raw.writeHead(200, buildStreamHeaders(typeof request.headers.origin === "string" ? request.headers.origin : null));

    const send = (eventName: string, payload: unknown) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send("connected", { stream: "v2", now: new Date().toISOString() });

    const stopGlobal = eventBus.subscribe("global", (event) => {
      send(event.type, event);
    });

    const heartbeat = setInterval(() => {
      send("heartbeat", { now: new Date().toISOString() });
    }, 15000);

    request.raw.on("close", () => {
      clearInterval(heartbeat);
      stopGlobal();
      reply.raw.end();
    });

    return reply;
  });

  app.post("/api/v2/commands/task.intake", async (request) => {
    const input = taskIntakeCommandSchema.parse(request.body);
    return v2CommandService.intakeTask(input);
  });

  app.post("/api/v2/commands/task.reserve", async (request) => {
    const input = taskReserveCommandSchema.parse(request.body);
    return v2CommandService.reserveTask(input);
  });

  app.post("/api/v2/commands/task.transition", async (request) => {
    const input = taskTransitionCommandSchema.parse(request.body);
    return v2CommandService.transitionTask(input);
  });

  app.post("/api/v2/commands/execution.request", async (request) => {
    const input = executionRequestCommandSchema.parse(request.body);
    return v2CommandService.requestExecution(input);
  });

  app.post("/api/v2/commands/policy.decide", async (request) => {
    const input = policyDecideCommandSchema.parse(request.body);
    return v2CommandService.evaluatePolicy({
      ...input,
      payload: input.payload,
      aggregate_id: input.aggregate_id,
    });
  });

  app.post("/api/v2/commands/provider.activate", async (request) => {
    const input = providerActivateCommandSchema.parse(request.body);
    return v2CommandService.activateProvider(input);
  });

  app.post("/api/v2/commands/inference.autotune", async (request) => {
    const input = inferenceAutotuneCommandSchema.parse(request.body);
    return inferenceTuningService.runAutotune({
      actor: input.actor,
      profile: input.profile,
      dryRun: input.dry_run,
    });
  });

  app.post("/api/v2/commands/inference.backend.start", async (request) => {
    const input = inferenceBackendStartStopSchema.parse(request.body);
    return inferenceTuningService.startBackend({
      actor: input.actor,
      backendId: input.backend_id as OnPremInferenceBackendId,
    });
  });

  app.post("/api/v2/commands/inference.backend.stop", async (request) => {
    const input = inferenceBackendStartStopSchema.parse(request.body);
    return inferenceTuningService.stopBackend({
      actor: input.actor,
      backendId: input.backend_id as OnPremInferenceBackendId,
    });
  });

  app.post("/api/v2/commands/inference.backend.switch", async (request) => {
    const input = inferenceBackendSwitchSchema.parse(request.body);
    return inferenceTuningService.switchBackend({
      actor: input.actor,
      backendId: input.backend_id as OnPremInferenceBackendId,
    });
  });

  app.post("/api/v2/commands/model.plugin.activate", async (request) => {
    const input = modelPluginActivateSchema.parse(request.body);
    const current = await prisma.appSetting.findUnique({ where: { key: "onprem_qwen_config" } });
    const previous = (current?.value as Record<string, unknown>) || {};
    const plugin = listOnPremQwenModelPlugins().find((item) => item.id === input.plugin_id);
    if (!plugin) {
      throw new Error(`Unknown plugin id '${input.plugin_id}'`);
    }

    await prisma.appSetting.upsert({
      where: { key: "onprem_qwen_config" },
      update: {
        value: {
          ...previous,
          pluginId: plugin.id,
          model: plugin.runtimeModel,
        },
      },
      create: {
        key: "onprem_qwen_config",
        value: {
          ...previous,
          pluginId: plugin.id,
          model: plugin.runtimeModel,
        },
      },
    });

    const currentRoleBindings = ((await prisma.appSetting.findUnique({ where: { key: "model_role_bindings" } }))?.value ||
      {}) as Record<string, Record<string, unknown>>;

    await prisma.appSetting.upsert({
      where: { key: "model_role_bindings" },
      update: {
        value: {
          ...currentRoleBindings,
          coder_default: {
            ...(currentRoleBindings.coder_default || {}),
            role: "coder_default",
            providerId: "onprem-qwen",
            pluginId: plugin.id,
            model: plugin.runtimeModel,
          },
          review_deep: {
            ...(currentRoleBindings.review_deep || {}),
            role: "review_deep",
            providerId: "onprem-qwen",
            pluginId: plugin.id,
            model: plugin.runtimeModel,
          },
        },
      },
      create: {
        key: "model_role_bindings",
        value: {
          ...currentRoleBindings,
          coder_default: {
            role: "coder_default",
            providerId: "onprem-qwen",
            pluginId: plugin.id,
            model: plugin.runtimeModel,
          },
          review_deep: {
            role: "review_deep",
            providerId: "onprem-qwen",
            pluginId: plugin.id,
            model: plugin.runtimeModel,
          },
        },
      },
    });

    await prisma.modelPluginRegistry.updateMany({
      where: { providerId: "onprem-qwen" },
      data: { active: false },
    });

    await prisma.modelPluginRegistry.upsert({
      where: { pluginId: plugin.id },
      update: {
        providerId: "onprem-qwen",
        modelId: plugin.runtimeModel,
        paramsB: plugin.paramsB,
        active: true,
        capabilities: {
          maxContext: plugin.maxContext,
          recommendedBackend: plugin.recommendedBackend,
        },
      },
      create: {
        pluginId: plugin.id,
        providerId: "onprem-qwen",
        modelId: plugin.runtimeModel,
        paramsB: plugin.paramsB,
        active: true,
        capabilities: {
          maxContext: plugin.maxContext,
          recommendedBackend: plugin.recommendedBackend,
        },
      },
    });

    await v2EventService.appendEvent({
      type: "model.plugin.activated",
      aggregateId: plugin.id,
      actor: input.actor,
      payload: {
        plugin_id: plugin.id,
        model_id: plugin.runtimeModel,
      },
    });

    publishEvent("global", "model.plugin.activated", {
      pluginId: plugin.id,
      modelId: plugin.runtimeModel,
    });

    return {
      ok: true,
      plugin,
    };
  });

  app.post("/api/v2/commands/distill.dataset.generate", async (request) => {
    const input = distillDatasetGenerateSchema.parse(request.body);
    return distillService.generateDataset(input);
  });

  app.post("/api/v2/commands/distill.dataset.review", async (request) => {
    const input = distillDatasetReviewSchema.parse(request.body);
    return distillService.reviewDataset({
      actor: input.actor,
      dataset_id: input.dataset_id,
      decisions: input.decisions.map((item) => ({
        example_id: item.example_id,
        decision: item.decision as DistillReviewDecision,
        note: item.note,
      })),
    });
  });

  app.post("/api/v2/commands/distill.train.start", async (request) => {
    const input = distillTrainStartSchema.parse(request.body);
    return distillService.startTraining({
      actor: input.actor,
      dataset_id: input.dataset_id,
      stage: input.stage as DistillStage,
      student_model_id: input.student_model_id,
    });
  });

  app.post("/api/v2/commands/distill.eval.run", async (request) => {
    const input = distillEvalRunSchema.parse(request.body);
    return distillService.runEval({
      actor: input.actor,
      run_id: input.run_id,
      baseline_model_id: input.baseline_model_id,
    });
  });

  app.post("/api/v2/commands/distill.model.promote", async (request) => {
    const input = distillModelPromoteSchema.parse(request.body);
    return distillService.promoteModel({
      actor: input.actor,
      run_id: input.run_id,
    });
  });

  app.get("/api/v2/tasks/board", async (request) => {
    const query = request.query as { repoId?: string };
    return v2QueryService.getTaskBoard(query.repoId);
  });

  app.get("/api/v2/tasks/:id/timeline", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await v2QueryService.getTaskTimeline(id),
    };
  });

  app.get("/api/v2/runs/:id/replay", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await v2QueryService.getRunReplay(id),
    };
  });

  app.get("/api/v2/policy/pending", async () => {
    return {
      items: await v2QueryService.getPendingPolicy(),
    };
  });

  app.get("/api/v2/knowledge/search", async (request) => {
    const query = request.query as { q?: string };
    const q = query.q?.trim() || "";
    return {
      items: await v2QueryService.searchKnowledge(q),
    };
  });

  app.get("/api/v2/commands/recent", async (request) => {
    const query = request.query as { limit?: string };
    const parsedLimit = Number(query.limit || "100");
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 500) : 100;
    return {
      items: await v2QueryService.getRecentCommands(limit),
    };
  });

  app.get("/api/v2/inference/backends", async () => {
    return {
      items: await inferenceTuningService.listBackends(),
    };
  });

  app.get("/api/v1/providers/onprem/role-runtimes", async () => {
    return {
      items: await inferenceTuningService.listRoleRuntimeStatuses(),
    };
  });

  app.post("/api/v1/providers/onprem/role-runtimes/test", async (request) => {
    const input = z
      .object({
        actor: z.string().min(1),
        role: z.enum(["utility_fast", "coder_default", "review_deep"]),
      })
      .parse(request.body);
    return {
      item: await inferenceTuningService.testRoleRuntime({ role: input.role }),
    };
  });

  app.post("/api/v1/providers/onprem/role-runtimes/start", async (request) => {
    const input = z
      .object({
        actor: z.string().min(1),
        role: z.enum(["utility_fast", "coder_default", "review_deep"]),
      })
      .parse(request.body);
    return inferenceTuningService.startRoleRuntime({
      actor: input.actor,
      role: input.role,
    });
  });

  app.post("/api/v1/providers/onprem/role-runtimes/stop", async (request) => {
    const input = z
      .object({
        actor: z.string().min(1),
        role: z.enum(["utility_fast", "coder_default", "review_deep"]),
      })
      .parse(request.body);
    return inferenceTuningService.stopRoleRuntime({
      actor: input.actor,
      role: input.role,
    });
  });

  app.post("/api/v1/providers/onprem/role-runtimes/start-enabled", async (request) => {
    const input = z.object({ actor: z.string().min(1) }).parse(request.body);
    return inferenceTuningService.startEnabledRoleRuntimes({ actor: input.actor });
  });

  app.get("/api/v1/providers/onprem/plugins", async () => {
    return {
      items: listOnPremQwenModelPlugins(),
    };
  });

  app.get("/api/v1/providers/onprem/backends", async () => {
    return {
      items: listOnPremInferenceBackends(),
    };
  });

  app.get("/api/v2/inference/benchmarks/latest", async (request) => {
    const query = request.query as { profile?: "interactive" | "batch" | "tool_heavy" };
    return {
      items: await inferenceTuningService.getLatestBenchmarks(query.profile),
    };
  });

  app.get("/api/v2/inference/benchmarks/history", async (request) => {
    const query = request.query as { profile?: "interactive" | "batch" | "tool_heavy"; limit?: string };
    const parsedLimit = Number(query.limit || "200");
    const limit = Number.isFinite(parsedLimit) ? parsedLimit : 200;
    return {
      items: await inferenceTuningService.getBenchmarkHistory(query.profile, limit),
    };
  });

  app.get("/api/v2/model/plugins", async () => {
    const plugins = listOnPremQwenModelPlugins();
    const registry = await prisma.modelPluginRegistry.findMany({
      where: { providerId: "onprem-qwen" },
      orderBy: { updatedAt: "desc" },
    });
    const activeSet = new Set(registry.filter((row) => row.active).map((row) => row.pluginId));
    const promotedSet = new Set(registry.filter((row) => row.promoted).map((row) => row.pluginId));

    return {
      items: plugins.map((plugin) => ({
        ...plugin,
        active: activeSet.has(plugin.id),
        promoted: promotedSet.has(plugin.id),
      })),
    };
  });

  app.get("/api/v2/distill/datasets/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return distillService.getDataset(id);
  });

  app.get("/api/v2/distill/runs/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return distillService.getRun(id);
  });

  app.get("/api/v2/distill/runs/:id/logs", async (request) => {
    const id = (request.params as { id: string }).id;
    return distillService.getRunLogs(id);
  });

  app.get("/api/v2/distill/evals/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return distillService.getEval(id);
  });

  app.get("/api/v2/distill/quota", async () => {
    return distillService.getQuotaState();
  });

  app.get("/api/v2/distill/readiness", async () => {
    return distillService.getReadiness();
  });

  app.get("/api/v2/distill/models", async () => {
    return {
      items: await distillService.listModels(),
    };
  });

  app.post("/api/v3/commands/router.plan", async (request) => {
    const input = routerPlanSchema.parse(request.body);
    return {
      item: await routerService.planRoute(input),
    };
  });

  app.post("/api/v3/commands/context.materialize", async (request) => {
    const input = contextMaterializeSchema.parse(request.body);
    return contextService.materializeContext(input);
  });

  app.post("/api/v3/commands/context.refresh", async (request) => {
    const input = contextMaterializeSchema.parse(request.body);
    return contextService.materializeContext(input);
  });

  app.post("/api/v3/commands/memory.commit", async (request) => {
    const input = memoryCommitSchema.parse(request.body);
    return {
      item: await contextService.commitMemory(input),
    };
  });

  app.post("/api/v3/commands/agent.spawn", async (request) => {
    const input = agentSpawnSchema.parse(request.body);
    return {
      item: await laneService.spawnLane(input),
    };
  });

  app.post("/api/v3/commands/agent.reclaim", async (request) => {
    const input = agentReclaimSchema.parse(request.body);
    return {
      items: await laneService.reclaimLane(input),
    };
  });

  app.post("/api/v3/commands/run.merge.prepare", async (request) => {
    const input = mergePrepareSchema.parse(request.body);
    return {
      item: await mergeService.prepareMerge(input),
    };
  });

  app.post("/api/v3/commands/model.challenge.register", async (request) => {
    const input = challengeRegisterSchema.parse(request.body);
    return {
      item: await challengeService.registerCandidate(input),
    };
  });

  app.post("/api/v3/commands/model.challenge.review", async (request) => {
    const input = challengeReviewSchema.parse(request.body);
    return {
      item: await challengeService.reviewCandidate(input),
    };
  });

  app.get("/api/v3/router/decisions/:id", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await routerService.getDecision(id),
    };
  });

  app.get("/api/v3/agents/lanes", async (request) => {
    const query = request.query as { ticketId?: string; runId?: string };
    return {
      items: await laneService.listLanes({
        ticketId: query.ticketId,
        runId: query.runId,
      }),
    };
  });

  app.get("/api/v3/tasks/:id/context", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await contextService.getLatestContext(id),
      routing: await routerService.listRecentForAggregate(id),
    };
  });

  app.get("/api/v3/tasks/:id/workflow-state", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await contextService.getWorkflowState(id),
    };
  });

  app.get("/api/v3/memory/search", async (request) => {
    const query = request.query as { q?: string };
    return {
      items: await contextService.searchMemory(query.q || ""),
    };
  });

  app.get("/api/v3/providers/openai/budget", async () => {
    const configRow = await prisma.appSetting.findUnique({ where: { key: "openai_responses_config" } });
    const config = (configRow?.value as Record<string, unknown> | null) || {};
    const row = await prisma.providerBudgetProjection.findFirst({
      where: { providerId: "openai-responses" },
    });

    const dailyBudgetUsd = typeof config.dailyBudgetUsd === "number" ? config.dailyBudgetUsd : 25;
    const usedUsd = row?.usedUsd ?? 0;
    return {
      item: {
        providerId: "openai-responses",
        dailyBudgetUsd,
        usedUsd,
        remainingUsd: Math.max(0, dailyBudgetUsd - usedUsd),
        requestCount: row?.requestCount ?? 0,
        cooldownUntil: row?.cooldownUntil?.toISOString() ?? null,
        updatedAt: row?.updatedAt?.toISOString() ?? new Date().toISOString(),
      },
    };
  });

  app.get("/api/v3/evals/champion-vs-challenger", async () => {
    return challengeService.getChampionVsChallenger();
  });

  app.get("/api/v3/runs/:id/merge-report", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      item: await mergeService.getMergeReport(id),
    };
  });

  app.get("/api/v3/runs/:id/summary", async (request) => {
    const id = (request.params as { id: string }).id;
    const row = await prisma.runProjection.findUnique({ where: { runId: id } });
    if (!row) {
      return {
        item: null,
      };
    }

    const metadata = (row.metadata as Record<string, unknown> | null) || {};
    const routingDecisionId = typeof metadata.routing_decision_id === "string" ? metadata.routing_decision_id : null;
    const routingDecision = routingDecisionId
      ? await prisma.routingDecisionProjection.findUnique({ where: { id: routingDecisionId } })
      : null;

    return {
      item: {
        runId: row.runId,
        ticketId: row.ticketId,
        status: row.status,
        providerId:
          (row.providerId as "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses" | null) ||
          (routingDecision?.providerId as "qwen-cli" | "openai-compatible" | "onprem-qwen" | "openai-responses" | null),
        modelRole:
          (typeof metadata.model_role === "string" ? metadata.model_role : null) || routingDecision?.modelRole || null,
        routingDecisionId,
        repoId: (typeof metadata.repo_id === "string" ? metadata.repo_id : null) || routingDecision?.repoId || null,
        executionMode:
          (typeof metadata.execution_mode === "string" ? metadata.execution_mode : null) || routingDecision?.executionMode || null,
        verificationDepth:
          (typeof metadata.verification_depth === "string" ? metadata.verification_depth : null) ||
          routingDecision?.verificationDepth ||
          null,
        startedAt: row.startedAt?.toISOString() ?? null,
        endedAt: row.endedAt?.toISOString() ?? null,
        createdAt: row.createdAt.toISOString(),
        updatedAt: row.updatedAt.toISOString(),
        metadata,
      },
    };
  });

  app.get("/api/v3/runs/:id/retrieval-trace", async (request) => {
    const id = (request.params as { id: string }).id;
    return {
      items: await contextService.getRetrievalTrace(id),
    };
  });
}
