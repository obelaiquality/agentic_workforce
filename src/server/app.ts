import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { createLogger } from "./logger";
import { initDatabase } from "./db";

const log = createLogger("App");
import { seedIfEmpty, seedModelPluginRegistry, seedV2ReadModels } from "./bootstrap";
import { ProviderFactory, wrapWithToolEmulation } from "./providers/factory";
import { QwenCliAdapter } from "./providers/qwenCliAdapter";
import { OpenAiResponsesAdapter } from "./providers/openaiResponsesAdapter";
import { OnPremQwenAdapter, OpenAiCompatibleAdapter } from "./providers/stubAdapters";
import { createToolRegistry } from "./tools/registry";
import { getAllCoreTools, createToolSearchTool } from "./tools/definitions";
import { registerLegacyRoutes } from "./routes/legacyRoutes";
import { registerChannelRoutes } from "./routes/channelRoutes";
import { registerMissionRoutes } from "./routes/missionRoutes";
import { registerProjectRoutes } from "./routes/projectRoutes";
import { registerRuntimeRoutes } from "./routes/runtimeRoutes";
import { registerMemoryRoutes } from "./routes/memoryRoutes";
import { registerSettingsRoutes } from "./routes/settingsRoutes";
import { registerAgenticRoutes } from "./routes/agenticRoutes";
import { registerTeamRoutes } from "./routes/teamRoutes";
import { registerTelemetryRoutes } from "./routes/telemetryRoutes";
import { registerSkillRoutes } from "./routes/skillRoutes";
import { registerHookRoutes } from "./routes/hookRoutes";
import { registerInterviewRoutes } from "./routes/interviewRoutes";
import { registerRalphRoutes } from "./routes/ralphRoutes";
import { registerEnhancedTeamRoutes } from "./routes/enhancedTeamRoutes";
import {
  isAuthorizedLocalApiRequest,
  isAllowedCorsOrigin,
} from "./routes/shared/http";
import { ApprovalService } from "./services/approvalService";
import { AuditService } from "./services/auditService";
import { BenchmarkService } from "./services/benchmarkService";
import { ChallengeService } from "./services/challengeService";
import { ChannelService } from "./services/channelService";
import { ChatService } from "./services/chatService";
import { CodeGraphService } from "./services/codeGraphService";
import { CommandEngine } from "./services/commandEngine";
import { ContextService } from "./services/contextService";
import { DistillService } from "./services/distillService";
import { ExecutionService } from "./services/executionService";
import { GitHubService } from "./services/githubService";
import { InferenceTuningService } from "./services/inferenceTuningService";
import { LaneService } from "./services/laneService";
import { MergeService } from "./services/mergeService";
import { MissionControlService } from "./services/missionControlService";
import { ProjectBlueprintService } from "./services/projectBlueprintService";
import { ProjectScaffoldService } from "./services/projectScaffoldService";
import { ProviderOrchestrator } from "./services/providerOrchestrator";
import { QwenAccountSetupService } from "./services/qwenAccountSetupService";
import { RepoService } from "./services/repoService";
import { RouterService } from "./services/routerService";
import { TicketService } from "./services/ticketService";
import { V2CommandService } from "./services/v2CommandService";
import { V2EventService } from "./services/v2EventService";
import { V2QueryService } from "./services/v2QueryService";
import { getSidecarClient } from "./sidecar/manager";
import { sanitizeUnicode } from "./services/sensitiveRedaction";
import { PermissionPolicyEngine } from "./permissions/policyEngine";
import { DEFAULT_POLICIES } from "./permissions/defaultPolicies";
import { SafetyClassifier } from "./permissions/safetyClassifier";
import { ContextCollapseService } from "./execution/contextCollapse";
import { createMCPServerRegistry } from "./mcp";
import { loadPersistedMcpServerConfigs } from "./integrations/integrationSettings";
import { getSharedLspClient, shutdownSharedLspClient } from "./lsp/sharedClient";
import { SkillService, createPrismaSkillPersistence } from "./skills/skillService";
import { HookService, createPrismaHookPersistence } from "./hooks/hookService";
import { PlanService, createPrismaPlanPersistence } from "./plans/planService";
import { SubtaskService, createPrismaSubtaskPersistence } from "./services/subtaskService";
import { setSkillService } from "./tools/definitions/skill";
import { setPlanService } from "./tools/definitions/planMode";
import { setSubtaskService } from "./tools/definitions/taskDecomposition";
import { DreamScheduler } from "./memory/dreamScheduler";
import { registerLearningsRoutes } from "./routes/learningsRoutes";
import { IdeSessionManager } from "./ide/ideSessionManager";
import { IdeBridgeServer } from "./ide/ideBridgeServer";

export async function createServer(apiToken = ""): Promise<FastifyInstance> {
  await initDatabase();
  await seedIfEmpty();

  const sidecar = await getSidecarClient();
  await seedV2ReadModels();
  await seedModelPluginRegistry();

  const providerFactory = new ProviderFactory();
  // Apply tool emulation wrapper to providers that don't natively support tools
  providerFactory.register(wrapWithToolEmulation(new QwenCliAdapter()));
  providerFactory.register(wrapWithToolEmulation(new OpenAiCompatibleAdapter()));
  providerFactory.register(wrapWithToolEmulation(new OnPremQwenAdapter()));
  providerFactory.register(wrapWithToolEmulation(new OpenAiResponsesAdapter()));

  // Create and populate tool registry
  const toolRegistry = createToolRegistry();
  toolRegistry.registerAll(getAllCoreTools());
  // Register tool_search (needs registry reference, so created after registry exists)
  toolRegistry.register(createToolSearchTool(toolRegistry));
  const mcpRegistry = createMCPServerRegistry();
  await mcpRegistry.replaceServers(await loadPersistedMcpServerConfigs(), toolRegistry);
  await mcpRegistry.connectAll(toolRegistry).catch((error) => {
    log.error("MCP bootstrap failed:", error);
  });
  // Start health monitoring for all connected MCP servers
  for (const server of mcpRegistry.getEnabledServers()) {
    mcpRegistry.getClient().startHealthMonitor(server.id);
  }
  const lspClient = getSharedLspClient();

  // Create permission policy engine with default policies
  const policyEngine = new PermissionPolicyEngine();
  for (const policy of DEFAULT_POLICIES) {
    policyEngine.addPolicy(policy);
  }

  const providerOrchestrator = new ProviderOrchestrator(providerFactory);
  const qwenAccountSetupService = new QwenAccountSetupService(providerOrchestrator);
  const ticketService = new TicketService();
  const skillService = new SkillService(createPrismaSkillPersistence());
  await skillService.initialize();
  setSkillService(skillService);
  const hookService = new HookService(createPrismaHookPersistence());
  await hookService.initialize();
  const planService = new PlanService(createPrismaPlanPersistence());
  setPlanService(planService);
  setSubtaskService(new SubtaskService(createPrismaSubtaskPersistence()));
  const chatService = new ChatService(providerOrchestrator);
  const channelService = new ChannelService(chatService);
  const approvalService = new ApprovalService();
  const auditService = new AuditService();
  const v2EventService = new V2EventService(sidecar);
  const v2QueryService = new V2QueryService(sidecar);
  const routerService = new RouterService(sidecar, v2EventService, providerOrchestrator);
  const v2CommandService = new V2CommandService(sidecar, providerOrchestrator, v2EventService, routerService);
  const inferenceTuningService = new InferenceTuningService(v2EventService);
  const distillService = new DistillService(sidecar, v2EventService);
  const contextService = new ContextService(v2EventService);
  const contextCollapseService = new ContextCollapseService();
  const laneService = new LaneService(sidecar, v2EventService);
  const mergeService = new MergeService(v2EventService);
  const challengeService = new ChallengeService(v2EventService);
  const codeGraphService = new CodeGraphService();

  codeGraphService.setContextShaper(async (input) => {
    const prompt = sanitizeUnicode([
      "You are a context selector. Given an objective and candidate file lists, return a JSON object with the most relevant subset.",
      `Objective: ${input.objective}`,
      `Candidate files: ${JSON.stringify(input.candidateFiles)}`,
      `Candidate tests: ${JSON.stringify(input.candidateTests)}`,
      `Candidate docs: ${JSON.stringify(input.candidateDocs)}`,
      `Candidate symbols: ${JSON.stringify(input.candidateSymbols)}`,
      "Return ONLY a JSON object: { files: [...], tests: [...], docs: [...], symbols: [...] }",
      "Keep only items directly relevant to the objective. Remove noise.",
    ].join("\n"));

    const result = await providerOrchestrator.streamChatWithRetry(
      `context-shaper-${Date.now()}`,
      [{ role: "user", content: prompt }],
      () => {},
      { modelRole: "utility_fast", querySource: "context_building" },
    );

    const match = result.text.match(/\{[\s\S]*\}/);
    if (!match) return input;
    const parsed = JSON.parse(match[0]);
    return {
      files: Array.isArray(parsed.files) ? parsed.files.filter((f: unknown) => typeof f === "string") : input.candidateFiles,
      tests: Array.isArray(parsed.tests) ? parsed.tests.filter((t: unknown) => typeof t === "string") : input.candidateTests,
      docs: Array.isArray(parsed.docs) ? parsed.docs.filter((d: unknown) => typeof d === "string") : input.candidateDocs,
      symbols: Array.isArray(parsed.symbols) ? parsed.symbols.filter((s: unknown) => typeof s === "string") : input.candidateSymbols,
    };
  });

  const safetyClassifier = new SafetyClassifier({ providerOrchestrator });
  policyEngine.addHook({
    phase: "post",
    execute: async ({ tool, params, ctx, currentDecision }) => {
      if (!ctx.ticketId) {
        return { override: false };
      }

      const policy = await ticketService.getTicketExecutionPolicy(ctx.ticketId).catch(() => null);
      if (!policy) {
        return { override: false };
      }

      const reasons: string[] = [];
      const requireApprovalFor = new Set(policy.requireApprovalFor);
      const scope = tool.permission.scope;

      const maybeCommand =
        typeof params === "object" && params !== null
          ? typeof (params as Record<string, unknown>).command === "string"
            ? String((params as Record<string, unknown>).command)
            : typeof (params as Record<string, unknown>).cmd === "string"
            ? String((params as Record<string, unknown>).cmd)
            : null
          : null;

      if (tool.name === "bash" && maybeCommand) {
        const safety = await safetyClassifier.classifyCommand(maybeCommand);
        if (safety === "dangerous") {
          return {
            override: true,
            decision: {
              decision: "deny",
              requiresApproval: false,
              reasons: ["Command classified as dangerous for this ticket."],
              source: "policy",
            },
          };
        }
      }

      if (policy.mode === "strict" && tool.permission.readOnly !== true) {
        reasons.push("Strict ticket policy requires approval for non-read-only tools.");
      }

      if (scope === "repo.install" && !policy.allowInstallCommands) {
        reasons.push("Ticket policy requires approval for install actions.");
      }

      if (scope === "network" && !policy.allowNetworkCommands) {
        reasons.push("Ticket policy requires approval for network actions.");
      }

      if (requireApprovalFor.has("*") || requireApprovalFor.has(scope)) {
        reasons.push(`Ticket policy requires approval for ${scope}.`);
      }

      if (reasons.length === 0) {
        return { override: false };
      }

      if (currentDecision?.decision === "deny") {
        return { override: false };
      }

      return {
        override: true,
        decision: {
          decision: "approval_required",
          requiresApproval: true,
          reasons,
          source: "policy",
        },
      };
    },
  });

  const projectBlueprintService = new ProjectBlueprintService();
  const repoService = new RepoService(v2EventService, codeGraphService, projectBlueprintService);
  const dreamScheduler = new DreamScheduler({
    intervalHours: 24,
    getProjectWorktrees: async () => {
      const repos = await repoService.listRepos();
      return Promise.all(
        repos.map(async (repo) => ({
          projectId: repo.id,
          worktreePath: await repoService.getActiveWorktreePath(repo.id),
        })),
      );
    },
  });
  dreamScheduler.start();
  const commandEngine = new CommandEngine(ticketService);
  const executionService = new ExecutionService(
    v2EventService,
    routerService,
    contextService,
    providerOrchestrator,
    repoService,
    codeGraphService,
    commandEngine,
    policyEngine,
    approvalService,
    contextCollapseService,
    hookService,
    planService,
    lspClient,
  );
  const githubService = new GitHubService(repoService);
  const projectScaffoldService = new ProjectScaffoldService(
    repoService,
    projectBlueprintService,
    executionService,
    providerOrchestrator,
  );
  const missionControlService = new MissionControlService(
    repoService,
    projectBlueprintService,
    chatService,
    ticketService,
    v2QueryService,
    routerService,
    contextService,
    codeGraphService,
    githubService,
    () => ({
      running: dreamScheduler.isRunning,
      lastDreamAt: dreamScheduler.stats.lastDreamAt,
      dreamCount: dreamScheduler.stats.dreamCount,
      learningsCount: dreamScheduler.stats.learningsCount,
      principlesCount: dreamScheduler.stats.principlesCount,
      suggestedSkillsCount: dreamScheduler.stats.suggestedSkillsCount,
    }),
  );
  const benchmarkService = new BenchmarkService(v2EventService, repoService, executionService);
  await benchmarkService.syncProjectManifests().catch(() => []);

  const app = Fastify({
    logger: true,
    bodyLimit: 2 * 1024 * 1024, // 2 MB
    requestTimeout: 120_000,    // 2 minutes
  });

  await app.register(cors, {
    origin: (origin, callback) => {
      if (!origin) {
        callback(null, true);
        return;
      }
      callback(null, isAllowedCorsOrigin(origin));
    },
    credentials: false,
    allowedHeaders: ["content-type", "x-local-api-token"],
  });

  app.addHook("preHandler", async (request, reply) => {
    if (request.method === "OPTIONS") {
      return;
    }

    if (isAuthorizedLocalApiRequest({
      url: request.url,
      apiToken,
      headerToken: request.headers["x-local-api-token"],
    })) {
      return;
    }

    return reply.code(401).send({ error: "Unauthorized local API request" });
  });

  registerProjectRoutes({
    app,
    repoService,
    benchmarkService,
    codeGraphService,
    executionService,
    githubService,
    projectBlueprintService,
    projectScaffoldService,
  });

  registerMissionRoutes({
    app,
    apiToken,
    approvalService,
    chatService,
    codeGraphService,
    commandEngine,
    contextService,
    executionService,
    githubService,
    missionControlService,
    projectBlueprintService,
    providerOrchestrator,
    repoService,
    routerService,
    ticketService,
    v2CommandService,
    v2EventService,
    v2QueryService,
  });

  registerRuntimeRoutes({
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
  });

  registerLegacyRoutes({
    app,
    approvalService,
    auditService,
    chatService,
    commandEngine,
    providerOrchestrator,
    qwenAccountSetupService,
    ticketService,
    v2EventService,
  });

  registerChannelRoutes({
    app,
    approvalService,
    channelService,
    commandEngine,
    executionService,
    projectBlueprintService,
    repoService,
    ticketService,
    v2EventService,
  });

  registerMemoryRoutes({
    app,
    repoService,
  });

  registerSettingsRoutes({
    app,
    channelService,
    mcpRegistry,
    toolRegistry,
    lspClient,
  });

  registerAgenticRoutes({
    app,
    toolRegistry,
    executionService,
    repoService,
    ticketService,
    planService,
  });

  registerSkillRoutes(app, skillService);
  registerHookRoutes(app, hookService);
  registerTeamRoutes({ app });
  registerInterviewRoutes({ app, providerOrchestrator });
  registerRalphRoutes({ app, providerOrchestrator, executionService });
  registerEnhancedTeamRoutes({ app, providerOrchestrator });
  registerTelemetryRoutes(app);
  registerLearningsRoutes({ app, repoService });

  // ── IDE Bridge ─────────────────────────────────────────────────
  const ideSessionManager = new IdeSessionManager();
  const ideBridgeServer = new IdeBridgeServer(ideSessionManager);
  ideBridgeServer.register(app);

  app.get("/health", async () => ({ ok: true }));

  app.addHook("onClose", async () => {
    // Stop MCP health monitors before shutting down connections
    for (const server of mcpRegistry.getEnabledServers()) {
      mcpRegistry.getClient().stopHealthMonitor(server.id);
    }
    await Promise.allSettled([
      mcpRegistry.shutdown(),
      shutdownSharedLspClient(),
    ]);
    dreamScheduler.stop();
  });

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(500).send({
      error: error.message,
    });
  });

  return app;
}
