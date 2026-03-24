import { randomUUID } from "node:crypto";
import path from "node:path";
import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { prisma } from "../db";
import { eventBus } from "../eventBus";
import { ApprovalService } from "../services/approvalService";
import { ChatService } from "../services/chatService";
import { CodeGraphService } from "../services/codeGraphService";
import { CommandEngine } from "../services/commandEngine";
import { ContextService } from "../services/contextService";
import { ExecutionService, resolveDependencyBootstrapCommand } from "../services/executionService";
import { GitHubService } from "../services/githubService";
import { MissionControlService } from "../services/missionControlService";
import { ProjectBlueprintService } from "../services/projectBlueprintService";
import { ProviderOrchestrator, applyEscalationPolicy } from "../services/providerOrchestrator";
import { RepoService } from "../services/repoService";
import { RouterService } from "../services/routerService";
import { TicketService } from "../services/ticketService";
import { V2CommandService } from "../services/v2CommandService";
import { V2EventService } from "../services/v2EventService";
import { V2QueryService } from "../services/v2QueryService";
import { buildVerificationPlan } from "../services/verificationPolicy";
import { decideApprovalWithCommandFollowup } from "./shared/commandApproval";
import { buildStreamHeaders } from "./shared/http";
import {
  buildExecutionProfileSnapshot,
  normalizeExecutionProfiles,
  resolveExecutionProfile,
} from "./shared/runtimeConfig";
import { syncTaskProjectionFromTicket } from "./shared/ticketProjection";
import type { ConsoleEvent, TicketStatus } from "../../shared/contracts";

const missionSnapshotQuerySchema = z.object({
  projectId: z.string().optional(),
  ticketId: z.string().optional(),
  runId: z.string().optional(),
  sessionId: z.string().optional(),
});

const missionCodebaseFileQuerySchema = z.object({
  projectId: z.string().min(1),
  path: z.string().min(1),
});

const missionTaskDetailQuerySchema = z.object({
  projectId: z.string().optional(),
  taskId: z.string().min(1),
});

const v8OverseerChatSchema = z.object({
  actor: z.string().min(1),
  project_id: z.string().optional(),
  session_id: z.string().optional(),
  content: z.string().min(1),
  model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
});

const v8OverseerRouteReviewSchema = z.object({
  actor: z.string().min(1),
  project_id: z.string().min(1),
  ticket_id: z.string().optional(),
  prompt: z.string().min(1),
  risk_level: z.enum(["low", "medium", "high"]).optional(),
  execution_profile_id: z.string().optional(),
});

const v8OverseerExecuteSchema = z.object({
  actor: z.string().min(1),
  project_id: z.string().min(1),
  ticket_id: z.string().optional(),
  prompt: z.string().min(1),
  model_role: z.enum(["utility_fast", "coder_default", "review_deep", "overseer_escalation"]).optional(),
  provider_id: z.enum(["qwen-cli", "openai-compatible", "onprem-qwen", "openai-responses"]).optional(),
  execution_profile_id: z.string().optional(),
});

const v9MissionExecuteSchema = v8OverseerExecuteSchema.extend({
  permission_mode: z.enum(["balanced", "strict"]).optional(),
});

const v9TicketPermissionSchema = z.object({
  actor: z.string().min(1).optional(),
  ticket_id: z.string().min(1),
  mode: z.enum(["balanced", "strict"]),
  allow_install_commands: z.boolean().optional(),
  allow_network_commands: z.boolean().optional(),
  require_approval_for: z.array(z.string()).optional(),
});

const v9DependencyBootstrapSchema = z.object({
  actor: z.string().min(1),
  run_id: z.string().min(1),
  repo_id: z.string().min(1),
  ticket_id: z.string().min(1),
  stage: z.enum(["scope", "build", "review", "escalate"]),
});

const v9TicketPolicyQuerySchema = z.object({
  ticketId: z.string().min(1),
});

const v9LifecycleReconcileSchema = z.object({
  actor: z.string().min(1).optional(),
  project_id: z.string().optional(),
  archive_stale_synthetic: z.boolean().optional(),
});

const v9TicketAutocompleteSchema = z.object({
  actor: z.string().min(1).optional(),
  ticket_id: z.string().min(1),
});

type MissionRouteDeps = {
  app: FastifyInstance;
  apiToken: string;
  approvalService: ApprovalService;
  chatService: ChatService;
  codeGraphService: CodeGraphService;
  commandEngine: CommandEngine;
  contextService: ContextService;
  executionService: ExecutionService;
  githubService: GitHubService;
  missionControlService: MissionControlService;
  projectBlueprintService: ProjectBlueprintService;
  providerOrchestrator: ProviderOrchestrator;
  repoService: RepoService;
  routerService: RouterService;
  ticketService: TicketService;
  v2CommandService: V2CommandService;
  v2EventService: V2EventService;
  v2QueryService: V2QueryService;
};

async function ensureMissionTicket(ticketService: TicketService, repoId: string, prompt: string, ticketId?: string) {
  if (ticketId) {
    const tickets = await ticketService.listTickets(repoId);
    const existing = tickets.find((ticket) => ticket.id === ticketId);
    if (existing) {
      return existing;
    }
  }

  const title = prompt.split("\n")[0].trim().slice(0, 96) || "New objective";
  return ticketService.createTicket({
    repoId,
    title,
    description: prompt,
    status: "backlog",
    priority: "p2",
    risk: "medium",
    acceptanceCriteria: [
      "Implement the requested change.",
      "Verify impacted behavior.",
      "Update docs if user-facing or operational behavior changes.",
    ],
  });
}

function buildVerificationPlanForRun(input: {
  blueprint: Awaited<ReturnType<ProjectBlueprintService["get"]>>;
  guidelines: Awaited<ReturnType<RepoService["getGuidelines"]>>;
}) {
  return buildVerificationPlan({
    blueprint: input.blueprint,
    guidelines: input.guidelines,
    includeInstall: false,
  });
}

function hasInfrastructureVerificationFailure(failures: string[] | undefined) {
  const list = failures || [];
  return list.some(
    (failure) =>
      failure.startsWith("infra_missing_tool:") ||
      failure.startsWith("infra_missing_dependency:") ||
      failure.startsWith("infra_command_timeout:") ||
      failure.startsWith("setup_failed:")
  );
}

function hasApprovalVerificationFailure(failures: string[] | undefined) {
  const list = failures || [];
  return list.some(
    (failure) => failure.startsWith("approval_required:") || failure.startsWith("approval_request:") || failure.startsWith("policy_denied:")
  );
}

function mapConsoleCategory(type: string): ConsoleEvent["category"] {
  if (type.startsWith("execution.") || type.startsWith("task.")) return "execution";
  if (type.startsWith("command.tool")) return "execution";
  if (type.startsWith("verification.") || type.includes("verify")) return "verification";
  if (type.startsWith("approval.") || type.includes("approval")) return "approval";
  if (type.startsWith("repo.index") || type.startsWith("codegraph") || type.includes("context.pack")) return "indexing";
  return "provider";
}

function mapConsoleLevel(type: string): ConsoleEvent["level"] {
  if (type.includes("failed") || type.includes("error") || type.includes("rejected")) return "error";
  if (type.includes("pending") || type.includes("cooldown") || type.includes("warn")) return "warn";
  return "info";
}

function summarizeConsoleString(value: string, max = 84) {
  const compact = value.replace(/\s+/g, " ").trim();
  if (compact.length <= max) return compact;
  return `${compact.slice(0, max - 3)}...`;
}

function normalizeConsoleValue(value: unknown): unknown {
  if (typeof value === "string") return summarizeConsoleString(value);
  if (typeof value === "number" || typeof value === "boolean" || value === null) return value;
  if (Array.isArray(value)) {
    if (value.length === 0) return [];
    return value
      .slice(0, 3)
      .map((item) => (typeof item === "string" ? summarizeConsoleString(item) : normalizeConsoleValue(item)));
  }
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const entries = Object.entries(record).slice(0, 6);
    const next: Record<string, unknown> = {};
    for (const [key, entryValue] of entries) {
      next[key] = normalizeConsoleValue(entryValue);
    }
    return next;
  }
  return String(value ?? "");
}

function compactConsolePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return null;
  }

  const record = payload as Record<string, unknown>;
  const preferredKeys = [
    "run_id",
    "runId",
    "repo_id",
    "repoId",
    "project_id",
    "projectId",
    "ticket_id",
    "ticketId",
    "aggregate_type",
    "aggregateType",
    "status",
    "execution_mode",
    "executionMode",
    "verification_depth",
    "verificationDepth",
    "provider_id",
    "providerId",
    "model_role",
    "modelRole",
    "max_lanes",
    "maxLanes",
    "context_manifest_id",
    "contextManifestId",
    "retrieval_trace_id",
    "retrievalTraceId",
    "approval_id",
    "approvalId",
    "reason",
    "errors",
    "failures",
    "rationale",
  ];

  const compact: Record<string, unknown> = {};
  for (const key of preferredKeys) {
    if (!(key in record)) continue;
    const normalized = normalizeConsoleValue(record[key]);
    if (normalized === undefined || normalized === null || normalized === "") continue;
    compact[key] = normalized;
    if (Object.keys(compact).length >= 8) break;
  }

  if (!Object.keys(compact).length) {
    for (const [key, value] of Object.entries(record)) {
      const normalized = normalizeConsoleValue(value);
      if (normalized === undefined || normalized === null || normalized === "") continue;
      compact[key] = normalized;
      if (Object.keys(compact).length >= 8) break;
    }
  }

  return Object.keys(compact).length ? compact : null;
}

function buildConsoleMessage(type: string, payload: unknown) {
  const headline = type.replace(/\./g, " ");
  const compact = compactConsolePayload(payload);
  return compact ? `${headline} ${JSON.stringify(compact)}` : headline;
}

function extractConsoleProjectId(payload: unknown): string | null {
  if (!payload || typeof payload !== "object") return null;
  const record = payload as Record<string, unknown>;
  const candidate =
    (typeof record.repoId === "string" && record.repoId) ||
    (typeof record.repo_id === "string" && record.repo_id) ||
    (typeof record.projectId === "string" && record.projectId) ||
    (typeof record.project_id === "string" && record.project_id);
  return candidate || null;
}

function extractConsoleTaskId(payload: unknown, aggregateId: string | null | undefined, projectId: string | null): string | null {
  if (payload && typeof payload === "object") {
    const record = payload as Record<string, unknown>;
    const explicit =
      (typeof record.ticketId === "string" && record.ticketId) ||
      (typeof record.ticket_id === "string" && record.ticket_id) ||
      (typeof record.aggregate_id === "string" && record.aggregate_id);
    if (explicit && explicit !== projectId) {
      return explicit;
    }
  }

  if (aggregateId && aggregateId !== projectId && !aggregateId.startsWith("repo:") && !aggregateId.startsWith("run:")) {
    return aggregateId;
  }

  return null;
}

async function buildConsoleEvents(projectId?: string | null): Promise<ConsoleEvent[]> {
  if (!projectId) {
    return [];
  }

  const [projectTicketRows, eventRows, approvalRows, repoLogRows, verificationRows] = await Promise.all([
    prisma.ticket.findMany({
      where: { repoId: projectId },
      select: { id: true },
      take: 400,
    }),
    prisma.eventLog.findMany({
      where: {
        OR: [
          { aggregateId: projectId },
          { payload: { path: ["repo_id"], equals: projectId } },
          { payload: { path: ["project_id"], equals: projectId } },
        ],
      },
      orderBy: { createdAt: "desc" },
      take: 120,
    }),
    prisma.approvalProjection.findMany({
      where: {
        OR: [
          { payload: { path: ["repo_id"], equals: projectId } },
          { payload: { path: ["project_id"], equals: projectId } },
        ],
      },
      orderBy: { requestedAt: "desc" },
      take: 40,
    }),
    prisma.repoActivationLog.findMany({
      where: { repoId: projectId },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
    prisma.verificationBundle.findMany({
      where: { repoId: projectId },
      orderBy: { createdAt: "desc" },
      take: 40,
    }),
  ]);

  const projectTicketIds = projectTicketRows.map((row) => row.id);
  const runWhereOr: Array<Record<string, unknown>> = [
    { metadata: { path: ["repo_id"], equals: projectId } },
    { metadata: { path: ["project_id"], equals: projectId } },
  ];
  if (projectTicketIds.length) {
    runWhereOr.unshift({ ticketId: { in: projectTicketIds } });
  }
  const runRows = await prisma.runProjection.findMany({
    where: {
      OR: runWhereOr,
    },
    select: { runId: true, ticketId: true },
    orderBy: { updatedAt: "desc" },
    take: 80,
  });

  const runIds = runRows.map((row) => row.runId);
  const toolRows = runIds.length
    ? await prisma.benchmarkOutcomeEvidence.findMany({
        where: {
          runId: { in: runIds },
          kind: "tool_invocation",
        },
        orderBy: { createdAt: "desc" },
        take: 180,
      })
    : [];

  const eventItems: ConsoleEvent[] = eventRows.map((row) => ({
    id: row.eventId,
    projectId,
    category: mapConsoleCategory(row.eventType),
    level: mapConsoleLevel(row.eventType),
    message: buildConsoleMessage(row.eventType, row.payload),
    createdAt: row.createdAt.toISOString(),
    taskId: extractConsoleTaskId(row.payload, row.aggregateId, projectId) || undefined,
  }));

  const approvalItems: ConsoleEvent[] = approvalRows.map((row) => ({
    id: row.approvalId,
    projectId,
    category: "approval",
    level: row.status === "rejected" ? "error" : row.status === "pending" ? "warn" : "info",
    message: `${row.actionType.replace(/_/g, " ")} ${row.status}${row.reason ? ` · ${row.reason}` : ""}`,
    createdAt: row.requestedAt.toISOString(),
    taskId:
      (typeof (row.payload as Record<string, unknown> | null)?.aggregate_id === "string" &&
      (row.payload as Record<string, unknown>).aggregate_id !== projectId
        ? (row.payload as Record<string, unknown>).aggregate_id
        : null) || undefined,
  }));

  const repoItems: ConsoleEvent[] = repoLogRows.map((row) => ({
    id: row.id,
    projectId,
    category: row.eventType.includes("index") ? "indexing" : "execution",
    level: "info",
    message: buildConsoleMessage(row.eventType, row.payload),
    createdAt: row.createdAt.toISOString(),
  }));

  const verificationItems: ConsoleEvent[] = verificationRows.map((row) => ({
    id: row.id,
    projectId,
    category: "verification",
    level: row.pass ? "info" : "error",
    message: row.pass
      ? `verification passed · ${(row.impactedTests as string[] | unknown[]).length || 0} commands`
      : buildConsoleMessage("verification.failed", {
          failed_commands: (row.failures as string[] | unknown[]).slice(0, 2),
          changed_file_checks: (row.changedFileChecks as string[] | unknown[]).slice(0, 2),
        }),
    createdAt: row.createdAt.toISOString(),
  }));

  const toolItems: ConsoleEvent[] = toolRows.map((row) => {
    const payload = (row.payload || {}) as Record<string, unknown>;
    const toolType = typeof payload.toolType === "string" ? payload.toolType : "repo.verify";
    const stage = typeof payload.stage === "string" ? payload.stage : "build";
    const command = typeof payload.command === "string" ? payload.command : "command";
    const args = Array.isArray(payload.args) ? payload.args.filter((item): item is string => typeof item === "string") : [];
    const policyDecision = typeof payload.policyDecision === "string" ? payload.policyDecision : "allowed";
    const exitCode = typeof payload.exitCode === "number" ? payload.exitCode : null;
    const errorClass = typeof payload.errorClass === "string" ? payload.errorClass : "none";
    const durationMs = typeof payload.durationMs === "number" ? payload.durationMs : 0;
    const summary = typeof payload.summary === "string" ? payload.summary : "tool invocation";
    const approvalId = typeof payload.approval_id === "string" ? payload.approval_id : null;
    const ticketId = typeof payload.ticketId === "string" ? payload.ticketId : undefined;
    const category: ConsoleEvent["category"] =
      toolType === "repo.verify" || toolType === "repo.install" ? "verification" : "execution";
    const level: ConsoleEvent["level"] =
      policyDecision === "approval_required"
        ? "warn"
        : policyDecision === "denied" ||
          errorClass === "command_failed" ||
          errorClass === "timeout" ||
          errorClass === "infra_missing_tool" ||
          errorClass === "infra_missing_dependency"
        ? "error"
        : "info";
    return {
      id: row.id,
      projectId,
      category,
      level,
      message: `tool invocation ${JSON.stringify({
        run_id: row.runId,
        ticket_id: ticketId || null,
        stage,
        tool_type: toolType,
        command,
        args,
        policy_decision: policyDecision,
        exit_code: exitCode,
        error_class: errorClass,
        duration_ms: durationMs,
        approval_id: approvalId,
        summary,
      })}`,
      createdAt: row.createdAt.toISOString(),
      taskId: ticketId,
    };
  });

  return [...eventItems, ...approvalItems, ...repoItems, ...verificationItems, ...toolItems]
    .sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime())
    .slice(-200);
}

export function registerMissionRoutes(deps: MissionRouteDeps) {
  const {
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
  } = deps;

  app.get("/api/v8/mission/snapshot", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    const [snapshot, consoleEvents] = await Promise.all([
      missionControlService.getSnapshot({
        projectId: query.projectId || null,
        ticketId: query.ticketId || null,
        runId: query.runId || null,
        sessionId: query.sessionId || null,
      }),
      buildConsoleEvents(query.projectId || null),
    ]);
    return {
      item: {
        ...snapshot,
        consoleEvents,
      },
    };
  });

  app.get("/api/v8/mission/timeline", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    const snapshot = await missionControlService.getSnapshot({
      projectId: query.projectId || null,
      ticketId: query.ticketId || null,
      runId: query.runId || null,
      sessionId: query.sessionId || null,
    });
    return { items: snapshot.timeline };
  });

  app.get("/api/v8/mission/backlog", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    const snapshot = await missionControlService.getSnapshot({
      projectId: query.projectId || null,
      ticketId: query.ticketId || null,
      runId: query.runId || null,
      sessionId: query.sessionId || null,
    });
    return {
      pillars: snapshot.workflowPillars,
      items: snapshot.workflowCards,
    };
  });

  app.get("/api/v8/mission/task-detail", async (request) => {
    const query = missionTaskDetailQuerySchema.parse(request.query);
    return {
      item: await missionControlService.getTaskDetail({
        projectId: query.projectId || null,
        taskId: query.taskId,
      }),
    };
  });

  app.post("/api/v8/mission/workflow.move", async (request) => {
    const body = z
      .object({
        workflowId: z.string().min(1),
        fromStatus: z.enum(["backlog", "in_progress", "needs_review", "completed"]),
        toStatus: z.enum(["backlog", "in_progress", "needs_review", "completed"]),
        beforeWorkflowId: z.string().min(1).nullable().optional(),
      })
      .parse(request.body);

    const allowedTransitions: Record<string, string[]> = {
      backlog: ["in_progress"],
      in_progress: ["backlog", "needs_review"],
      needs_review: ["in_progress", "completed"],
      completed: ["needs_review"],
    };

    const isReorderOnly = body.fromStatus === body.toStatus;
    if (!isReorderOnly && !allowedTransitions[body.fromStatus]?.includes(body.toStatus)) {
      throw new Error(`Invalid workflow transition: ${body.fromStatus} -> ${body.toStatus}`);
    }

    const ticket = await ticketService.moveWorkflow(body.workflowId, body.toStatus, body.beforeWorkflowId ?? null);
    await prisma.auditEvent.create({
      data: {
        actor: "user",
        eventType: "workflow.moved",
        payload: {
          workflowId: body.workflowId,
          fromStatus: body.fromStatus,
          toStatus: body.toStatus,
          beforeWorkflowId: body.beforeWorkflowId ?? null,
        },
      },
    });

    return {
      item: {
        moved: true,
        ticket,
      },
    };
  });

  app.post("/api/v8/mission/workflow.execution-profile", async (request) => {
    const body = z
      .object({
        workflowId: z.string().min(1),
        executionProfileId: z.string().nullable().optional(),
        actor: z.string().optional(),
      })
      .parse(request.body);
    return {
      item: await ticketService.setTicketExecutionProfileOverride({
        ticketId: body.workflowId,
        executionProfileId: body.executionProfileId ?? null,
        actor: body.actor || "user",
      }),
    };
  });

  app.get("/api/v8/mission/codebase", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    const snapshot = await missionControlService.getSnapshot({
      projectId: query.projectId || null,
      ticketId: query.ticketId || null,
      runId: query.runId || null,
      sessionId: query.sessionId || null,
    });
    return { items: snapshot.codebaseFiles };
  });

  app.get("/api/v8/mission/codebase/tree", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    if (!query.projectId) {
      return { items: [] };
    }
    return {
      items: await repoService.listCodebaseTree(query.projectId),
    };
  });

  app.get("/api/v8/mission/codebase/file", async (request) => {
    const query = missionCodebaseFileQuerySchema.parse(request.query);
    return {
      item: await repoService.readCodebaseFile(query.projectId, query.path),
    };
  });

  app.get("/api/v8/mission/codebase/diff", async (request) => {
    const query = missionCodebaseFileQuerySchema.parse(request.query);
    return {
      item: await repoService.readCodebaseDiff(query.projectId, query.path),
    };
  });

  app.get("/api/v8/mission/console", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    return { items: await buildConsoleEvents(query.projectId || null) };
  });

  app.get("/api/v8/mission/console/stream", async (request, reply) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    reply.hijack();
    reply.raw.writeHead(200, buildStreamHeaders(typeof request.headers.origin === "string" ? request.headers.origin : null));

    const send = (eventName: string, payload: unknown) => {
      reply.raw.write(`event: ${eventName}\n`);
      reply.raw.write(`data: ${JSON.stringify(payload)}\n\n`);
    };

    send("connected", { stream: "mission-console", now: new Date().toISOString() });

    const stopGlobal = eventBus.subscribe("global", (event) => {
      const projectId = extractConsoleProjectId(event.payload);
      if (query.projectId && projectId && projectId !== query.projectId) {
        return;
      }
      if (query.projectId && !projectId) {
        return;
      }
      send("console.event", {
        id: randomUUID(),
        projectId: projectId || query.projectId || null,
        category: mapConsoleCategory(event.type),
        level: mapConsoleLevel(event.type),
        message: buildConsoleMessage(event.type, event.payload),
        createdAt: event.createdAt,
        taskId: extractConsoleTaskId(event.payload, null, query.projectId || null) || undefined,
      });
    });

    const heartbeat = setInterval(() => {
      send("heartbeat", { now: new Date().toISOString() });
    }, 15000);

    reply.raw.on("close", () => {
      clearInterval(heartbeat);
      stopGlobal();
      reply.raw.end();
    });

    return reply;
  });

  app.get("/api/v8/mission/overseer", async (request) => {
    const query = missionSnapshotQuerySchema.parse(request.query);
    const snapshot = await missionControlService.getSnapshot({
      projectId: query.projectId || null,
      ticketId: query.ticketId || null,
      runId: query.runId || null,
      sessionId: query.sessionId || null,
    });
    return { item: snapshot.overseer };
  });

  app.post("/api/v8/mission/overseer/chat", async (request) => {
    const input = v8OverseerChatSchema.parse(request.body);
    const createdSession = input.session_id ? null : await chatService.createSession("Overseer Session", input.project_id || null);
    const sessionId = input.session_id || createdSession?.id;
    if (!sessionId) {
      throw new Error("Unable to resolve chat session");
    }
    const item = await chatService.createUserMessage(sessionId, input.content, {
      modelRole: input.model_role,
    });

    return {
      sessionId,
      item,
    };
  });

  app.post("/api/v8/mission/overseer/route.review", async (request) => {
    const input = v8OverseerRouteReviewSchema.parse(request.body);
    const repo = await repoService.getRepo(input.project_id);
    if (!repo) {
      throw new Error(`Project not found: ${input.project_id}`);
    }

    const worktreePath = path.join(repo.managedWorktreeRoot, "active");
    const [ticket, blueprint, knowledgeHits, executionProfilesSetting] = await Promise.all([
      ensureMissionTicket(ticketService, repo.id, input.prompt, input.ticket_id),
      projectBlueprintService.get(repo.id),
      v2QueryService.searchKnowledge(input.prompt),
      prisma.appSetting.findUnique({ where: { key: "execution_profiles" } }),
    ]);
    const ticketExecutionProfileId = await ticketService.getTicketExecutionProfileOverride(ticket.id);
    const retrievalIds = knowledgeHits.slice(0, 8).map((item) => item.id);

    const [route, contextPack] = await Promise.all([
      routerService.planRoute({
        actor: input.actor,
        repo_id: repo.id,
        ticket_id: ticket.id,
        prompt: input.prompt,
        risk_level: input.risk_level || ticket.risk || "medium",
        workspace_path: worktreePath,
        retrieval_context_ids: retrievalIds,
        active_files: [],
      }),
      codeGraphService.buildContextPack({
        actor: input.actor,
        repoId: repo.id,
        objective: input.prompt,
        queryMode: "impact",
        aggregateId: ticket.id,
      }),
    ]);
    const roleBindings = await providerOrchestrator.getModelRoleBindings();
    const executionProfiles = normalizeExecutionProfiles(executionProfilesSetting?.value);
    const resolvedExecutionProfile = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: input.execution_profile_id,
      ticketProfileId: ticketExecutionProfileId ?? null,
      projectProfileId: blueprint?.providerPolicy.executionProfileId ?? null,
      roleBindings,
    });
    const executionProfileSnapshot = buildExecutionProfileSnapshot(resolvedExecutionProfile);
    const routeRoleBinding = resolvedExecutionProfile.stages.scope;
    const responseRoute = {
      ...route,
      modelRole: routeRoleBinding.role,
      providerId: routeRoleBinding?.providerId || route.providerId,
      metadata: {
        ...(route.metadata ?? {}),
        execution_profile_id: resolvedExecutionProfile.profileId,
        execution_profile_name: resolvedExecutionProfile.profileName,
        execution_profile_snapshot: executionProfileSnapshot,
      },
    };

    const context = await contextService.materializeContext({
      actor: input.actor,
      repo_id: repo.id,
      aggregate_id: ticket.id,
      aggregate_type: "ticket",
      goal: input.prompt,
      query: input.prompt,
      constraints: blueprint?.charter.constraints || [],
      active_files: contextPack.pack.files,
      retrieval_ids: Array.from(new Set([...retrievalIds, ...contextPack.retrievalTrace.retrievalIds])),
      verification_plan: blueprint?.charter.successCriteria || [],
      rollback_plan: ["Restore the managed worktree before promotion."],
      policy_scopes: blueprint?.executionPolicy.approvalRequiredFor || ["file_apply", "run_command"],
      metadata: {
        blueprint_id: blueprint?.id || null,
        blueprint_version: blueprint?.version || null,
        execution_profile_id: resolvedExecutionProfile.profileId,
        execution_profile_name: resolvedExecutionProfile.profileName,
        execution_profile_snapshot: executionProfileSnapshot,
      },
    });

    return {
      ticket,
      blueprint,
      route: responseRoute,
      contextPack: contextPack.pack,
      contextManifest: context.context,
      retrievalTrace: contextPack.retrievalTrace,
    };
  });

  app.post("/api/v8/mission/overseer/execute", async (request) => {
    const input = v8OverseerExecuteSchema.parse(request.body);
    const repo = await repoService.getRepo(input.project_id);
    if (!repo) {
      throw new Error(`Project not found: ${input.project_id}`);
    }

    const worktreePath = path.join(repo.managedWorktreeRoot, "active");
    const [ticket, blueprint, guidelines, executionProfilesSetting] = await Promise.all([
      ensureMissionTicket(ticketService, repo.id, input.prompt, input.ticket_id),
      projectBlueprintService.get(repo.id),
      repoService.getGuidelines(repo.id),
      prisma.appSetting.findUnique({ where: { key: "execution_profiles" } }),
    ]);
    const ticketExecutionProfileId = await ticketService.getTicketExecutionProfileOverride(ticket.id);
    const workingTicket = ticket.status === "in_progress" ? ticket : await ticketService.moveTicket(ticket.id, "in_progress");
    const route = await routerService.planRoute({
      actor: input.actor,
      repo_id: repo.id,
      ticket_id: workingTicket.id,
      prompt: input.prompt,
      risk_level: workingTicket.risk,
      workspace_path: worktreePath,
      retrieval_context_ids: [],
      active_files: [],
    });

    const roleBindings = await providerOrchestrator.getModelRoleBindings();
    const executionProfiles = normalizeExecutionProfiles(executionProfilesSetting?.value);
    const resolvedExecutionProfile = resolveExecutionProfile({
      executionProfiles,
      selectedProfileId: input.execution_profile_id,
      ticketProfileId: ticketExecutionProfileId ?? null,
      projectProfileId: blueprint?.providerPolicy.executionProfileId ?? null,
      roleBindings,
    });
    const executionProfileSnapshot = buildExecutionProfileSnapshot(resolvedExecutionProfile);
    const buildStage = resolvedExecutionProfile.stages.build;
    const resolvedRole = applyEscalationPolicy(
      buildStage.role,
      blueprint?.providerPolicy.escalationPolicy,
      route.risk as "low" | "medium" | "high" | undefined,
    );
    const roleBinding = roleBindings[resolvedRole];
    const resolvedProvider = input.provider_id || roleBinding?.providerId || buildStage.providerId || route.providerId;
    const commandRequest = await v2CommandService.requestExecution({
      ticket_id: workingTicket.id,
      repo_id: repo.id,
      actor: input.actor,
      prompt: input.prompt,
      retrieval_context_ids: [workingTicket.id],
      workspace_path: worktreePath,
      risk_level: workingTicket.risk as "low" | "medium" | "high",
      routing_decision_id: route.id,
      model_role: resolvedRole,
      provider_id: resolvedProvider,
    });

    const runId = commandRequest.run_id;
    const transitions: Array<{ from: TicketStatus; to: TicketStatus; reason: string; at: string }> = [];
    let lifecycleTicket = workingTicket;
    const moveLifecycleTicket = async (to: TicketStatus, reason: string) => {
      if (lifecycleTicket.status === to) return;
      const from = lifecycleTicket.status;
      lifecycleTicket = await ticketService.moveTicket(lifecycleTicket.id, to);
      transitions.push({
        from,
        to,
        reason,
        at: new Date().toISOString(),
      });
    };

    if (commandRequest.status === "approval_required") {
      await moveLifecycleTicket("review", "approval_pending_execution_request");
      return {
        runId,
        ticket: lifecycleTicket,
        blueprint,
        route: {
          ...route,
          modelRole: resolvedRole,
          providerId: resolvedProvider,
          metadata: {
            ...(route.metadata ?? {}),
            execution_profile_id: resolvedExecutionProfile.profileId,
            execution_profile_name: resolvedExecutionProfile.profileName,
            execution_profile_snapshot: executionProfileSnapshot,
          },
        },
        attempt: null,
        verification: null,
        lifecycle: {
          autoReviewEnabled: true,
          maxRounds: 2,
          roundsRun: 0,
          completed: false,
          transitions,
          approvalRequired: true,
          approvalId: commandRequest.approval_id || null,
        },
        shareReport: await githubService.getShareReport(runId),
      };
    }

    if (commandRequest.status === "rejected") {
      return {
        runId,
        ticket: lifecycleTicket,
        blueprint,
        route: {
          ...route,
          modelRole: resolvedRole,
          providerId: resolvedProvider,
          metadata: {
            ...(route.metadata ?? {}),
            execution_profile_id: resolvedExecutionProfile.profileId,
            execution_profile_name: resolvedExecutionProfile.profileName,
            execution_profile_snapshot: executionProfileSnapshot,
          },
        },
        attempt: null,
        verification: null,
        lifecycle: {
          autoReviewEnabled: true,
          maxRounds: 2,
          roundsRun: 0,
          completed: false,
          transitions,
          approvalRequired: false,
          rejected: true,
        },
        shareReport: await githubService.getShareReport(runId),
      };
    }

    const planned = await executionService.planExecution({
      actor: input.actor,
      runId,
      repoId: repo.id,
      projectId: repo.id,
      ticketId: workingTicket.id,
      objective: input.prompt,
      worktreePath,
      queryMode: route.risk === "high" ? "architecture" : "impact",
      modelRole: resolvedRole,
      providerId: resolvedProvider,
      routingDecisionId: route.id,
      verificationPlan: blueprint?.charter.successCriteria || [],
      docsRequired: [],
      metadata: {
        blueprint_id: blueprint?.id || null,
        blueprint_version: blueprint?.version || null,
        execution_profile_id: resolvedExecutionProfile.profileId,
        execution_profile_name: resolvedExecutionProfile.profileName,
        execution_profile_snapshot: executionProfileSnapshot,
      },
    });

    const attempt = await executionService.startExecution({
      actor: input.actor,
      runId,
      repoId: repo.id,
      projectId: repo.id,
      worktreePath,
      objective: input.prompt,
      modelRole: resolvedRole,
      providerId: resolvedProvider,
      routingDecisionId: route.id,
      contextPackId: planned.contextPack.id,
      metadata: {
        execution_profile_id: resolvedExecutionProfile.profileId,
        execution_profile_name: resolvedExecutionProfile.profileName,
        execution_profile_snapshot: executionProfileSnapshot,
      },
    });

    const verificationPlan = buildVerificationPlanForRun({ blueprint, guidelines });
    const verification = verificationPlan.commands.length
      ? await executionService.verifyExecution({
          actor: input.actor,
          runId,
          repoId: repo.id,
          worktreePath,
          executionAttemptId: attempt.id,
          commands: verificationPlan.commands,
          docsRequired: verificationPlan.docsRequired,
          fullSuiteRun: verificationPlan.fullSuiteRun,
          metadata: {
            verification_commands: verificationPlan.commands.map((item) => item.displayCommand),
            verification_reasons: verificationPlan.reasons,
            enforced_rules: verificationPlan.enforcedRules,
            blueprint_version: blueprint?.version || null,
            execution_profile_id: resolvedExecutionProfile.profileId,
            execution_profile_name: resolvedExecutionProfile.profileName,
            execution_profile_snapshot: executionProfileSnapshot,
          },
        })
      : null;
    const AUTO_REVIEW_MAX_ROUNDS = 2;
    let latestAttempt = attempt;
    let latestVerification = verification;
    let autoReviewRounds = 0;

    if (latestVerification?.pass) {
      await moveLifecycleTicket("review", "verification_passed_initial");
      await moveLifecycleTicket("done", "auto_review_gate_passed");
    } else if (latestVerification) {
      if (hasApprovalVerificationFailure(latestVerification.failures)) {
        await moveLifecycleTicket("review", "verification_approval_required");
      } else if (hasInfrastructureVerificationFailure(latestVerification.failures)) {
        await moveLifecycleTicket("in_progress", "verification_environment_setup_required");
      } else {
        let autoReviewError: Error | null = null;
        while (!latestVerification.pass && autoReviewRounds < AUTO_REVIEW_MAX_ROUNDS) {
          autoReviewRounds += 1;
          await moveLifecycleTicket("review", `auto_review_round_${autoReviewRounds}_started`);

          try {
            const reviewStage = resolvedExecutionProfile.stages.review;
            const reviewRole = applyEscalationPolicy(
              reviewStage.role,
              blueprint?.providerPolicy.escalationPolicy,
              route.risk as "low" | "medium" | "high" | undefined,
            );
            const reviewRoleBinding = roleBindings[reviewRole];
            const reviewProvider = input.provider_id || reviewRoleBinding?.providerId || reviewStage.providerId || resolvedProvider;

            latestAttempt = await executionService.startExecution({
              actor: input.actor,
              runId,
              repoId: repo.id,
              projectId: repo.id,
              worktreePath,
              objective: [
                `Auto-review repair round ${autoReviewRounds} for ticket "${lifecycleTicket.title}".`,
                "Fix failing verification with minimal diffs and preserve intended behavior.",
                "",
                "Original objective:",
                input.prompt,
              ].join("\n"),
              modelRole: reviewRole,
              providerId: reviewProvider,
              routingDecisionId: route.id,
              contextPackId: planned.contextPack.id,
              metadata: {
                execution_profile_id: resolvedExecutionProfile.profileId,
                execution_profile_name: resolvedExecutionProfile.profileName,
                execution_profile_snapshot: executionProfileSnapshot,
                execution_stage_override: "review",
              },
            });

            latestVerification = await executionService.verifyExecution({
              actor: input.actor,
              runId,
              repoId: repo.id,
              worktreePath,
              executionAttemptId: latestAttempt.id,
              commands: verificationPlan.commands,
              docsRequired: verificationPlan.docsRequired,
              fullSuiteRun: verificationPlan.fullSuiteRun,
              metadata: {
                verification_commands: verificationPlan.commands.map((item) => item.displayCommand),
                verification_reasons: verificationPlan.reasons,
                enforced_rules: verificationPlan.enforcedRules,
                blueprint_version: blueprint?.version || null,
                auto_review_round: autoReviewRounds,
                execution_profile_id: resolvedExecutionProfile.profileId,
                execution_profile_name: resolvedExecutionProfile.profileName,
                execution_profile_snapshot: executionProfileSnapshot,
              },
            });
          } catch (error) {
            autoReviewError = error instanceof Error ? error : new Error("Auto-review execution failed.");
            await moveLifecycleTicket("in_progress", `auto_review_round_${autoReviewRounds}_error`);
            break;
          }

          if (latestVerification.pass) {
            await moveLifecycleTicket("done", `auto_review_round_${autoReviewRounds}_passed`);
            break;
          }

          if (autoReviewRounds < AUTO_REVIEW_MAX_ROUNDS) {
            await moveLifecycleTicket("in_progress", `auto_review_round_${autoReviewRounds}_retry_required`);
          }
        }

        if (autoReviewError) {
          throw autoReviewError;
        }

        if (!latestVerification.pass) {
          await moveLifecycleTicket("in_progress", "verification_followup_required");
        }
      }
    }

    return {
      runId,
      ticket: lifecycleTicket,
      blueprint,
      route: {
        ...route,
        modelRole: resolvedRole,
        providerId: resolvedProvider,
        metadata: {
          ...(route.metadata ?? {}),
          execution_profile_id: resolvedExecutionProfile.profileId,
          execution_profile_name: resolvedExecutionProfile.profileName,
          execution_profile_snapshot: executionProfileSnapshot,
        },
      },
      attempt: latestAttempt,
      verification: latestVerification,
      lifecycle: {
        autoReviewEnabled: true,
        maxRounds: AUTO_REVIEW_MAX_ROUNDS,
        roundsRun: autoReviewRounds,
        completed: Boolean(latestVerification?.pass && lifecycleTicket.status === "done"),
        transitions,
      },
      shareReport: await githubService.getShareReport(runId),
    };
  });

  app.post("/api/v9/mission/execute", async (request, reply) => {
    const parsed = v9MissionExecuteSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: parsed.error.issues[0]?.message || "Invalid mission execute request.",
      });
    }
    const input = parsed.data;
    const repo = await repoService.getRepo(input.project_id);
    if (!repo) {
      throw new Error(`Project not found: ${input.project_id}`);
    }

    let ticketIdForExecute = input.ticket_id;
    if (input.permission_mode) {
      const ticket = await ensureMissionTicket(ticketService, repo.id, input.prompt, input.ticket_id);
      ticketIdForExecute = ticket.id;
      await ticketService.setTicketExecutionPolicy({
        ticketId: ticket.id,
        mode: input.permission_mode,
        actor: input.actor,
      });
    }

    const proxied = await app.inject({
      method: "POST",
      url: "/api/v8/mission/overseer/execute",
      payload: {
        actor: input.actor,
        project_id: input.project_id,
        ticket_id: ticketIdForExecute,
        prompt: input.prompt,
        model_role: input.model_role,
        provider_id: input.provider_id,
        execution_profile_id: input.execution_profile_id,
      },
      headers: {
        "x-local-api-token": apiToken || "",
      },
    });

    if (proxied.statusCode >= 400) {
      return reply.code(proxied.statusCode).send(proxied.json());
    }

    return proxied.json();
  });

  app.post("/api/v9/mission/ticket.permission", async (request, reply) => {
    const parsed = v9TicketPermissionSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.code(400).send({
        error: parsed.error.issues[0]?.message || "Invalid ticket permission request.",
      });
    }
    const body = parsed.data;
    return {
      item: await ticketService.setTicketExecutionPolicy({
        ticketId: body.ticket_id,
        mode: body.mode,
        actor: body.actor || "user",
        allowInstallCommands: body.allow_install_commands,
        allowNetworkCommands: body.allow_network_commands,
        requireApprovalFor: body.require_approval_for,
      }),
    };
  });

  app.get("/api/v9/mission/ticket.permission", async (request) => {
    const query = v9TicketPolicyQuerySchema.parse(request.query);
    return {
      item: await ticketService.getTicketExecutionPolicy(query.ticketId),
    };
  });

  app.post("/api/v9/mission/dependency.bootstrap", async (request) => {
    const body = v9DependencyBootstrapSchema.parse(request.body);
    const runProjection = await prisma.runProjection.findUnique({
      where: { runId: body.run_id },
      select: { metadata: true },
    });
    const runMetadata = (runProjection?.metadata as Record<string, unknown> | null) || {};
    const worktreePath =
      typeof runMetadata.worktree_path === "string"
        ? runMetadata.worktree_path
        : await repoService.getActiveWorktreePath(body.repo_id);
    const installCommand = resolveDependencyBootstrapCommand(worktreePath);
    if (!installCommand) {
      throw new Error("No dependency bootstrap command could be derived for this repo.");
    }
    return {
      item: await commandEngine.invoke({
        runId: body.run_id,
        repoId: body.repo_id,
        ticketId: body.ticket_id,
        stage: body.stage,
        actor: body.actor,
        worktreePath,
        command: installCommand,
        toolType: "repo.install",
        riskLevel: "medium",
      }),
    };
  });

  app.get("/api/v9/mission/run/:id/tool-events", async (request) => {
    const runId = (request.params as { id: string }).id;
    return {
      items: await commandEngine.listRunToolEvents(runId),
    };
  });

  app.post("/api/v9/mission/ticket.lifecycle.reconcile", async (request) => {
    const body = v9LifecycleReconcileSchema.parse(request.body);
    const targetTickets = await ticketService.listTickets(body.project_id);
    const reviewTickets = targetTickets.filter((ticket) => ticket.status === "review");

    const moved: Array<{ ticketId: string; from: TicketStatus; to: TicketStatus; reason: string }> = [];

    for (const ticket of reviewTickets) {
      const latestRun = await prisma.runProjection.findFirst({
        where: { ticketId: ticket.id },
        orderBy: { updatedAt: "desc" },
      });
      if (!latestRun) continue;
      const latestBundle = await prisma.verificationBundle.findFirst({
        where: { runId: latestRun.runId },
        orderBy: { createdAt: "desc" },
      });
      if (latestBundle && !latestBundle.pass) {
        await ticketService.moveTicket(ticket.id, "in_progress");
        moved.push({
          ticketId: ticket.id,
          from: "review",
          to: "in_progress",
          reason: "latest_verification_failed",
        });
      }
    }

    if (body.archive_stale_synthetic) {
      const staleSynthetic = targetTickets.filter(
        (ticket) => ticket.status !== "done" && /(?:e2e|synthetic|test repo|smoke)/i.test(`${ticket.title} ${ticket.description}`)
      );
      for (const ticket of staleSynthetic) {
        await ticketService.moveTicket(ticket.id, "done");
        moved.push({
          ticketId: ticket.id,
          from: ticket.status,
          to: "done",
          reason: "archived_stale_synthetic",
        });
      }
    }

    await prisma.auditEvent.create({
      data: {
        actor: body.actor || "user",
        eventType: "ticket.lifecycle.reconcile",
        payload: {
          project_id: body.project_id || null,
          moved_count: moved.length,
          moved,
        },
      },
    });

    return {
      item: {
        movedCount: moved.length,
        moved,
      },
    };
  });

  app.post("/api/v9/mission/ticket.autocomplete", async (request) => {
    const body = v9TicketAutocompleteSchema.parse(request.body);
    const ticket = (await ticketService.listTickets()).find((item) => item.id === body.ticket_id);
    if (!ticket) {
      throw new Error(`Ticket not found: ${body.ticket_id}`);
    }

    const latestRun = await prisma.runProjection.findFirst({
      where: { ticketId: ticket.id },
      orderBy: { updatedAt: "desc" },
    });
    if (!latestRun) {
      return {
        item: {
          completed: false,
          reason: "no_run_projection",
        },
      };
    }

    const latestBundle = await prisma.verificationBundle.findFirst({
      where: { runId: latestRun.runId },
      orderBy: { createdAt: "desc" },
    });
    const pendingApproval = await prisma.approvalProjection.findFirst({
      where: {
        status: "pending",
        OR: [
          { payload: { path: ["ticket_id"], equals: ticket.id } },
          { payload: { path: ["aggregate_id"], equals: ticket.id } },
          { payload: { path: ["run_id"], equals: latestRun.runId } },
        ],
      },
    });

    if (latestBundle?.pass && !pendingApproval) {
      const completed = await ticketService.moveTicket(ticket.id, "done");
      return {
        item: {
          completed: true,
          ticket: completed,
          reason: "verification_passed_and_no_pending_approval",
        },
      };
    }

    return {
      item: {
        completed: false,
        reason: pendingApproval ? "approval_pending" : "verification_not_passed",
      },
    };
  });

  app.post("/api/v8/mission/approval/decide", async (request) => {
    const body = z
      .object({
        approval_id: z.string().min(1),
        decision: z.enum(["approved", "rejected"]),
        reason: z.string().optional(),
        decided_by: z.string().optional(),
        execute_approved_command: z.boolean().optional(),
        requeue_blocked_stage: z.boolean().optional(),
      })
      .parse(request.body);
    const result = await decideApprovalWithCommandFollowup({
      approvalId: body.approval_id,
      decision: body.decision,
      reason: body.reason,
      actor: body.decided_by || "user",
      executeApprovedCommand: body.execute_approved_command !== false,
      requeueBlockedStage: body.requeue_blocked_stage !== false,
      approvalService,
      ticketService,
      commandEngine,
      v2EventService,
    });
    return {
      item: result.item,
      command_execution: result.commandExecution,
      lifecycle_requeue: result.lifecycleRequeue,
    };
  });

  app.post("/api/v8/mission/actions/stop", async (request) => {
    const body = z
      .object({
        run_id: z.string().min(1),
        repo_id: z.string().min(1),
        actor: z.string().optional(),
        reason: z.string().optional(),
      })
      .parse(request.body);
    return {
      item: await v2CommandService.stopExecution({
        run_id: body.run_id,
        repo_id: body.repo_id,
        actor: body.actor || "user",
        reason: body.reason,
      }),
    };
  });

  app.post("/api/v8/mission/actions/task.requeue", async (request) => {
    const body = z
      .object({
        ticket_id: z.string().min(1),
        actor: z.string().optional(),
        reason: z.string().optional(),
      })
      .parse(request.body);
    return {
      item: await v2CommandService.requeueTask({
        ticket_id: body.ticket_id,
        actor: body.actor || "user",
        reason: body.reason,
      }),
    };
  });

  app.post("/api/v8/mission/actions/task.transition", async (request) => {
    const body = z
      .object({
        ticket_id: z.string().min(1),
        actor: z.string().optional(),
        status: z.enum(["inactive", "reserved", "active", "in_progress", "blocked", "completed"]),
        risk_level: z.enum(["low", "medium", "high"]).optional(),
      })
      .parse(request.body);
    return {
      item: await v2CommandService.transitionTask({
        ticket_id: body.ticket_id,
        actor: body.actor || "user",
        status: body.status,
        risk_level: body.risk_level,
      }),
    };
  });
}
