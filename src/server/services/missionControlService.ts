import { prisma } from "../db";
import type {
  ChatMessageDto,
  ChatSessionDto,
  ConsoleEvent,
  ExecutionRunSummary,
  MissionControlSnapshot,
  MissionUiApprovalCard,
  MissionUiRouteSummary,
  ProviderId,
  RepoRegistration,
  RoutingDecision,
  ShareableRunReport,
  Ticket,
  VerificationBundle,
  V2CommandLogItem,
  V2PolicyPendingItem,
  WorkflowCardSummary,
  WorkflowStatusPillar,
  WorkflowTaskDetail,
} from "../../shared/contracts";
import { ChatService } from "./chatService";
import { CodeGraphService } from "./codeGraphService";
import { ContextService } from "./contextService";
import { GitHubService } from "./githubService";
import { ProjectBlueprintService } from "./projectBlueprintService";
import { RepoService } from "./repoService";
import { RouterService } from "./routerService";
import { TicketService } from "./ticketService";
import { V2QueryService } from "./v2QueryService";

interface GetSnapshotInput {
  projectId?: string | null;
  ticketId?: string | null;
  runId?: string | null;
  sessionId?: string | null;
}

function asStringArray(value: unknown) {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function toRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function summarize(text: string, max = 120) {
  const trimmed = text.replace(/\s+/g, " ").trim();
  if (trimmed.length <= max) {
    return trimmed;
  }
  return `${trimmed.slice(0, max - 3)}...`;
}

function deriveBriefStatus(ticket: Ticket): "success" | "active" | "failed" {
  if (ticket.status === "blocked") return "failed";
  if (ticket.status === "done" || ticket.status === "review") return "success";
  return "active";
}

function deriveTaskPhase(ticket: Ticket) {
  return ticket.status === "in_progress" ? "implementing" : ticket.status === "review" ? "verifying" : ticket.status.replace(/_/g, " ");
}

function buildRouteSummary(route: RoutingDecision | null): MissionUiRouteSummary | null {
  if (!route) return null;
  return {
    executionMode: route.executionMode,
    providerId: route.providerId,
    modelRole: route.modelRole,
    verificationDepth: route.verificationDepth,
    confidence: Math.max(0.25, Math.min(0.97, 0.45 + route.decompositionScore * 0.4)),
  };
}

function buildApprovals(approvals: V2PolicyPendingItem[], selectedTicketId: string | null): MissionUiApprovalCard[] {
  return approvals.map((approval) => {
    const aggregateId = typeof approval.payload?.aggregate_id === "string" ? approval.payload.aggregate_id : null;
    return {
      approvalId: approval.approval_id,
      actionType: approval.action_type,
      requestedAt: approval.requested_at,
      relevantToCurrentTask: selectedTicketId ? aggregateId === null || aggregateId === selectedTicketId : aggregateId === null,
      reason: approval.reason,
    };
  });
}

function deriveRunPhase(
  runSummary: ExecutionRunSummary | null,
  pendingApprovals: V2PolicyPendingItem[],
  selectedTicket: Ticket | null
): MissionControlSnapshot["runPhase"] {
  if (runSummary?.status === "failed" || selectedTicket?.status === "blocked") return "error";
  if (runSummary?.status === "completed" || runSummary?.status === "verified") return "completed";
  if (pendingApprovals.length > 0) return "single_task_validation";
  if (runSummary?.status === "queued" || runSummary?.status === "planned") return "starting";
  if (runSummary?.status === "running" || selectedTicket?.status === "in_progress") return "parallel_running";
  if (selectedTicket?.status === "review") return "draining";
  return "idle";
}

function buildChangeBriefs(tickets: Ticket[], runSummary: ExecutionRunSummary | null, packFiles: string[]) {
  return tickets.slice(0, 8).map((ticket) => ({
    task_id: ticket.id,
    title: ticket.title,
    status: deriveBriefStatus(ticket),
    summary: summarize(ticket.description || "Objective queued for planning."),
    patches_applied: ticket.id === runSummary?.ticketId ? packFiles.length : 0,
    token_total: 0,
    worker_id: null,
    generated_at: ticket.updatedAt,
    files: ticket.id === runSummary?.ticketId ? packFiles : [],
  }));
}

function buildStreams(tickets: Ticket[], pendingApprovals: V2PolicyPendingItem[], runSummary: ExecutionRunSummary | null) {
  const backlog = tickets.filter((ticket) => ticket.status === "backlog" || ticket.status === "ready").length;
  const inProgress = tickets.filter((ticket) => ticket.status === "in_progress").length;
  const review = tickets.filter((ticket) => ticket.status === "review").length;
  const blocked = tickets.filter((ticket) => ticket.status === "blocked").length;
  const completed = tickets.filter((ticket) => ticket.status === "done").length;
  const focusTicket = tickets.find((ticket) => ticket.status === "in_progress") ?? tickets[0] ?? null;

  return [
    {
      workstream: "Execution",
      risk: (blocked > 0 ? "critical" : inProgress > 0 ? "warn" : "ok") as "critical" | "warn" | "ok",
      queued: backlog,
      in_progress: inProgress,
      blocked,
      failed: blocked,
      completed,
      top_task_id: focusTicket?.id ?? null,
    },
    {
      workstream: "Verification",
      risk: (pendingApprovals.length > 0 ? "warn" : review > 0 ? "warn" : "ok") as "critical" | "warn" | "ok",
      queued: review,
      in_progress: runSummary?.status === "queued" ? 1 : 0,
      blocked: pendingApprovals.length,
      failed: 0,
      completed: runSummary?.status === "completed" || runSummary?.status === "verified" ? 1 : 0,
      top_task_id: focusTicket?.id ?? null,
    },
    {
      workstream: "Approvals",
      risk: (pendingApprovals.length > 0 ? "critical" : "ok") as "critical" | "warn" | "ok",
      queued: pendingApprovals.length,
      in_progress: 0,
      blocked: 0,
      failed: 0,
      completed: 0,
      top_task_id: focusTicket?.id ?? null,
    },
  ];
}

function mapCommandSeverity(command: V2CommandLogItem): "INFO" | "WARNING" | "ERROR" {
  if (command.status === "failed" || command.status === "rejected") return "ERROR";
  if (command.status === "queued") return "WARNING";
  return "INFO";
}

function buildTimeline(commands: V2CommandLogItem[], approvals: V2PolicyPendingItem[]) {
  const commandEvents = commands.slice(0, 18).map((command) => ({
    id: command.id,
    phase: (command.command_type === "execution.request" ? "parallel_running" : "single_task_validation") as MissionControlSnapshot["runPhase"],
    severity: mapCommandSeverity(command),
    kind: command.command_type,
    timestamp: command.created_at,
    message: summarize(`${command.command_type} ${command.status}`, 96),
    task_id: command.aggregate_id ?? undefined,
  }));

  const approvalEvents = approvals.slice(0, 8).map((approval) => ({
    id: approval.approval_id,
    phase: "single_task_validation" as MissionControlSnapshot["runPhase"],
    severity: (approval.status === "pending" ? "WARNING" : approval.status === "rejected" ? "ERROR" : "INFO") as
      | "INFO"
      | "WARNING"
      | "ERROR",
    kind: approval.action_type,
    timestamp: approval.requested_at,
    message: approval.reason || `${approval.action_type} ${approval.status}`,
    task_id: typeof approval.payload?.aggregate_id === "string" ? approval.payload.aggregate_id : undefined,
  }));

  return [...commandEvents, ...approvalEvents]
    .sort((left, right) => new Date(right.timestamp).getTime() - new Date(left.timestamp).getTime())
    .slice(0, 24)
    .reverse();
}

function buildSpotlight(
  ticket: Ticket | null,
  workflowSummary: string | null,
  nextSteps: string[],
  blockers: string[],
  route: RoutingDecision | null,
  packFiles: string[],
  verification: VerificationBundle | null,
  relatedEvents: MissionControlSnapshot["timeline"]
) {
  if (!ticket) {
    return null;
  }

  const llmOutputs = packFiles.length ? [packFiles.map((file) => `+ target ${file}`).join("\n")] : [];

  return {
    task_id: ticket.id,
    title: ticket.title,
    lifecycle: {
      current_phase: route?.executionMode || ticket.status,
      events: relatedEvents.slice(-6).map((event) => ({
        timestamp: event.timestamp,
        severity: event.severity,
        message: event.message,
      })),
    },
    latest_transition_reason: workflowSummary || route?.rationale?.[0] || "Route ready.",
    phase_durations: undefined,
    latest_artifact: {
      payload: {
        outcome: {
          success: verification?.pass ?? ticket.status === "done",
          attempts: 1,
          patches_applied: packFiles.length,
          worker_id: null,
          token_usage: {
            total_tokens: 0,
          },
        },
        llm_outputs: llmOutputs,
      },
      markdown_summary: [
        workflowSummary,
        nextSteps.length ? `Next: ${nextSteps.join(" · ")}` : null,
        blockers.length ? `Blockers: ${blockers.join(" · ")}` : null,
      ]
        .filter(Boolean)
        .join("\n\n"),
      llm_output_count: llmOutputs.length,
    },
    failure: verification?.failures.length ? { error: verification.failures.join(" | ") } : {},
  };
}

function buildCodebaseFiles(changedFiles: string[], contextPack: MissionControlSnapshot["contextPack"], modelRole: string | null) {
  const seen = new Set<string>();
  const ordered = [...(contextPack?.files ?? []), ...(contextPack?.tests ?? []), ...(contextPack?.docs ?? [])].filter((filePath) => {
    if (!filePath || seen.has(filePath)) return false;
    seen.add(filePath);
    return true;
  });

  return ordered.map((filePath) => ({
    path: filePath,
    status: (changedFiles.includes(filePath) ? "modified" : contextPack?.docs.includes(filePath) ? "added" : "unchanged") as
      | "modified"
      | "added"
      | "deleted"
      | "unchanged",
    lines: 0,
    agent: modelRole,
    taskId: null,
  }));
}

function buildConsoleLogs(commands: V2CommandLogItem[], approvals: V2PolicyPendingItem[]) {
  const commandLogs = commands.slice(0, 60).map((command) => ({
    id: command.id,
    level:
      command.status === "failed" || command.status === "rejected"
        ? ("error" as const)
        : command.status === "queued"
        ? ("warn" as const)
        : command.command_type === "execution.request"
        ? ("success" as const)
        : ("info" as const),
    timestamp: command.created_at,
    message: `${command.command_type} ${command.status}`,
    source: command.command_type,
    taskId: command.aggregate_id ?? undefined,
  }));

  const approvalLogs = approvals.slice(0, 20).map((approval) => ({
    id: approval.approval_id,
    level: (approval.status === "pending" ? "warn" : approval.status === "rejected" ? "error" : "info") as
      | "info"
      | "warn"
      | "error"
      | "debug"
      | "success",
    timestamp: approval.requested_at,
    message: approval.reason || `${approval.action_type} ${approval.status}`,
    source: "approval",
  }));

  return [...commandLogs, ...approvalLogs]
    .sort((left, right) => new Date(left.timestamp).getTime() - new Date(right.timestamp).getTime())
    .slice(-120);
}

function buildActionCapabilities(runSummary: ExecutionRunSummary | null, ticket: Ticket | null) {
  return {
    canRefresh: true,
    canStop: false,
    canRequeue: false,
    canMarkActive: false,
    canComplete: false,
    canRetry: Boolean(runSummary && (runSummary.status === "failed" || runSummary.status === "rejected")) || ticket?.status === "blocked",
  };
}

function workflowStatusForTicket(status: Ticket["status"]): WorkflowCardSummary["status"] {
  if (status === "backlog" || status === "ready") return "backlog";
  if (status === "review") return "needs_review";
  if (status === "done") return "completed";
  return "in_progress";
}

function progressForTicketStatus(status: Ticket["status"]) {
  switch (status) {
    case "done":
      return 100;
    case "review":
      return 82;
    case "blocked":
      return 58;
    case "in_progress":
      return 64;
    case "ready":
      return 30;
    default:
      return 18;
  }
}

function summarizeTicketEvent(type: string, payload: Record<string, unknown>) {
  if (type === "ticket.created") {
    const status = typeof payload.status === "string" ? payload.status.replace(/_/g, " ") : "backlog";
    return `Ticket created in ${status}.`;
  }
  if (type === "ticket.updated") {
    const keys = Object.keys(payload).filter(Boolean);
    if (!keys.length) {
      return "Ticket details updated.";
    }
    return `Updated ${keys.join(", ")}.`;
  }
  if (type === "ticket.moved") {
    const status = typeof payload.status === "string" ? payload.status.replace(/_/g, " ") : "updated";
    return `Moved to ${status}.`;
  }
  if (type === "ticket.workflow_moved") {
    const lane = typeof payload.lane === "string" ? payload.lane.replace(/_/g, " ") : "the selected lane";
    return `Moved on the command board to ${lane}.`;
  }
  return type.replace(/^ticket\./, "").replace(/[._]/g, " ");
}

function buildWorkflowCards(
  tickets: Ticket[],
  runSummary: ExecutionRunSummary | null,
  contextPack: MissionControlSnapshot["contextPack"],
  laneCounts: Map<string, number>
): WorkflowCardSummary[] {
  const activeTicketId = runSummary?.ticketId ?? null;
  return tickets
    .map((ticket) => {
      const impactedFiles = ticket.id === activeTicketId ? contextPack?.files ?? [] : [];
      const impactedTests = ticket.id === activeTicketId ? contextPack?.tests ?? [] : [];
      const impactedDocs = ticket.id === activeTicketId ? contextPack?.docs ?? [] : [];
      const isBlocked = ticket.status === "blocked";
      const workflowStatus = workflowStatusForTicket(ticket.status);
      return {
        workflowId: ticket.id,
        title: ticket.title,
        subtitle: summarize(ticket.description || "Objective queued for refinement."),
        status: workflowStatus,
        laneOrder: ticket.laneOrder,
        rawStatus: ticket.status,
        priority: ticket.priority,
        risk: ticket.risk,
        taskCount: 1,
        isBlocked,
        blockedReason: isBlocked ? summarize(ticket.description || "Blocked pending follow-up.", 96) : null,
        impactedFiles,
        impactedTests,
        impactedDocs,
        lastUpdatedAt: ticket.updatedAt,
        verificationState: ticket.id === activeTicketId ? runSummary?.status ?? null : null,
        confidence: ticket.id === activeTicketId ? contextPack?.confidence ?? null : null,
        progress: progressForTicketStatus(ticket.status),
        ownerLabel: laneCounts.get(ticket.id) ? `${laneCounts.get(ticket.id)} active lane${laneCounts.get(ticket.id) === 1 ? "" : "s"}` : null,
        laneCount: laneCounts.get(ticket.id) ?? 0,
      };
    })
    .sort((left, right) => {
      if (left.status !== right.status) {
        return 0;
      }
      if (left.isBlocked !== right.isBlocked) {
        return left.isBlocked ? -1 : 1;
      }
      if ((left.laneOrder ?? 0) !== (right.laneOrder ?? 0)) {
        return (left.laneOrder ?? 0) - (right.laneOrder ?? 0);
      }
      return new Date(right.lastUpdatedAt).getTime() - new Date(left.lastUpdatedAt).getTime();
    });
}

function buildWorkflowPillars(cards: WorkflowCardSummary[]): WorkflowStatusPillar[] {
  const order: Array<{ key: WorkflowStatusPillar["key"]; label: string }> = [
    { key: "backlog", label: "Backlog" },
    { key: "in_progress", label: "In Progress" },
    { key: "needs_review", label: "Needs Review" },
    { key: "completed", label: "Completed" },
  ];
  return order.map((pillar) => {
    const matching = cards.filter((card) => card.status === pillar.key);
    return {
      key: pillar.key,
      label: pillar.label,
      count: matching.length,
      blockedCount: matching.filter((card) => card.isBlocked).length || undefined,
      workflowIds: matching.map((card) => card.workflowId),
    };
  });
}

function mapConsoleLogLevel(level: "info" | "warn" | "error" | "debug" | "success"): ConsoleEvent["level"] {
  if (level === "warn") return "warn";
  if (level === "error") return "error";
  return "info";
}

function mapConsoleLogCategory(source: string): ConsoleEvent["category"] {
  if (source === "approval") return "approval";
  if (source.includes("verify") || source.includes("test") || source.includes("lint") || source.includes("build")) return "verification";
  if (source.includes("index")) return "indexing";
  if (source.includes("provider") || source.includes("qwen") || source.includes("openai")) return "provider";
  return "execution";
}

function mapRunSummary(row: {
  runId: string;
  ticketId: string | null;
  status: string;
  providerId: string | null;
  metadata: unknown;
  startedAt: Date | null;
  endedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
} | null, routingDecision: { id: string; repoId: string | null; executionMode: string; modelRole: string; providerId: string; verificationDepth: string } | null): ExecutionRunSummary | null {
  if (!row) return null;
  const metadata = toRecord(row.metadata);
  return {
    runId: row.runId,
    ticketId: row.ticketId,
    status: row.status,
    providerId: (row.providerId as ProviderId | null) || ((routingDecision?.providerId as ProviderId | undefined) ?? null),
    modelRole: (typeof metadata.model_role === "string" ? metadata.model_role : null) || routingDecision?.modelRole || null,
    routingDecisionId: typeof metadata.routing_decision_id === "string" ? metadata.routing_decision_id : routingDecision?.id || null,
    repoId: (typeof metadata.repo_id === "string" ? metadata.repo_id : null) || routingDecision?.repoId || null,
    executionMode: (typeof metadata.execution_mode === "string" ? metadata.execution_mode : null) || routingDecision?.executionMode || null,
    verificationDepth:
      ((typeof metadata.verification_depth === "string" ? metadata.verification_depth : null) as ExecutionRunSummary["verificationDepth"]) ||
      ((routingDecision?.verificationDepth as ExecutionRunSummary["verificationDepth"]) ?? null),
    startedAt: row.startedAt?.toISOString() ?? null,
    endedAt: row.endedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    metadata,
  };
}

export class MissionControlService {
  constructor(
    private readonly repoService: RepoService,
    private readonly projectBlueprintService: ProjectBlueprintService,
    private readonly chatService: ChatService,
    private readonly ticketService: TicketService,
    private readonly v2QueryService: V2QueryService,
    private readonly routerService: RouterService,
    private readonly contextService: ContextService,
    private readonly codeGraphService: CodeGraphService,
    private readonly githubService: GitHubService
  ) {}

  async getSnapshot(input: GetSnapshotInput = {}): Promise<MissionControlSnapshot & { overseer: { sessions: ChatSessionDto[]; selectedSessionId: string | null; messages: ChatMessageDto[] } }> {
    const repos = await this.repoService.listRepos();
    const activeRepo = input.projectId ? await this.repoService.getRepo(input.projectId) : await this.repoService.getActiveRepo();
    const project = activeRepo || repos[0] || null;

    const [blueprint, guidelines, projectState, sessions, tickets, approvals, commands, contextPack, codeGraphStatus, latestAttempt, laneRows] =
      await Promise.all([
      project ? this.projectBlueprintService.get(project.id) : Promise.resolve(null),
      project ? this.repoService.getGuidelines(project.id) : Promise.resolve(null),
      project ? this.repoService.getState(project.id) : Promise.resolve(null),
      project ? this.chatService.listSessions(project.id) : Promise.resolve([] as ChatSessionDto[]),
      project ? this.ticketService.listTickets(project.id) : Promise.resolve([] as Ticket[]),
      this.v2QueryService.getPendingPolicy(),
      this.v2QueryService.getRecentCommands(120),
      project ? this.codeGraphService.getLatestContextPack(project.id) : Promise.resolve(null),
      project ? this.codeGraphService.getStatus(project.id) : Promise.resolve(null),
      project
        ? prisma.executionAttempt.findFirst({
            where: { repoId: project.id },
            orderBy: [{ startedAt: "desc" }, { updatedAt: "desc" }],
          })
        : Promise.resolve(null),
      project
        ? prisma.agentLane.findMany({
            where: { repoId: project.id },
            select: { ticketId: true, state: true },
          })
        : Promise.resolve([] as Array<{ ticketId: string; state: string }>),
    ]);

    const selectedTicket =
      tickets.find((ticket) => ticket.id === input.ticketId) ??
      tickets.find((ticket) => ticket.status === "in_progress" || ticket.status === "review") ??
      tickets[0] ??
      null;
    const selectedSession = sessions.find((session) => session.id === input.sessionId) ?? sessions[0] ?? null;
    const messages = selectedSession ? await this.chatService.listMessages(selectedSession.id) : [];

    const latestExecutionCommand = selectedTicket
      ? commands.find((item) => item.command_type === "execution.request" && item.aggregate_id === selectedTicket.id) ?? null
      : null;

    const inferredRunId =
      input.runId ||
      projectState?.selectedRunId ||
      (typeof latestExecutionCommand?.result?.run_id === "string" ? latestExecutionCommand.result.run_id : null) ||
      latestAttempt?.runId ||
      null;

    const routingFromTicket = selectedTicket ? await this.routerService.listRecentForAggregate(selectedTicket.id) : [];
    const preliminaryRoute = routingFromTicket[0] ?? null;
    const routingDecisionId =
      (typeof preliminaryRoute?.id === "string" ? preliminaryRoute.id : null) ||
      (typeof latestExecutionCommand?.result?.routing_decision_id === "string" ? latestExecutionCommand.result.routing_decision_id : null) ||
      latestAttempt?.routingDecisionId ||
      null;

    const runProjection = inferredRunId ? await prisma.runProjection.findUnique({ where: { runId: inferredRunId } }) : null;
    const persistedRoutingDecision = routingDecisionId
      ? await prisma.routingDecisionProjection.findUnique({ where: { id: routingDecisionId } })
      : null;
    const runSummary = mapRunSummary(runProjection, persistedRoutingDecision);

    const [workflowState, verification, shareReport] = await Promise.all([
      selectedTicket ? this.contextService.getWorkflowState(selectedTicket.id) : Promise.resolve(null),
      inferredRunId ? this.codeGraphService.getVerificationBundle(inferredRunId) : Promise.resolve(null),
      inferredRunId ? this.githubService.getShareReport(inferredRunId) : Promise.resolve(null as ShareableRunReport | null),
    ]);

    const effectiveRoute = preliminaryRoute || (persistedRoutingDecision
      ? ({
          id: persistedRoutingDecision.id,
          repoId: persistedRoutingDecision.repoId,
          ticketId: persistedRoutingDecision.ticketId,
          runId: persistedRoutingDecision.runId,
          executionMode: persistedRoutingDecision.executionMode,
          modelRole: persistedRoutingDecision.modelRole,
          providerId: persistedRoutingDecision.providerId,
          maxLanes: persistedRoutingDecision.maxLanes,
          risk: persistedRoutingDecision.risk,
          verificationDepth: persistedRoutingDecision.verificationDepth,
          decompositionScore: persistedRoutingDecision.decompositionScore,
          estimatedFileOverlap: persistedRoutingDecision.estimatedFileOverlap,
          rationale: asStringArray(persistedRoutingDecision.rationale),
          metadata: toRecord(persistedRoutingDecision.metadata),
          createdAt: persistedRoutingDecision.createdAt.toISOString(),
        } as RoutingDecision)
      : null);

    const filteredApprovals = approvals.filter((item) => item.action_type !== "provider_change");
    const relevantApprovals = filteredApprovals.filter((item) => {
      const aggregateId = typeof item.payload?.aggregate_id === "string" ? item.payload.aggregate_id : null;
      if (!selectedTicket?.id) {
        return aggregateId === null;
      }
      return aggregateId === null || aggregateId === selectedTicket.id;
    });

    const packFiles = contextPack?.files ?? [];
    const changedFiles = asStringArray(runSummary?.metadata?.changed_files);
    const timeline = buildTimeline(commands, relevantApprovals);
    const laneCounts = laneRows.reduce((map, lane) => {
      map.set(lane.ticketId, (map.get(lane.ticketId) ?? 0) + 1);
      return map;
    }, new Map<string, number>());
    const workflowCards = buildWorkflowCards(tickets, runSummary, contextPack, laneCounts);
    const workflowPillars = buildWorkflowPillars(workflowCards);

    return {
      project,
      recentProjects: repos,
      blueprint,
      route: effectiveRoute,
      routeSummary: buildRouteSummary(effectiveRoute),
      actionCapabilities: buildActionCapabilities(runSummary, selectedTicket),
      contextPack,
      runPhase: deriveRunPhase(runSummary, relevantApprovals, selectedTicket),
      runSummary,
      verification,
      selectedTicket,
      tickets,
      workflowPillars,
      workflowCards,
      changeBriefs: buildChangeBriefs(tickets, runSummary, packFiles),
      streams: buildStreams(tickets, relevantApprovals, runSummary),
      timeline,
      tasks: tickets.slice(0, 12).map((ticket) => ({
        task_id: ticket.id,
        title: ticket.title,
        phase: deriveTaskPhase(ticket),
      })),
      spotlight: buildSpotlight(
        selectedTicket,
        workflowState?.summary || null,
        workflowState?.nextSteps || [],
        workflowState?.blockers || [],
        effectiveRoute,
        packFiles,
        verification,
        timeline.filter((event) => event.task_id === selectedTicket?.id)
      ),
      codebaseFiles: buildCodebaseFiles(changedFiles, contextPack, runSummary?.modelRole || null),
      consoleLogs: buildConsoleLogs(commands, relevantApprovals),
      approvals: buildApprovals(relevantApprovals, selectedTicket?.id || null),
      guidelines,
      projectState,
      codeGraphStatus,
      shareReport,
      lastUpdatedAt: project?.updatedAt || null,
      overseer: {
        sessions,
        selectedSessionId: selectedSession?.id || null,
        messages,
      },
    };
  }

  async getTaskDetail(input: { projectId?: string | null; taskId: string }): Promise<WorkflowTaskDetail | null> {
    const snapshot = await this.getSnapshot({
      projectId: input.projectId || null,
      ticketId: input.taskId,
    });
    const ticket = snapshot.tickets.find((item) => item.id === input.taskId) ?? null;
    if (!ticket) {
      return null;
    }
    const workflowState = await this.contextService.getWorkflowState(ticket.id);
    const ticketEvents = await prisma.ticketEvent.findMany({
      where: { ticketId: ticket.id },
      orderBy: [{ createdAt: "desc" }],
      take: 20,
    });

    const logs: ConsoleEvent[] = snapshot.consoleLogs
      .filter((log) => log.taskId === input.taskId)
      .slice(-20)
      .map((log) => ({
        id: log.id,
        projectId: snapshot.project?.id ?? "",
        category: mapConsoleLogCategory(log.source),
        level: mapConsoleLogLevel(log.level),
        message: log.message,
        createdAt: log.timestamp,
        taskId: log.taskId,
      }));

    const verification = [
      ...(snapshot.verification?.changedFileChecks ?? []),
      ...(snapshot.verification?.impactedTests ?? []),
      ...(snapshot.verification?.docsChecked ?? []),
    ];

    const comments = await this.ticketService.listTicketComments(ticket.id, 50);

    const activityNotes = ticketEvents
      .slice()
      .reverse()
      .map((event) => ({
        id: event.id,
        author: "system",
        body: summarizeTicketEvent(event.type, toRecord(event.payload)),
        createdAt: event.createdAt.toISOString(),
      }));

    return {
      taskId: ticket.id,
      title: ticket.title,
      status: ticket.status,
      comments,
      activityNotes,
      metadata: {
        priority: ticket.priority,
        risk: ticket.risk,
        acceptanceCriteria: ticket.acceptanceCriteria,
        dependencies: ticket.dependencies,
        lastUpdatedAt: ticket.updatedAt,
      },
      logs,
      approvals: snapshot.approvals.filter((approval) => approval.relevantToCurrentTask),
      verification,
      impactedFiles: snapshot.selectedTicket?.id === ticket.id ? snapshot.contextPack?.files ?? [] : [],
      impactedTests: snapshot.selectedTicket?.id === ticket.id ? snapshot.contextPack?.tests ?? [] : [],
      impactedDocs: snapshot.selectedTicket?.id === ticket.id ? snapshot.contextPack?.docs ?? [] : [],
      workflowSummary: workflowState?.summary || null,
      blockers: workflowState?.blockers || [],
      nextSteps: workflowState?.nextSteps || [],
      route: snapshot.selectedTicket?.id === ticket.id ? snapshot.routeSummary : null,
    };
  }
}
