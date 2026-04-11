/**
 * Unit tests for app.ts
 * Smoke tests for the createServer export.
 *
 * app.ts initializes 30+ services and registers 15+ routes, making full
 * integration testing impractical in a unit test context. This file verifies
 * the module exports correctly and that createServer is a callable async
 * function.
 */
import { describe, it, expect, vi } from "vitest";

// Heavy mocking required — createServer wires up the entire application.
// We mock every service and route registration to avoid real side-effects.

vi.mock("./db", () => ({
  prisma: { appSetting: { findUnique: vi.fn().mockResolvedValue(null) } },
  initDatabase: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./logger", () => ({
  createLogger: vi.fn().mockReturnValue({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  }),
}));

vi.mock("./bootstrap", () => ({
  seedIfEmpty: vi.fn().mockResolvedValue(undefined),
  seedV2ReadModels: vi.fn().mockResolvedValue(undefined),
  seedModelPluginRegistry: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./providers/factory", () => ({
  ProviderFactory: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
  })),
  wrapWithToolEmulation: vi.fn().mockImplementation((adapter) => adapter),
}));

vi.mock("./providers/qwenCliAdapter", () => ({
  QwenCliAdapter: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./providers/openaiResponsesAdapter", () => ({
  OpenAiResponsesAdapter: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./providers/stubAdapters", () => ({
  OnPremQwenAdapter: vi.fn().mockImplementation(() => ({})),
  OpenAiCompatibleAdapter: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./tools/registry", () => ({
  createToolRegistry: vi.fn().mockReturnValue({
    registerAll: vi.fn(),
    register: vi.fn(),
  }),
}));

vi.mock("./tools/definitions", () => ({
  getAllCoreTools: vi.fn().mockReturnValue([]),
  createToolSearchTool: vi.fn().mockReturnValue({}),
}));

vi.mock("./sidecar/manager", () => ({
  getSidecarClient: vi.fn().mockResolvedValue({}),
}));

vi.mock("./mcp", () => ({
  createMCPServerRegistry: vi.fn().mockReturnValue({
    replaceServers: vi.fn().mockResolvedValue(undefined),
    connectAll: vi.fn().mockResolvedValue(undefined),
    getEnabledServers: vi.fn().mockReturnValue([]),
    getClient: vi.fn().mockReturnValue({
      startHealthMonitor: vi.fn(),
      stopHealthMonitor: vi.fn(),
    }),
    shutdown: vi.fn().mockResolvedValue(undefined),
  }),
}));

vi.mock("./integrations/integrationSettings", () => ({
  loadPersistedMcpServerConfigs: vi.fn().mockResolvedValue([]),
}));

vi.mock("./lsp/sharedClient", () => ({
  getSharedLspClient: vi.fn().mockReturnValue({}),
  shutdownSharedLspClient: vi.fn().mockResolvedValue(undefined),
}));

vi.mock("./services/sensitiveRedaction", () => ({
  sanitizeUnicode: vi.fn().mockImplementation((s: string) => s),
}));

vi.mock("./permissions/policyEngine", () => ({
  PermissionPolicyEngine: vi.fn().mockImplementation(() => ({
    addPolicy: vi.fn(),
    addHook: vi.fn(),
  })),
}));

vi.mock("./permissions/defaultPolicies", () => ({
  DEFAULT_POLICIES: [],
}));

vi.mock("./permissions/safetyClassifier", () => ({
  SafetyClassifier: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./execution/contextCollapse", () => ({
  ContextCollapseService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/approvalService", () => ({
  ApprovalService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/auditService", () => ({
  AuditService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/benchmarkService", () => ({
  BenchmarkService: vi.fn().mockImplementation(() => ({
    syncProjectManifests: vi.fn().mockResolvedValue([]),
  })),
}));

vi.mock("./services/challengeService", () => ({
  ChallengeService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/channelService", () => ({
  ChannelService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/chatService", () => ({
  ChatService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/codeGraphService", () => ({
  CodeGraphService: vi.fn().mockImplementation(() => ({
    setContextShaper: vi.fn(),
  })),
}));

vi.mock("./services/commandEngine", () => ({
  CommandEngine: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/contextService", () => ({
  ContextService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/distillService", () => ({
  DistillService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/executionService", () => ({
  ExecutionService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/githubService", () => ({
  GitHubService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/inferenceTuningService", () => ({
  InferenceTuningService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/laneService", () => ({
  LaneService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/mergeService", () => ({
  MergeService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/missionControlService", () => ({
  MissionControlService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/projectBlueprintService", () => ({
  ProjectBlueprintService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/projectScaffoldService", () => ({
  ProjectScaffoldService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/providerOrchestrator", () => ({
  ProviderOrchestrator: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/qwenAccountSetupService", () => ({
  QwenAccountSetupService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/repoService", () => ({
  RepoService: vi.fn().mockImplementation(() => ({
    listRepos: vi.fn().mockResolvedValue([]),
    getActiveWorktreePath: vi.fn().mockResolvedValue("/tmp"),
  })),
}));

vi.mock("./services/routerService", () => ({
  RouterService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/ticketService", () => ({
  TicketService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/v2CommandService", () => ({
  V2CommandService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/v2EventService", () => ({
  V2EventService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/v2QueryService", () => ({
  V2QueryService: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./services/subtaskService", () => ({
  SubtaskService: vi.fn().mockImplementation(() => ({})),
  createPrismaSubtaskPersistence: vi.fn().mockReturnValue({}),
}));

vi.mock("./skills/skillService", () => ({
  SkillService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
  createPrismaSkillPersistence: vi.fn().mockReturnValue({}),
}));

vi.mock("./hooks/hookService", () => ({
  HookService: vi.fn().mockImplementation(() => ({
    initialize: vi.fn().mockResolvedValue(undefined),
  })),
  createPrismaHookPersistence: vi.fn().mockReturnValue({}),
}));

vi.mock("./plans/planService", () => ({
  PlanService: vi.fn().mockImplementation(() => ({})),
  createPrismaPlanPersistence: vi.fn().mockReturnValue({}),
}));

vi.mock("./tools/definitions/skill", () => ({
  setSkillService: vi.fn(),
}));

vi.mock("./tools/definitions/planMode", () => ({
  setPlanService: vi.fn(),
}));

vi.mock("./tools/definitions/taskDecomposition", () => ({
  setSubtaskService: vi.fn(),
}));

vi.mock("./memory/dreamScheduler", () => ({
  DreamScheduler: vi.fn().mockImplementation(() => ({
    start: vi.fn(),
    stop: vi.fn(),
    isRunning: false,
    stats: {
      lastDreamAt: null,
      dreamCount: 0,
      learningsCount: 0,
      principlesCount: 0,
      suggestedSkillsCount: 0,
    },
  })),
}));

vi.mock("./ide/ideSessionManager", () => ({
  IdeSessionManager: vi.fn().mockImplementation(() => ({})),
}));

vi.mock("./ide/ideBridgeServer", () => ({
  IdeBridgeServer: vi.fn().mockImplementation(() => ({
    register: vi.fn(),
  })),
}));

vi.mock("./routes/legacyRoutes", () => ({
  registerLegacyRoutes: vi.fn(),
}));

vi.mock("./routes/channelRoutes", () => ({
  registerChannelRoutes: vi.fn(),
}));

vi.mock("./routes/missionRoutes", () => ({
  registerMissionRoutes: vi.fn(),
}));

vi.mock("./routes/projectRoutes", () => ({
  registerProjectRoutes: vi.fn(),
}));

vi.mock("./routes/runtimeRoutes", () => ({
  registerRuntimeRoutes: vi.fn(),
}));

vi.mock("./routes/memoryRoutes", () => ({
  registerMemoryRoutes: vi.fn(),
}));

vi.mock("./routes/settingsRoutes", () => ({
  registerSettingsRoutes: vi.fn(),
}));

vi.mock("./routes/agenticRoutes", () => ({
  registerAgenticRoutes: vi.fn(),
}));

vi.mock("./routes/teamRoutes", () => ({
  registerTeamRoutes: vi.fn(),
}));

vi.mock("./routes/telemetryRoutes", () => ({
  registerTelemetryRoutes: vi.fn(),
}));

vi.mock("./routes/skillRoutes", () => ({
  registerSkillRoutes: vi.fn(),
}));

vi.mock("./routes/hookRoutes", () => ({
  registerHookRoutes: vi.fn(),
}));

vi.mock("./routes/interviewRoutes", () => ({
  registerInterviewRoutes: vi.fn(),
}));

vi.mock("./routes/ralphRoutes", () => ({
  registerRalphRoutes: vi.fn(),
}));

vi.mock("./routes/enhancedTeamRoutes", () => ({
  registerEnhancedTeamRoutes: vi.fn(),
}));

vi.mock("./routes/learningsRoutes", () => ({
  registerLearningsRoutes: vi.fn(),
}));

vi.mock("./routes/shared/http", () => ({
  isAuthorizedLocalApiRequest: vi.fn().mockReturnValue(true),
  isAllowedCorsOrigin: vi.fn().mockReturnValue(true),
}));

import { createServer } from "./app";

describe("app module", () => {
  it("exports createServer as a function", () => {
    expect(typeof createServer).toBe("function");
  });

  it("createServer returns a promise", () => {
    const result = createServer("test-token");
    expect(result).toBeInstanceOf(Promise);
    // Clean up — let the promise settle
    return result.then((app) => app.close());
  });

  it("createServer resolves to a Fastify instance with expected methods", async () => {
    const app = await createServer("test-token");

    expect(app).toBeDefined();
    expect(typeof app.listen).toBe("function");
    expect(typeof app.close).toBe("function");
    expect(typeof app.get).toBe("function");
    expect(typeof app.post).toBe("function");

    await app.close();
  });

  it("registers a /health route", async () => {
    const app = await createServer("test-token");

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-local-api-token": "test-token" },
    });

    expect(response.statusCode).toBe(200);
    expect(JSON.parse(response.body)).toEqual({ ok: true });

    await app.close();
  });

  it("returns 401 for unauthorized requests", async () => {
    // Import the mock to change its behavior
    const { isAuthorizedLocalApiRequest } = await import("./routes/shared/http");
    const mockFn = isAuthorizedLocalApiRequest as ReturnType<typeof vi.fn>;

    const app = await createServer("test-token");

    // Make the auth check fail
    mockFn.mockReturnValueOnce(false);

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {},
    });

    expect(response.statusCode).toBe(401);
    expect(JSON.parse(response.body)).toEqual({ error: "Unauthorized local API request" });

    await app.close();
  });

  it("passes through OPTIONS requests without auth", async () => {
    const app = await createServer("test-token");

    const response = await app.inject({
      method: "OPTIONS",
      url: "/health",
    });

    // OPTIONS should not get 401
    expect(response.statusCode).not.toBe(401);

    await app.close();
  });

  it("error handler returns 500 with error message", async () => {
    const app = await createServer("test-token");

    // Register a route that throws an error to trigger the error handler
    app.get("/test-error", async () => {
      throw new Error("Test error message");
    });

    const response = await app.inject({
      method: "GET",
      url: "/test-error",
      headers: { "x-local-api-token": "test-token" },
    });

    expect(response.statusCode).toBe(500);
    expect(JSON.parse(response.body)).toEqual({ error: "Test error message" });

    await app.close();
  });

  it("createServer can be called with default empty token", async () => {
    const app = await createServer();
    expect(app).toBeDefined();
    await app.close();
  });

  it("onClose hook executes without error", async () => {
    const app = await createServer("test-token");

    // Calling close triggers the onClose hook
    await expect(app.close()).resolves.toBeUndefined();
  });

  it("CORS allows requests with no origin", async () => {
    const app = await createServer("test-token");

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: { "x-local-api-token": "test-token" },
    });

    // No origin header → should be allowed
    expect(response.statusCode).toBe(200);

    await app.close();
  });

  it("CORS calls isAllowedCorsOrigin for requests with origin", async () => {
    const { isAllowedCorsOrigin } = await import("./routes/shared/http");
    const mockCorsFn = isAllowedCorsOrigin as ReturnType<typeof vi.fn>;

    const app = await createServer("test-token");

    mockCorsFn.mockReturnValueOnce(true);

    const response = await app.inject({
      method: "GET",
      url: "/health",
      headers: {
        "x-local-api-token": "test-token",
        origin: "http://localhost:3000",
      },
    });

    expect(response.statusCode).toBe(200);
    expect(mockCorsFn).toHaveBeenCalledWith("http://localhost:3000");

    await app.close();
  });
});
