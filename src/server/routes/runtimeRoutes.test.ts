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
    inferenceTuningService,
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
});
