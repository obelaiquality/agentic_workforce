import Fastify from "fastify";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  prisma: {
    appSetting: {
      findUnique: vi.fn(),
      upsert: vi.fn(),
    },
    modelPluginRegistry: {
      updateMany: vi.fn(),
      upsert: vi.fn(),
      findMany: vi.fn(),
    },
    providerBudgetProjection: {
      findFirst: vi.fn(),
    },
    runProjection: {
      findUnique: vi.fn(),
    },
    routingDecisionProjection: {
      findUnique: vi.fn(),
    },
  },
  publishEvent: vi.fn(),
}));

vi.mock("../db", () => ({
  prisma: mocks.prisma,
}));

vi.mock("../eventBus", () => ({
  eventBus: {
    subscribe: vi.fn(() => () => {}),
  },
  publishEvent: mocks.publishEvent,
}));

import { registerRuntimeRoutes } from "./runtimeRoutes";

function createHarness() {
  const app = Fastify();
  const challengeService = {
    registerCandidate: vi.fn(),
    reviewCandidate: vi.fn(),
    getChampionVsChallenger: vi.fn(),
  };
  const contextService = {
    materializeContext: vi.fn(),
    commitMemory: vi.fn(),
    getLatestContext: vi.fn(),
    getWorkflowState: vi.fn(),
    searchMemory: vi.fn(),
    getRetrievalTrace: vi.fn(),
  };
  const distillService = {
    generateDataset: vi.fn(),
    reviewDataset: vi.fn(),
    startTraining: vi.fn(),
    runEval: vi.fn(),
    promoteModel: vi.fn(),
    getDataset: vi.fn(),
    getRun: vi.fn(),
    getRunLogs: vi.fn(),
    getEval: vi.fn(),
    getQuotaState: vi.fn(),
    getReadiness: vi.fn(),
    listModels: vi.fn().mockResolvedValue([]),
  };
  const inferenceTuningService = {
    runAutotune: vi.fn(),
    startBackend: vi.fn(),
    stopBackend: vi.fn(),
    switchBackend: vi.fn(),
    listBackends: vi.fn().mockResolvedValue([]),
    listRoleRuntimeStatuses: vi.fn().mockResolvedValue([]),
    testRoleRuntime: vi.fn().mockResolvedValue({ ok: true }),
    startRoleRuntime: vi.fn().mockResolvedValue({ ok: true }),
    stopRoleRuntime: vi.fn().mockResolvedValue({ ok: true }),
    startEnabledRoleRuntimes: vi.fn().mockResolvedValue({ ok: true }),
    getLatestBenchmarks: vi.fn().mockResolvedValue([]),
    getBenchmarkHistory: vi.fn().mockResolvedValue([]),
  };
  const laneService = {
    spawnLane: vi.fn(),
    reclaimLane: vi.fn(),
    listLanes: vi.fn(),
  };
  const mergeService = {
    prepareMerge: vi.fn(),
    getMergeReport: vi.fn(),
  };
  const routerService = {
    planRoute: vi.fn(),
    getDecision: vi.fn(),
    listRecentForAggregate: vi.fn(),
  };
  const v2CommandService = {
    intakeTask: vi.fn(),
    reserveTask: vi.fn(),
    transitionTask: vi.fn(),
    requestExecution: vi.fn(),
    evaluatePolicy: vi.fn(),
    activateProvider: vi.fn(),
  };
  const v2EventService = {
    appendEvent: vi.fn().mockResolvedValue(undefined),
  };
  const v2QueryService = {
    getTaskBoard: vi.fn(),
    getTaskTimeline: vi.fn(),
    getRunReplay: vi.fn(),
    getPendingPolicy: vi.fn(),
    searchKnowledge: vi.fn().mockResolvedValue([]),
    getRecentCommands: vi.fn().mockResolvedValue([]),
  };

  registerRuntimeRoutes({
    app,
    challengeService: challengeService as never,
    contextService: contextService as never,
    distillService: distillService as never,
    inferenceTuningService: inferenceTuningService as never,
    laneService: laneService as never,
    mergeService: mergeService as never,
    routerService: routerService as never,
    v2CommandService: v2CommandService as never,
    v2EventService: v2EventService as never,
    v2QueryService: v2QueryService as never,
  });

  return {
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
  };
}

describe("runtimeRoutes", () => {
  beforeEach(() => {
    vi.clearAllMocks();

    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "onprem_qwen_config") {
        return {
          value: {
            baseUrl: "http://127.0.0.1:8000/v1",
            pluginId: "qwen3.5-0.8b",
            model: "Qwen/Qwen3.5-0.8B",
          },
        };
      }
      if (where.key === "model_role_bindings") {
        return {
          value: {
            coder_default: {
              role: "coder_default",
              temperature: 0.1,
            },
            review_deep: {
              role: "review_deep",
              timeoutMs: 120000,
            },
          },
        };
      }
      if (where.key === "openai_responses_config") {
        return {
          value: {
            dailyBudgetUsd: 5,
          },
        };
      }
      return null;
    });
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
    mocks.prisma.modelPluginRegistry.updateMany.mockResolvedValue({ count: 2 });
    mocks.prisma.modelPluginRegistry.upsert.mockResolvedValue(undefined);
    mocks.prisma.modelPluginRegistry.findMany.mockResolvedValue([]);
    mocks.prisma.providerBudgetProjection.findFirst.mockResolvedValue(null);
    mocks.prisma.runProjection.findUnique.mockResolvedValue(null);
    mocks.prisma.routingDecisionProjection.findUnique.mockResolvedValue(null);
  });

  it("activates an on-prem model plugin and rewires the runtime bindings", async () => {
    const { app, v2EventService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/model.plugin.activate",
      payload: {
        actor: "ops-bot",
        plugin_id: "qwen3.5-4b",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({
      ok: true,
      plugin: {
        id: "qwen3.5-4b",
        runtimeModel: "mlx-community/Qwen3.5-4B-4bit",
      },
    });
    expect(mocks.prisma.appSetting.upsert).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({
        where: {
          key: "onprem_qwen_config",
        },
        update: {
          value: expect.objectContaining({
            pluginId: "qwen3.5-4b",
            model: "mlx-community/Qwen3.5-4B-4bit",
          }),
        },
      })
    );
    expect(mocks.prisma.appSetting.upsert).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        where: {
          key: "model_role_bindings",
        },
        update: {
          value: expect.objectContaining({
            coder_default: expect.objectContaining({
              role: "coder_default",
              providerId: "onprem-qwen",
              pluginId: "qwen3.5-4b",
              model: "mlx-community/Qwen3.5-4B-4bit",
              temperature: 0.1,
            }),
            review_deep: expect.objectContaining({
              role: "review_deep",
              providerId: "onprem-qwen",
              pluginId: "qwen3.5-4b",
              model: "mlx-community/Qwen3.5-4B-4bit",
              timeoutMs: 120000,
            }),
          }),
        },
      })
    );
    expect(mocks.prisma.modelPluginRegistry.updateMany).toHaveBeenCalledWith({
      where: {
        providerId: "onprem-qwen",
      },
      data: {
        active: false,
      },
    });
    expect(mocks.prisma.modelPluginRegistry.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          pluginId: "qwen3.5-4b",
        },
        update: expect.objectContaining({
          modelId: "mlx-community/Qwen3.5-4B-4bit",
          active: true,
        }),
      })
    );
    expect(v2EventService.appendEvent).toHaveBeenCalledWith({
      type: "model.plugin.activated",
      aggregateId: "qwen3.5-4b",
      actor: "ops-bot",
      payload: {
        plugin_id: "qwen3.5-4b",
        model_id: "mlx-community/Qwen3.5-4B-4bit",
      },
    });

    await app.close();
  });

  it("fails fast for unknown plugin ids without mutating persistence", async () => {
    const { app, v2EventService } = createHarness();

    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/model.plugin.activate",
      payload: {
        actor: "ops-bot",
        plugin_id: "does-not-exist",
      },
    });

    expect(response.statusCode).toBe(500);
    expect(mocks.prisma.appSetting.upsert).not.toHaveBeenCalled();
    expect(mocks.prisma.modelPluginRegistry.upsert).not.toHaveBeenCalled();
    expect(v2EventService.appendEvent).not.toHaveBeenCalled();

    await app.close();
  });

  it("trims knowledge search queries before delegating to the query service", async () => {
    const { app, v2QueryService } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v2/knowledge/search?q=%20%20planner%20notes%20%20",
    });

    expect(response.statusCode).toBe(200);
    expect(v2QueryService.searchKnowledge).toHaveBeenCalledWith("planner notes");

    await app.close();
  });

  it("clamps recent command limits to the supported maximum", async () => {
    const { app, v2QueryService } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v2/commands/recent?limit=999",
    });

    expect(response.statusCode).toBe(200);
    expect(v2QueryService.getRecentCommands).toHaveBeenCalledWith(500);

    await app.close();
  });

  it("defaults invalid recent command limits to the standard window", async () => {
    const { app, v2QueryService } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v2/commands/recent?limit=not-a-number",
    });

    expect(response.statusCode).toBe(200);
    expect(v2QueryService.getRecentCommands).toHaveBeenCalledWith(100);

    await app.close();
  });

  it("reports OpenAI budget state without allowing negative remaining spend", async () => {
    mocks.prisma.providerBudgetProjection.findFirst.mockResolvedValue({
      providerId: "openai-responses",
      usedUsd: 7,
      requestCount: 4,
      cooldownUntil: new Date("2026-03-25T12:00:00.000Z"),
      updatedAt: new Date("2026-03-25T11:30:00.000Z"),
    });
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v3/providers/openai/budget",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      item: {
        providerId: "openai-responses",
        dailyBudgetUsd: 5,
        usedUsd: 7,
        remainingUsd: 0,
        requestCount: 4,
        cooldownUntil: "2026-03-25T12:00:00.000Z",
        updatedAt: "2026-03-25T11:30:00.000Z",
      },
    });

    await app.close();
  });

  it("fills run summaries from routing decisions when the projection is incomplete", async () => {
    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      runId: "run-1",
      ticketId: "ticket-1",
      status: "completed",
      providerId: null,
      metadata: {
        routing_decision_id: "route-1",
      },
      startedAt: new Date("2026-03-25T10:00:00.000Z"),
      endedAt: null,
      createdAt: new Date("2026-03-25T09:55:00.000Z"),
      updatedAt: new Date("2026-03-25T10:10:00.000Z"),
    });
    mocks.prisma.routingDecisionProjection.findUnique.mockResolvedValue({
      id: "route-1",
      providerId: "openai-responses",
      modelRole: "coder_default",
      repoId: "repo-1",
      executionMode: "single_agent",
      verificationDepth: "deep",
    });
    const { app } = createHarness();

    const response = await app.inject({
      method: "GET",
      url: "/api/v3/runs/run-1/summary",
    });

    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      item: {
        runId: "run-1",
        ticketId: "ticket-1",
        status: "completed",
        providerId: "openai-responses",
        modelRole: "coder_default",
        routingDecisionId: "route-1",
        repoId: "repo-1",
        executionMode: "single_agent",
        verificationDepth: "deep",
        startedAt: "2026-03-25T10:00:00.000Z",
        endedAt: null,
        createdAt: "2026-03-25T09:55:00.000Z",
        updatedAt: "2026-03-25T10:10:00.000Z",
        metadata: {
          routing_decision_id: "route-1",
        },
      },
    });

    await app.close();
  });

  it("returns null item when run projection is not found", async () => {
    mocks.prisma.runProjection.findUnique.mockResolvedValue(null);
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/runs/nonexistent/summary",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: null });
    await app.close();
  });

  it("activates plugin without pre-existing model role bindings", async () => {
    mocks.prisma.appSetting.findUnique.mockImplementation(async ({ where }: { where: { key: string } }) => {
      if (where.key === "onprem_qwen_config") {
        return { value: { pluginId: "qwen3.5-0.8b" } };
      }
      // Return null for model_role_bindings to exercise the {} fallback
      return null;
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/model.plugin.activate",
      payload: { actor: "ops-bot", plugin_id: "qwen3.5-4b" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toMatchObject({ ok: true });
    // Verify the create path was used for model_role_bindings
    expect(mocks.prisma.appSetting.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { key: "model_role_bindings" },
        create: expect.objectContaining({
          key: "model_role_bindings",
          value: expect.objectContaining({
            coder_default: expect.objectContaining({ role: "coder_default" }),
            review_deep: expect.objectContaining({ role: "review_deep" }),
          }),
        }),
      }),
    );
    await app.close();
  });

  it("returns run summary with null/missing fields when metadata and routing are empty", async () => {
    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      runId: "run-3",
      ticketId: "ticket-3",
      status: "active",
      providerId: null,
      metadata: {},
      startedAt: null,
      endedAt: null,
      createdAt: new Date("2026-04-01T10:00:00.000Z"),
      updatedAt: new Date("2026-04-01T10:00:00.000Z"),
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/runs/run-3/summary",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.item.runId).toBe("run-3");
    expect(body.item.routingDecisionId).toBeNull();
    expect(body.item.modelRole).toBeNull();
    expect(body.item.repoId).toBeNull();
    expect(body.item.executionMode).toBeNull();
    expect(body.item.verificationDepth).toBeNull();
    expect(body.item.startedAt).toBeNull();
    expect(body.item.endedAt).toBeNull();
    await app.close();
  });

  it("returns run summary with direct metadata fields when routing decision is absent", async () => {
    mocks.prisma.runProjection.findUnique.mockResolvedValue({
      runId: "run-2",
      ticketId: "ticket-2",
      status: "in_progress",
      providerId: "onprem-qwen",
      metadata: {
        model_role: "coder_default",
        repo_id: "repo-x",
        execution_mode: "parallel",
        verification_depth: "shallow",
      },
      startedAt: new Date("2026-04-01T10:00:00.000Z"),
      endedAt: new Date("2026-04-01T11:00:00.000Z"),
      createdAt: new Date("2026-04-01T09:00:00.000Z"),
      updatedAt: new Date("2026-04-01T11:00:00.000Z"),
    });
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/runs/run-2/summary",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.item.providerId).toBe("onprem-qwen");
    expect(body.item.modelRole).toBe("coder_default");
    expect(body.item.repoId).toBe("repo-x");
    expect(body.item.executionMode).toBe("parallel");
    expect(body.item.verificationDepth).toBe("shallow");
    expect(body.item.routingDecisionId).toBeNull();
    expect(body.item.endedAt).toBe("2026-04-01T11:00:00.000Z");
    await app.close();
  });
});

describe("runtimeRoutes v2 command endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
  });

  it("delegates task.intake to v2CommandService", async () => {
    const { app, v2CommandService } = createHarness();
    v2CommandService.intakeTask.mockResolvedValue({ ok: true, ticket_id: "t-1" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/task.intake",
      payload: {
        strategy: "weighted-random-next",
        actor: "bot",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(v2CommandService.intakeTask).toHaveBeenCalledWith(
      expect.objectContaining({ strategy: "weighted-random-next", actor: "bot" }),
    );
    await app.close();
  });

  it("delegates task.reserve to v2CommandService", async () => {
    const { app, v2CommandService } = createHarness();
    v2CommandService.reserveTask.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/task.reserve",
      payload: {
        ticket_id: "t-1",
        actor: "bot",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(v2CommandService.reserveTask).toHaveBeenCalled();
    await app.close();
  });

  it("delegates task.transition to v2CommandService", async () => {
    const { app, v2CommandService } = createHarness();
    v2CommandService.transitionTask.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/task.transition",
      payload: {
        ticket_id: "t-1",
        actor: "bot",
        status: "active",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(v2CommandService.transitionTask).toHaveBeenCalled();
    await app.close();
  });

  it("delegates execution.request to v2CommandService", async () => {
    const { app, v2CommandService } = createHarness();
    v2CommandService.requestExecution.mockResolvedValue({ ok: true, run_id: "r-1" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/execution.request",
      payload: {
        ticket_id: "t-1",
        actor: "bot",
        prompt: "Build a feature",
        retrieval_context_ids: ["ctx-1"],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(v2CommandService.requestExecution).toHaveBeenCalled();
    await app.close();
  });

  it("delegates policy.decide to v2CommandService", async () => {
    const { app, v2CommandService } = createHarness();
    v2CommandService.evaluatePolicy.mockResolvedValue({ allowed: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/policy.decide",
      payload: {
        action_type: "file.write",
        actor: "bot",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(v2CommandService.evaluatePolicy).toHaveBeenCalled();
    await app.close();
  });

  it("delegates provider.activate to v2CommandService", async () => {
    const { app, v2CommandService } = createHarness();
    v2CommandService.activateProvider.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/provider.activate",
      payload: {
        provider_id: "onprem-qwen",
        actor: "bot",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(v2CommandService.activateProvider).toHaveBeenCalled();
    await app.close();
  });
});

describe("runtimeRoutes inference endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
  });

  it("delegates inference.autotune", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.runAutotune.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/inference.autotune",
      payload: { actor: "bot", profile: "interactive" },
    });
    expect(response.statusCode).toBe(200);
    expect(inferenceTuningService.runAutotune).toHaveBeenCalledWith({
      actor: "bot",
      profile: "interactive",
      dryRun: undefined,
    });
    await app.close();
  });

  it("delegates inference.backend.start", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.startBackend.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/inference.backend.start",
      payload: { actor: "bot", backend_id: "mlx-lm" },
    });
    expect(response.statusCode).toBe(200);
    expect(inferenceTuningService.startBackend).toHaveBeenCalledWith({
      actor: "bot",
      backendId: "mlx-lm",
    });
    await app.close();
  });

  it("delegates inference.backend.stop", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.stopBackend.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/inference.backend.stop",
      payload: { actor: "bot", backend_id: "mlx-lm" },
    });
    expect(response.statusCode).toBe(200);
    expect(inferenceTuningService.stopBackend).toHaveBeenCalledWith({
      actor: "bot",
      backendId: "mlx-lm",
    });
    await app.close();
  });

  it("delegates inference.backend.switch", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.switchBackend.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/inference.backend.switch",
      payload: { actor: "bot", backend_id: "vllm-openai" },
    });
    expect(response.statusCode).toBe(200);
    expect(inferenceTuningService.switchBackend).toHaveBeenCalledWith({
      actor: "bot",
      backendId: "vllm-openai",
    });
    await app.close();
  });

  it("lists inference backends", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.listBackends.mockResolvedValue([{ id: "mlx-lm" }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/inference/backends",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ id: "mlx-lm" }] });
    await app.close();
  });

  it("lists role runtime statuses", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.listRoleRuntimeStatuses.mockResolvedValue([{ role: "utility_fast" }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/providers/onprem/role-runtimes",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ role: "utility_fast" }] });
    await app.close();
  });

  it("tests a role runtime", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.testRoleRuntime.mockResolvedValue({ ok: true, latencyMs: 50 });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/onprem/role-runtimes/test",
      payload: { actor: "bot", role: "utility_fast" },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { ok: true, latencyMs: 50 } });
    await app.close();
  });

  it("starts a role runtime", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.startRoleRuntime.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/onprem/role-runtimes/start",
      payload: { actor: "bot", role: "coder_default" },
    });
    expect(response.statusCode).toBe(200);
    expect(inferenceTuningService.startRoleRuntime).toHaveBeenCalledWith({
      actor: "bot",
      role: "coder_default",
    });
    await app.close();
  });

  it("stops a role runtime", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.stopRoleRuntime.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/onprem/role-runtimes/stop",
      payload: { actor: "bot", role: "review_deep" },
    });
    expect(response.statusCode).toBe(200);
    expect(inferenceTuningService.stopRoleRuntime).toHaveBeenCalledWith({
      actor: "bot",
      role: "review_deep",
    });
    await app.close();
  });

  it("starts all enabled role runtimes", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.startEnabledRoleRuntimes.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v1/providers/onprem/role-runtimes/start-enabled",
      payload: { actor: "bot" },
    });
    expect(response.statusCode).toBe(200);
    expect(inferenceTuningService.startEnabledRoleRuntimes).toHaveBeenCalledWith({
      actor: "bot",
    });
    await app.close();
  });

  it("lists onprem plugins", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/providers/onprem/plugins",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.length).toBeGreaterThan(0);
    await app.close();
  });

  it("lists onprem backends", async () => {
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v1/providers/onprem/backends",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json().items.length).toBeGreaterThan(0);
    await app.close();
  });

  it("returns latest benchmarks with profile filter", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.getLatestBenchmarks.mockResolvedValue([{ profile: "interactive" }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/inference/benchmarks/latest?profile=interactive",
    });
    expect(response.statusCode).toBe(200);
    expect(inferenceTuningService.getLatestBenchmarks).toHaveBeenCalledWith("interactive");
    await app.close();
  });

  it("returns benchmark history with limit", async () => {
    const { app, inferenceTuningService } = createHarness();
    inferenceTuningService.getBenchmarkHistory.mockResolvedValue([]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/inference/benchmarks/history?profile=batch&limit=50",
    });
    expect(response.statusCode).toBe(200);
    expect(inferenceTuningService.getBenchmarkHistory).toHaveBeenCalledWith("batch", 50);
    await app.close();
  });
});

describe("runtimeRoutes distill endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.appSetting.upsert.mockResolvedValue(undefined);
  });

  it("generates a distill dataset", async () => {
    const { app, distillService } = createHarness();
    distillService.generateDataset.mockResolvedValue({ ok: true, dataset_id: "ds-1" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/distill.dataset.generate",
      payload: {
        actor: "bot",
        title: "Test Dataset",
        sample_count: 10,
        retrieval_context_ids: ["ctx-1"],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.generateDataset).toHaveBeenCalled();
    await app.close();
  });

  it("reviews a distill dataset", async () => {
    const { app, distillService } = createHarness();
    distillService.reviewDataset.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/distill.dataset.review",
      payload: {
        actor: "bot",
        dataset_id: "ds-1",
        decisions: [
          { example_id: "ex-1", decision: "approved" },
          { example_id: "ex-2", decision: "rejected", note: "bad quality" },
        ],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.reviewDataset).toHaveBeenCalledWith(
      expect.objectContaining({
        actor: "bot",
        dataset_id: "ds-1",
        decisions: expect.arrayContaining([
          expect.objectContaining({ example_id: "ex-1", decision: "approved" }),
        ]),
      }),
    );
    await app.close();
  });

  it("starts distill training", async () => {
    const { app, distillService } = createHarness();
    distillService.startTraining.mockResolvedValue({ ok: true, run_id: "run-1" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/distill.train.start",
      payload: {
        actor: "bot",
        dataset_id: "ds-1",
        stage: "sft",
        student_model_id: "student-1",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.startTraining).toHaveBeenCalled();
    await app.close();
  });

  it("runs distill eval", async () => {
    const { app, distillService } = createHarness();
    distillService.runEval.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/distill.eval.run",
      payload: {
        actor: "bot",
        run_id: "run-1",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.runEval).toHaveBeenCalled();
    await app.close();
  });

  it("promotes a distill model", async () => {
    const { app, distillService } = createHarness();
    distillService.promoteModel.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v2/commands/distill.model.promote",
      payload: {
        actor: "bot",
        run_id: "run-1",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.promoteModel).toHaveBeenCalled();
    await app.close();
  });

  it("gets a dataset by id", async () => {
    const { app, distillService } = createHarness();
    distillService.getDataset.mockResolvedValue({ id: "ds-1", title: "Test" });
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/distill/datasets/ds-1",
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.getDataset).toHaveBeenCalledWith("ds-1");
    await app.close();
  });

  it("gets a run by id", async () => {
    const { app, distillService } = createHarness();
    distillService.getRun.mockResolvedValue({ id: "run-1", status: "completed" });
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/distill/runs/run-1",
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.getRun).toHaveBeenCalledWith("run-1");
    await app.close();
  });

  it("gets run logs by id", async () => {
    const { app, distillService } = createHarness();
    distillService.getRunLogs.mockResolvedValue({ logs: [] });
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/distill/runs/run-1/logs",
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.getRunLogs).toHaveBeenCalledWith("run-1");
    await app.close();
  });

  it("gets eval by id", async () => {
    const { app, distillService } = createHarness();
    distillService.getEval.mockResolvedValue({ id: "eval-1" });
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/distill/evals/eval-1",
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.getEval).toHaveBeenCalledWith("eval-1");
    await app.close();
  });

  it("gets distill quota state", async () => {
    const { app, distillService } = createHarness();
    distillService.getQuotaState.mockResolvedValue({ remaining: 100 });
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/distill/quota",
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.getQuotaState).toHaveBeenCalled();
    await app.close();
  });

  it("gets distill readiness", async () => {
    const { app, distillService } = createHarness();
    distillService.getReadiness.mockResolvedValue({ ready: true });
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/distill/readiness",
    });
    expect(response.statusCode).toBe(200);
    expect(distillService.getReadiness).toHaveBeenCalled();
    await app.close();
  });

  it("lists distill models", async () => {
    const { app, distillService } = createHarness();
    distillService.listModels.mockResolvedValue([{ id: "model-1" }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/distill/models",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ id: "model-1" }] });
    await app.close();
  });
});

describe("runtimeRoutes v2 query endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
  });

  it("gets task board", async () => {
    const { app, v2QueryService } = createHarness();
    v2QueryService.getTaskBoard.mockResolvedValue({ columns: [] });
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/tasks/board?repoId=repo-1",
    });
    expect(response.statusCode).toBe(200);
    expect(v2QueryService.getTaskBoard).toHaveBeenCalledWith("repo-1");
    await app.close();
  });

  it("gets task timeline", async () => {
    const { app, v2QueryService } = createHarness();
    v2QueryService.getTaskTimeline.mockResolvedValue([{ event: "created" }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/tasks/task-1/timeline",
    });
    expect(response.statusCode).toBe(200);
    expect(v2QueryService.getTaskTimeline).toHaveBeenCalledWith("task-1");
    await app.close();
  });

  it("gets run replay", async () => {
    const { app, v2QueryService } = createHarness();
    v2QueryService.getRunReplay.mockResolvedValue([{ step: 1 }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/runs/run-1/replay",
    });
    expect(response.statusCode).toBe(200);
    expect(v2QueryService.getRunReplay).toHaveBeenCalledWith("run-1");
    await app.close();
  });

  it("gets pending policy items", async () => {
    const { app, v2QueryService } = createHarness();
    v2QueryService.getPendingPolicy.mockResolvedValue([{ id: "p-1" }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/policy/pending",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ id: "p-1" }] });
    await app.close();
  });

  it("searches knowledge with empty query", async () => {
    const { app, v2QueryService } = createHarness();
    v2QueryService.searchKnowledge.mockResolvedValue([]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/knowledge/search",
    });
    expect(response.statusCode).toBe(200);
    expect(v2QueryService.searchKnowledge).toHaveBeenCalledWith("");
    await app.close();
  });

  it("model plugins list with active/promoted flags", async () => {
    mocks.prisma.modelPluginRegistry.findMany.mockResolvedValue([
      { pluginId: "qwen3.5-4b", active: true, promoted: false },
    ]);
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v2/model/plugins",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.items.length).toBeGreaterThan(0);
    const qwen4b = body.items.find((p: { id: string }) => p.id === "qwen3.5-4b");
    expect(qwen4b.active).toBe(true);
    await app.close();
  });
});

describe("runtimeRoutes v3 router and context endpoints", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
  });

  it("delegates router.plan", async () => {
    const { app, routerService } = createHarness();
    routerService.planRoute.mockResolvedValue({ decision_id: "d-1" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/commands/router.plan",
      payload: {
        actor: "bot",
        prompt: "Implement feature X",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { decision_id: "d-1" } });
    await app.close();
  });

  it("delegates context.materialize", async () => {
    const { app, contextService } = createHarness();
    contextService.materializeContext.mockResolvedValue({ manifest_id: "m-1" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/commands/context.materialize",
      payload: {
        actor: "bot",
        aggregate_id: "ticket-1",
        aggregate_type: "ticket",
        goal: "Build feature",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(contextService.materializeContext).toHaveBeenCalled();
    await app.close();
  });

  it("delegates context.refresh (same as materialize)", async () => {
    const { app, contextService } = createHarness();
    contextService.materializeContext.mockResolvedValue({ manifest_id: "m-2" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/commands/context.refresh",
      payload: {
        actor: "bot",
        aggregate_id: "ticket-2",
        aggregate_type: "run",
        goal: "Refresh context",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(contextService.materializeContext).toHaveBeenCalled();
    await app.close();
  });

  it("delegates memory.commit", async () => {
    const { app, contextService } = createHarness();
    contextService.commitMemory.mockResolvedValue({ id: "mem-1" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/commands/memory.commit",
      payload: {
        actor: "bot",
        aggregate_id: "ticket-1",
        kind: "fact",
        content: "TypeScript is used",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { id: "mem-1" } });
    await app.close();
  });

  it("delegates agent.spawn", async () => {
    const { app, laneService } = createHarness();
    laneService.spawnLane.mockResolvedValue({ lane_id: "lane-1" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/commands/agent.spawn",
      payload: {
        actor: "bot",
        ticket_id: "ticket-1",
        role: "implementer",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { lane_id: "lane-1" } });
    await app.close();
  });

  it("delegates agent.reclaim", async () => {
    const { app, laneService } = createHarness();
    laneService.reclaimLane.mockResolvedValue([{ lane_id: "lane-1" }]);
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/commands/agent.reclaim",
      payload: {
        actor: "bot",
        lane_id: "lane-1",
        reason: "done",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ lane_id: "lane-1" }] });
    await app.close();
  });

  it("delegates run.merge.prepare", async () => {
    const { app, mergeService } = createHarness();
    mergeService.prepareMerge.mockResolvedValue({ merge_id: "merge-1" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/commands/run.merge.prepare",
      payload: {
        actor: "bot",
        run_id: "run-1",
        changed_files: ["src/index.ts"],
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { merge_id: "merge-1" } });
    await app.close();
  });

  it("delegates model.challenge.register", async () => {
    const { app, challengeService } = createHarness();
    challengeService.registerCandidate.mockResolvedValue({ candidate_id: "c-1" });
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/commands/model.challenge.register",
      payload: {
        actor: "bot",
        model_plugin_id: "qwen3.5-4b",
        dataset_id: "ds-1",
        eval_run_id: "eval-1",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { candidate_id: "c-1" } });
    await app.close();
  });

  it("delegates model.challenge.review", async () => {
    const { app, challengeService } = createHarness();
    challengeService.reviewCandidate.mockResolvedValue({ ok: true });
    const response = await app.inject({
      method: "POST",
      url: "/api/v3/commands/model.challenge.review",
      payload: {
        actor: "bot",
        candidate_id: "c-1",
        status: "approved",
      },
    });
    expect(response.statusCode).toBe(200);
    expect(challengeService.reviewCandidate).toHaveBeenCalled();
    await app.close();
  });

  it("gets router decision by id", async () => {
    const { app, routerService } = createHarness();
    routerService.getDecision.mockResolvedValue({ id: "d-1", providerId: "onprem-qwen" });
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/router/decisions/d-1",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { id: "d-1", providerId: "onprem-qwen" } });
    await app.close();
  });

  it("lists agent lanes with filters", async () => {
    const { app, laneService } = createHarness();
    laneService.listLanes.mockResolvedValue([{ lane_id: "lane-1" }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/agents/lanes?ticketId=t-1&runId=r-1",
    });
    expect(response.statusCode).toBe(200);
    expect(laneService.listLanes).toHaveBeenCalledWith({ ticketId: "t-1", runId: "r-1" });
    await app.close();
  });

  it("gets task context and routing", async () => {
    const { app, contextService, routerService } = createHarness();
    contextService.getLatestContext.mockResolvedValue({ manifest_id: "m-1" });
    routerService.listRecentForAggregate.mockResolvedValue([{ id: "d-1" }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/tasks/task-1/context",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({
      item: { manifest_id: "m-1" },
      routing: [{ id: "d-1" }],
    });
    await app.close();
  });

  it("gets task workflow state", async () => {
    const { app, contextService } = createHarness();
    contextService.getWorkflowState.mockResolvedValue({ phase: "building" });
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/tasks/task-1/workflow-state",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { phase: "building" } });
    await app.close();
  });

  it("searches memory", async () => {
    const { app, contextService } = createHarness();
    contextService.searchMemory.mockResolvedValue([{ id: "mem-1" }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/memory/search?q=typescript",
    });
    expect(response.statusCode).toBe(200);
    expect(contextService.searchMemory).toHaveBeenCalledWith("typescript");
    await app.close();
  });

  it("gets champion vs challenger", async () => {
    const { app, challengeService } = createHarness();
    challengeService.getChampionVsChallenger.mockResolvedValue({ champion: "a", challenger: "b" });
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/evals/champion-vs-challenger",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ champion: "a", challenger: "b" });
    await app.close();
  });

  it("gets merge report by run id", async () => {
    const { app, mergeService } = createHarness();
    mergeService.getMergeReport.mockResolvedValue({ status: "clean" });
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/runs/run-1/merge-report",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ item: { status: "clean" } });
    await app.close();
  });

  it("gets retrieval trace by run id", async () => {
    const { app, contextService } = createHarness();
    contextService.getRetrievalTrace.mockResolvedValue([{ source: "file", path: "/a.ts" }]);
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/runs/run-1/retrieval-trace",
    });
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ items: [{ source: "file", path: "/a.ts" }] });
    await app.close();
  });

  it("gets budget with default config when no openai config stored", async () => {
    mocks.prisma.appSetting.findUnique.mockResolvedValue(null);
    mocks.prisma.providerBudgetProjection.findFirst.mockResolvedValue(null);
    const { app } = createHarness();
    const response = await app.inject({
      method: "GET",
      url: "/api/v3/providers/openai/budget",
    });
    expect(response.statusCode).toBe(200);
    const body = response.json();
    expect(body.item.dailyBudgetUsd).toBe(25);
    expect(body.item.usedUsd).toBe(0);
    expect(body.item.remainingUsd).toBe(25);
    expect(body.item.requestCount).toBe(0);
    expect(body.item.cooldownUntil).toBeNull();
    await app.close();
  });
});
