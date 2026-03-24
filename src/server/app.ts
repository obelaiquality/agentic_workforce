import Fastify, { type FastifyInstance } from "fastify";
import cors from "@fastify/cors";
import { initDatabase } from "./db";
import { seedIfEmpty, seedModelPluginRegistry, seedV2ReadModels } from "./bootstrap";
import { ProviderFactory } from "./providers/factory";
import { QwenCliAdapter } from "./providers/qwenCliAdapter";
import { OpenAiResponsesAdapter } from "./providers/openaiResponsesAdapter";
import { OnPremQwenAdapter, OpenAiCompatibleAdapter } from "./providers/stubAdapters";
import { registerLegacyRoutes } from "./routes/legacyRoutes";
import { registerChannelRoutes } from "./routes/channelRoutes";
import { registerMissionRoutes } from "./routes/missionRoutes";
import { registerProjectRoutes } from "./routes/projectRoutes";
import { registerRuntimeRoutes } from "./routes/runtimeRoutes";
import { registerSettingsRoutes } from "./routes/settingsRoutes";
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

export async function createServer(apiToken = ""): Promise<FastifyInstance> {
  await initDatabase();
  await seedIfEmpty();

  const sidecar = await getSidecarClient();
  await seedV2ReadModels();
  await seedModelPluginRegistry();

  const providerFactory = new ProviderFactory();
  providerFactory.register(new QwenCliAdapter());
  providerFactory.register(new OpenAiCompatibleAdapter());
  providerFactory.register(new OnPremQwenAdapter());
  providerFactory.register(new OpenAiResponsesAdapter());

  const providerOrchestrator = new ProviderOrchestrator(providerFactory);
  const qwenAccountSetupService = new QwenAccountSetupService(providerOrchestrator);
  const ticketService = new TicketService();
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
  const laneService = new LaneService(sidecar, v2EventService);
  const mergeService = new MergeService(v2EventService);
  const challengeService = new ChallengeService(v2EventService);
  const codeGraphService = new CodeGraphService();

  codeGraphService.setContextShaper(async (input) => {
    const prompt = [
      "You are a context selector. Given an objective and candidate file lists, return a JSON object with the most relevant subset.",
      `Objective: ${input.objective}`,
      `Candidate files: ${JSON.stringify(input.candidateFiles)}`,
      `Candidate tests: ${JSON.stringify(input.candidateTests)}`,
      `Candidate docs: ${JSON.stringify(input.candidateDocs)}`,
      `Candidate symbols: ${JSON.stringify(input.candidateSymbols)}`,
      "Return ONLY a JSON object: { files: [...], tests: [...], docs: [...], symbols: [...] }",
      "Keep only items directly relevant to the objective. Remove noise.",
    ].join("\n");

    const result = await providerOrchestrator.streamChat(
      `context-shaper-${Date.now()}`,
      [{ role: "user", content: prompt }],
      () => {},
      { modelRole: "utility_fast" },
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

  const projectBlueprintService = new ProjectBlueprintService();
  const repoService = new RepoService(v2EventService, codeGraphService, projectBlueprintService);
  const commandEngine = new CommandEngine(ticketService);
  const executionService = new ExecutionService(
    v2EventService,
    routerService,
    contextService,
    providerOrchestrator,
    repoService,
    codeGraphService,
    commandEngine,
  );
  const githubService = new GitHubService(repoService);
  const projectScaffoldService = new ProjectScaffoldService(repoService, projectBlueprintService, executionService);
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
  );
  const benchmarkService = new BenchmarkService(v2EventService, repoService, executionService);
  await benchmarkService.syncProjectManifests().catch(() => []);

  const app = Fastify({ logger: true });

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
    ticketService,
    v2EventService,
  });

  registerSettingsRoutes({
    app,
    channelService,
  });

  app.get("/health", async () => ({ ok: true }));

  app.setErrorHandler((error, _request, reply) => {
    app.log.error(error);
    reply.code(500).send({
      error: error.message,
    });
  });

  return app;
}
