import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import type { ApiEventStream } from "../lib/apiClient";
import {
  activateProjectV5,
  addTicketComment,
  bootstrapEmptyProjectV8,
  connectGithubProjectV8,
  connectLocalProjectV8,
  decideMissionApprovalV8,
  executeScaffoldV8,
  generateProjectBlueprintV8,
  getSettings,
  getMissionSnapshotV8,
  getProjectStartersV8,
  openRecentProjectV8,
  openSessionStream,
  reviewOverseerRouteV8,
  sendOverseerMessageV8,
  setMissionTicketPermissionV9,
  setMissionWorkflowExecutionProfileV8,
  syncProjectV5,
  updateProjectBlueprintV8,
  updateSettings,
  getProjectBlueprintV8,
  moveMissionWorkflowV8,
  openAgenticRunStream,
  startAgenticRun,
  approveAgenticRunPlan,
  rejectAgenticRunPlan,
  refineAgenticRunPlan,
  answerAgenticRunPlanQuestion,
} from "../lib/apiClient";
import {
  buildApprovalFollowup,
  buildExecutionFailureActionMessage,
  normalizeApiErrorMessage,
  type TicketLifecycleNotice,
} from "../lib/missionFeedback";
import type {
  CodebaseFile,
  ConsoleLog,
  MissionChangeBrief,
  MissionRunPhase,
  MissionStream,
  MissionTaskCard,
  MissionTimelineEvent,
  TaskSpotlight,
} from "../lib/missionTypes";
import { getRecentRepos, getVisibleRepos } from "../lib/projectVisibility";
import { hasDesktopRepoPicker, listRecentRepoPaths, pickRepoDirectory, rememberRepoPath } from "../lib/desktopBridge";
import { useUiStore } from "../store/uiStore";
import type {
  ChatMessageDto,
  ContextPack,
  ExecutionProfileSettings,
  ModelRole,
  MissionControlSnapshot,
  ProjectBlueprint,
  ProjectStarterDefinition,
  ProjectStarterId,
  RepoRegistration,
  RoutingDecision,
} from "../../shared/contracts";

const ROLE_LABELS: Record<ModelRole, string> = {
  utility_fast: "Fast",
  coder_default: "Build",
  review_deep: "Review",
  overseer_escalation: "Escalate",
};

const DEFAULT_EXECUTION_PROFILES: ExecutionProfileSettings = {
  activeProfileId: "balanced",
  profiles: [
    {
      id: "balanced",
      name: "Balanced",
      description: "Fast scoping, standard build, deep review, escalate only when needed.",
      preset: "balanced",
      stages: {
        scope: "utility_fast",
        build: "coder_default",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "deep_scope",
      name: "Deep Scope",
      description: "Use deeper reasoning while scoping before standard implementation.",
      preset: "deep_scope",
      stages: {
        scope: "review_deep",
        build: "coder_default",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "build_heavy",
      name: "Build Heavy",
      description: "Favor deeper reasoning during implementation and review.",
      preset: "build_heavy",
      stages: {
        scope: "utility_fast",
        build: "review_deep",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
    {
      id: "custom",
      name: "Custom",
      description: "Editable lifecycle profile for project-specific overrides.",
      preset: "custom",
      stages: {
        scope: "utility_fast",
        build: "coder_default",
        review: "review_deep",
        escalate: "overseer_escalation",
      },
      updatedAt: new Date(0).toISOString(),
    },
  ],
};

function toPendingApproval(item: MissionControlSnapshot["approvals"][number]) {
  return {
    approval_id: item.approvalId,
    action_type: item.actionType,
    status: "pending" as const,
    reason: item.reason,
    payload: { aggregate_id: item.relevantToCurrentTask ? item.approvalId : null },
    requested_at: item.requestedAt,
    decided_at: null,
  };
}

function normalizeObjective(value: string | null | undefined) {
  return (value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function resolveTicketForObjective(input: {
  selectedTicketId: string | null;
  selectedTicket: MissionControlSnapshot["selectedTicket"] | null | undefined;
  objective: string;
}) {
  const { selectedTicketId, selectedTicket, objective } = input;
  if (!selectedTicketId || !selectedTicket) {
    return undefined;
  }

  const normalizedObjective = normalizeObjective(objective);
  if (!normalizedObjective) {
    return selectedTicketId;
  }

  const normalizedTitle = normalizeObjective(selectedTicket.title);
  const normalizedDescription = normalizeObjective(selectedTicket.description);
  const sameTicket =
    normalizedObjective === normalizedTitle ||
    normalizedObjective === normalizedDescription ||
    normalizedTitle.includes(normalizedObjective) ||
    normalizedDescription.includes(normalizedObjective);

  return sameTicket ? selectedTicketId : undefined;
}

type AppMode = "desktop" | "limited_preview" | "backend_unavailable";

type AppModeNotice = {
  title: string;
  message: string;
  detail: string;
};

type ProjectSetupState = {
  mode: "create" | "apply";
  source: "new_project" | "empty_folder" | "active_repo";
  folderPath?: string;
  displayName?: string;
  targetRepoId?: string;
  targetRepoName?: string;
};

function asRecord(value: unknown) {
  return (value ?? {}) as Record<string, unknown>;
}

function readStarterId(repo: RepoRegistration | null | undefined) {
  const starterId = asRecord(repo?.metadata).starter_id;
  return typeof starterId === "string" ? starterId : null;
}

function isBlankProject(repo: RepoRegistration | null | undefined) {
  const metadata = asRecord(repo?.metadata);
  return metadata.creation_mode === "blank" && typeof metadata.starter_id !== "string";
}

function starterObjective(starterId: ProjectStarterId) {
  if (starterId === "neutral_baseline") {
    return "Create a neutral project baseline with a README, repo charter, and generic ignore rules.";
  }
  return "Scaffold a TypeScript app with tests and documentation.";
}

function starterSuccessMessage(starterId: ProjectStarterId, status: "completed" | "needs_review" | "failed") {
  if (starterId === "neutral_baseline") {
    return "Neutral baseline applied. Go to Work or keep shaping the repo from Projects.";
  }
  return status === "completed"
    ? "TypeScript project scaffolded and verified."
    : "TypeScript project scaffolded. Review the verification follow-up.";
}

function summarizeAppError(error: unknown) {
  if (!(error instanceof Error)) {
    return "The local API is unavailable.";
  }

  const normalized = normalizeApiErrorMessage(error.message);
  if (/Failed to fetch|NetworkError|fetch failed/i.test(normalized)) {
    return "The local API is unavailable.";
  }
  if (/connect|refused|ECONNREFUSED|ENOTFOUND/i.test(normalized)) {
    return "The app cannot reach its local services.";
  }
  return normalized;
}

function resolveAppModeNotice(input: { appMode: AppMode; error: unknown }) {
  const { appMode, error } = input;
  if (appMode === "limited_preview") {
    return {
      title: "Browser preview is limited",
      message: "Repo picking, preflight checks, and full local execution require the Electron desktop app.",
      detail: "Use the desktop app for the real operator flow. In browser preview you can inspect layout, recent projects, and settings, but local repo actions stay limited.",
    } satisfies AppModeNotice;
  }

  if (appMode === "backend_unavailable") {
    return {
      title: "Backend unavailable",
      message: summarizeAppError(error),
      detail: "Start PostgreSQL on localhost:5433, then run `npm run start:desktop` for the full app or `npm run dev:api` if you are already running the renderer.",
    } satisfies AppModeNotice;
  }

  return null;
}

function mergeAgenticRunWithLiveEvents(
  base: MissionControlSnapshot["agenticRun"],
  liveEvents: Array<{
    createdAt: string;
    event: import("../../shared/contracts").AgenticEvent;
    runId: string;
    ticketId: string | null;
    projectId: string | null;
  }>,
  liveAssistantText: string,
) {
  if (!base) {
    return null;
  }

  const merged = {
    ...base,
    lastAssistantText: liveAssistantText || base.lastAssistantText,
    recentEvents: [
      ...base.recentEvents,
      ...liveEvents.map((item, index) => ({
        id: `live-${item.runId}-${index}-${item.createdAt}`,
        runId: item.runId,
        ticketId: item.ticketId,
        projectId: item.projectId,
        type: item.event.type,
        createdAt: item.createdAt,
        payload: item.event as unknown as Record<string, unknown>,
      })),
    ].slice(-24),
    toolCalls: [...base.toolCalls],
    compactionEvents: [...base.compactionEvents],
    escalations: [...base.escalations],
    doomLoops: [...base.doomLoops],
    skillEvents: [...base.skillEvents],
    hookEvents: [...base.hookEvents],
    memoryExtractions: [...base.memoryExtractions],
    thinkingLog: base.thinkingLog,
    budget: {
      ...base.budget,
      tokenTimeline: [...base.budget.tokenTimeline],
    },
  };

  for (const item of liveEvents) {
    const event = item.event;
    if (event.type === "tool_result") {
      const existing = merged.toolCalls.findIndex((call) => call.id === event.id);
      const next = {
        id: event.id,
        iteration: merged.iterationCount || 1,
        name: event.name,
        args: {},
        result: event.result,
        policyDecision: event.result.type === "approval_required" ? ("approval_required" as const) : "allow",
        durationMs: event.durationMs,
        timestamp: item.createdAt,
      };
      if (existing >= 0) merged.toolCalls[existing] = next;
      else merged.toolCalls.push(next);
    }
    if (event.type === "tool_approval_needed") {
      merged.approvalCount += 1;
    }
    if (event.type === "context_compacted") {
      merged.compactionEvents.push({
        iteration: merged.iterationCount || 1,
        stage: event.stage,
        tokensBefore: event.tokensBefore,
        tokensAfter: event.tokensAfter,
        timestamp: item.createdAt,
      });
    }
    if (event.type === "escalating") {
      merged.escalations.push({
        iteration: merged.iterationCount || 1,
        fromRole: event.fromRole,
        toRole: event.toRole,
        reason: event.reason,
        timestamp: item.createdAt,
      });
      merged.latestRole = event.toRole;
    }
    if (event.type === "doom_loop_detected") {
      merged.doomLoops.push({
        iteration: merged.iterationCount || 1,
        reason: event.reason,
        suggestion: event.suggestion,
        timestamp: item.createdAt,
      });
    }
    if (event.type === "hook_executed") {
      merged.hookEvents.push({
        hookId: event.hookId,
        hookName: event.hookName,
        eventType: event.eventType as import("../../shared/contracts").HookEventType,
        success: event.success,
        output: null,
        error: null,
        timestamp: item.createdAt,
      });
    }
    if (event.type === "memory_extracted") {
      merged.memoryExtractions.push({
        memoryId: event.memoryId,
        summary: event.summary,
        timestamp: item.createdAt,
      });
    }
    if (event.type === "skill_invoked") {
      merged.skillEvents.push({
        invocationId: event.invocationId,
        skillId: event.skillId,
        skillName: event.skillName,
        status: "running",
        output: null,
        childRunId: null,
        timestamp: item.createdAt,
      });
    }
    if (event.type === "skill_completed" || event.type === "skill_failed") {
      const existing = merged.skillEvents.findIndex((skill) => skill.invocationId === event.invocationId);
      if (existing >= 0) {
        merged.skillEvents[existing] = {
          ...merged.skillEvents[existing],
          status: event.type === "skill_completed" ? "completed" : "failed",
          output: event.type === "skill_completed" ? event.output : event.error,
        };
      }
    }
    if (event.type === "assistant_thinking") {
      merged.thinkingTokenCount += Math.ceil(event.value.length / 4);
      merged.thinkingLog = merged.thinkingLog ? `${merged.thinkingLog}\n${event.value}` : event.value;
    }
    if (event.type === "iteration_start") {
      merged.iterationCount = Math.max(merged.iterationCount, event.iteration);
    }
    if (event.type === "plan_started") merged.phase = "planning";
    if (event.type === "plan_submitted") merged.phase = "plan_review";
    if (event.type === "plan_approved") merged.phase = "executing";
    if (event.type === "plan_rejected") merged.phase = "failed";
    if (event.type === "plan_question_answered" || event.type === "plan_refine_requested") merged.phase = "planning";
  }

  return merged;
}

export function useMissionControlLiveData() {
  const queryClient = useQueryClient();
  const selectedSessionId = useUiStore((state) => state.selectedSessionId);
  const selectedTicketId = useUiStore((state) => state.selectedTicketId);
  const selectedRepoId = useUiStore((state) => state.selectedRepoId);
  const selectedRunId = useUiStore((state) => state.selectedRunId);
  const labsMode = useUiStore((state) => state.labsMode);
  const setSelectedRunId = useUiStore((state) => state.setSelectedRunId);
  const setSelectedSessionId = useUiStore((state) => state.setSelectedSessionId);
  const setSelectedRepoId = useUiStore((state) => state.setSelectedRepoId);
  const setSelectedTicketId = useUiStore((state) => state.setSelectedTicketId);
  const setActiveSection = useUiStore((state) => state.setActiveSection);

  const [input, setInput] = useState("");
  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [routePreview, setRoutePreview] = useState<RoutingDecision | null>(null);
  const [contextPackPreview, setContextPackPreview] = useState<ContextPack | null>(null);
  const [blueprintPreview, setBlueprintPreview] = useState<ProjectBlueprint | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [pendingBlueprintSuccessMessage, setPendingBlueprintSuccessMessage] = useState<string | null>(null);
  const [pendingExecutionProfileId, setPendingExecutionProfileId] = useState<string | null>(null);
  const [ticketLifecycleNotices, setTicketLifecycleNotices] = useState<Record<string, TicketLifecycleNotice>>({});
  const [repoPickerMessage, setRepoPickerMessage] = useState<string | null>(null);
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [projectSetupState, setProjectSetupState] = useState<ProjectSetupState | null>(null);
  const [agenticAssistantText, setAgenticAssistantText] = useState("");
  const [planModeEnabled, setPlanModeEnabled] = useState(false);
  const [coordinatorEnabled, setCoordinatorEnabled] = useState(false);
  const [coordinatorMaxAgents, setCoordinatorMaxAgents] = useState(5);
  const [coordinatorMaxConcurrent, setCoordinatorMaxConcurrent] = useState(3);
  const [agenticLiveEvents, setAgenticLiveEvents] = useState<Array<{
    createdAt: string;
    event: import("../../shared/contracts").AgenticEvent;
    runId: string;
    ticketId: string | null;
    projectId: string | null;
  }>>([]);

  const recentPathsQuery = useQuery({
    queryKey: ["desktop-recent-repos"],
    queryFn: listRecentRepoPaths,
    staleTime: 10000,
  });

  const starterCatalogQuery = useQuery({
    queryKey: ["project-starters-v8"],
    queryFn: getProjectStartersV8,
    staleTime: 60000,
  });

  const settingsQuery = useQuery({
    queryKey: ["app-settings"],
    queryFn: getSettings,
    staleTime: 10000,
  });

  const snapshotQuery = useQuery({
    queryKey: ["mission-snapshot-v8", selectedRepoId, selectedTicketId, selectedRunId, selectedSessionId],
    queryFn: () =>
      getMissionSnapshotV8({
        projectId: selectedRepoId || undefined,
        ticketId: selectedTicketId || undefined,
        runId: selectedRunId || undefined,
        sessionId: selectedSessionId || undefined,
      }),
    refetchInterval: 5000,
  });

  const snapshot = snapshotQuery.data?.item ?? null;
  const hasDesktopPicker = hasDesktopRepoPicker();
  const executionProfiles = settingsQuery.data?.items.executionProfiles ?? DEFAULT_EXECUTION_PROFILES;
  const projectProfileId = blueprintPreview?.providerPolicy.executionProfileId ?? snapshot?.blueprint?.providerPolicy.executionProfileId ?? null;
  const resolvedExecutionProfileId =
    projectProfileId && executionProfiles.profiles.some((item) => item.id === projectProfileId)
      ? projectProfileId
      : executionProfiles.activeProfileId;
  const selectedExecutionProfileId =
    pendingExecutionProfileId && executionProfiles.profiles.some((item) => item.id === pendingExecutionProfileId)
      ? pendingExecutionProfileId
      : resolvedExecutionProfileId;
  const selectedExecutionProfile =
    executionProfiles.profiles.find((item) => item.id === selectedExecutionProfileId) ?? executionProfiles.profiles[0];
  const selectedExecutionProfileStages = selectedExecutionProfile?.stages ?? DEFAULT_EXECUTION_PROFILES.profiles[0].stages;
  const visibleRepos = useMemo(() => getVisibleRepos(snapshot?.recentProjects ?? [], labsMode), [snapshot?.recentProjects, labsMode]);
  const recentRepos = useMemo(() => getRecentRepos(snapshot?.recentProjects ?? [], labsMode, 8), [snapshot?.recentProjects, labsMode]);
  const selectedRepo = useMemo(
    () => (snapshot?.project ? visibleRepos.find((repo) => repo.id === snapshot.project?.id) ?? snapshot.project : recentRepos[0] ?? null),
    [snapshot?.project, visibleRepos, recentRepos]
  );
  const projectStarters = starterCatalogQuery.data?.items ?? [];
  const activeStarterId = readStarterId(selectedRepo) as ProjectStarterId | null;
  const activeProjectIsBlank = isBlankProject(selectedRepo);

  const blueprintQuery = useQuery({
    queryKey: ["project-blueprint-v8", selectedRepo?.id],
    queryFn: () => getProjectBlueprintV8(selectedRepo!.id),
    enabled: Boolean(selectedRepo?.id),
    staleTime: 5000,
  });

  useEffect(() => {
    if (selectedRepo?.id && selectedRepo?.id !== selectedRepoId) {
      setSelectedRepoId(selectedRepo.id);
    }
  }, [selectedRepo?.id, selectedRepoId, setSelectedRepoId]);

  useEffect(() => {
    const snapshotTicketId = snapshot?.selectedTicket?.id ?? null;
    if (!snapshotTicketId) {
      return;
    }

    // Preserve manual ticket navigation while polling.
    // Only adopt the snapshot-selected ticket when nothing is selected locally,
    // or when the local selection no longer exists in the latest snapshot.
    const hasLocalSelection = Boolean(selectedTicketId);
    const localSelectionExists = hasLocalSelection
      ? (snapshot?.tickets ?? []).some((ticket) => ticket.id === selectedTicketId)
      : false;

    if (!hasLocalSelection || !localSelectionExists) {
      if (snapshotTicketId !== selectedTicketId) {
        setSelectedTicketId(snapshotTicketId);
      }
    }
  }, [selectedTicketId, setSelectedTicketId, snapshot?.selectedTicket?.id, snapshot?.tickets]);

  useEffect(() => {
    const resolvedSessionId = snapshot?.overseer.selectedSessionId || null;
    if (resolvedSessionId && resolvedSessionId !== selectedSessionId) {
      setSelectedSessionId(resolvedSessionId);
    }
  }, [selectedSessionId, setSelectedSessionId, snapshot?.overseer.selectedSessionId]);

  useEffect(() => {
    if (!selectedRunId && snapshot?.runSummary?.runId) {
      setSelectedRunId(snapshot.runSummary.runId);
    }
  }, [selectedRunId, setSelectedRunId, snapshot?.runSummary?.runId]);

  useEffect(() => {
    if (snapshot?.blueprint) {
      setBlueprintPreview(snapshot.blueprint);
    }
  }, [snapshot?.blueprint]);

  useEffect(() => {
    if (blueprintQuery.isSuccess) {
      setBlueprintPreview(blueprintQuery.data?.item ?? null);
    }
  }, [blueprintQuery.data?.item, blueprintQuery.isSuccess]);

  useEffect(() => {
    if (pendingExecutionProfileId && pendingExecutionProfileId === resolvedExecutionProfileId) {
      setPendingExecutionProfileId(null);
    }
  }, [pendingExecutionProfileId, resolvedExecutionProfileId]);

  useEffect(() => {
    if (pendingExecutionProfileId && !executionProfiles.profiles.some((item) => item.id === pendingExecutionProfileId)) {
      setPendingExecutionProfileId(null);
    }
  }, [executionProfiles.profiles, pendingExecutionProfileId]);

  useEffect(() => {
    const resolvedSessionId = snapshot?.overseer.selectedSessionId;
    if (!resolvedSessionId) {
      return;
    }

    let source: ApiEventStream | null = null;
    let cancelled = false;

    void openSessionStream(resolvedSessionId).then((eventSource) => {
      if (cancelled) {
        eventSource.close();
        return;
      }

      source = eventSource;

      const handleToken = (evt: MessageEvent) => {
        const parsed = JSON.parse(evt.data) as { payload: { token?: string } };
        setStreaming(true);
        setStreamText((current) => current + String(parsed.payload.token || ""));
      };

      const handleDone = () => {
        setStreaming(false);
        setStreamText("");
        queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      };

      const handleAssistantMessage = () => {
        setStreamText("");
      };

      source.addEventListener("chat.token", handleToken as EventListener);
      source.addEventListener("chat.done", handleDone as EventListener);
      source.addEventListener("chat.message.assistant", handleAssistantMessage as EventListener);
      source.addEventListener("chat.error", handleDone as EventListener);
    });

    return () => {
      cancelled = true;
      if (source) source.close();
    };
  }, [queryClient, snapshot?.overseer.selectedSessionId]);

  useEffect(() => {
    const runId = snapshot?.agenticRun?.runId || selectedRunId;
    if (!runId) {
      setAgenticAssistantText("");
      setAgenticLiveEvents([]);
      return;
    }

    let source: ApiEventStream | null = null;
    let cancelled = false;
    setAgenticAssistantText("");
    setAgenticLiveEvents([]);

    void openAgenticRunStream(runId).then((eventSource) => {
      if (cancelled) {
        eventSource.close();
        return;
      }

      source = eventSource;

      const handleEvent = (evt: MessageEvent) => {
        const parsed = JSON.parse(evt.data) as {
          runId?: string;
          run_id?: string;
          ticketId?: string | null;
          ticket_id?: string | null;
          projectId?: string | null;
          project_id?: string | null;
          event?: import("../../shared/contracts").AgenticEvent;
        };
        if (!parsed.event) {
          return;
        }

        if (parsed.event.type === "assistant_token") {
          setAgenticAssistantText((current) => current + parsed.event.value);
          return;
        }

        if (parsed.event.type === "execution_complete" || parsed.event.type === "execution_aborted" || parsed.event.type === "error") {
          setAgenticAssistantText("");
          void queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
        }

        setAgenticLiveEvents((current) => [
          ...current.slice(-23),
          {
            createdAt: new Date().toISOString(),
            event: parsed.event!,
            runId: parsed.runId || parsed.run_id || runId,
            ticketId: parsed.ticketId || parsed.ticket_id || null,
            projectId: parsed.projectId || parsed.project_id || null,
          },
        ]);
      };

      source.addEventListener("agentic", handleEvent as EventListener);
      source.addEventListener("error", (() => {
        void queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      }) as EventListener);
    });

    return () => {
      cancelled = true;
      if (source) source.close();
    };
  }, [queryClient, selectedRunId, snapshot?.agenticRun?.runId]);

  const activateRepoMutation = useMutation({
    mutationFn: (repoId: string) =>
      activateProjectV5({
        actor: "user",
        repo_id: repoId,
        state: {
          selectedTicketId,
          selectedRunId,
          recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
        },
      }),
    onSuccess: ({ repo }) => {
      setSelectedRepoId(repo.id);
      setSelectedTicketId(null);
      setSelectedSessionId(null);
      setSelectedRunId(null);
      setRoutePreview(null);
      setContextPackPreview(null);
      setActionMessage(null);
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActiveSection("live");
    },
  });

  const connectLocalMutation = useMutation({
    onMutate: () => {
      setRepoPickerMessage(null);
      setActionMessage("Connecting local repo...");
    },
    mutationFn: async ({ sourcePath, displayName }: { sourcePath: string; displayName?: string }) => {
      const result = await connectLocalProjectV8({
        actor: "user",
        source_path: sourcePath,
        display_name: displayName || undefined,
      });
      if ("bootstrapRequired" in result && result.bootstrapRequired) {
        await rememberRepoPath(sourcePath, displayName || sourcePath.split("/").pop() || "New Project");
        return result;
      }

      await rememberRepoPath(sourcePath, displayName || result.repo.displayName);
      const activation = await activateProjectV5({
        actor: "user",
        repo_id: result.repo.id,
        state: {
          selectedTicketId,
          selectedRunId,
          recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
        },
      });
      return { repo: result.repo, activation, blueprint: result.blueprint ?? null };
    },
    onSuccess: (result) => {
      if ("bootstrapRequired" in result && result.bootstrapRequired) {
        setProjectSetupState({
          mode: "create",
          source: "empty_folder",
          folderPath: result.folderPath,
          displayName: result.folderPath.split("/").pop() || "New Project",
        });
        setRepoPickerMessage(null);
        setActionMessage("This folder is empty. Create a blank project or apply a starter to continue.");
        setActiveSection("projects");
        return;
      }

      const { repo, blueprint } = result;
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-recent-repos"] });
      setSelectedRepoId(repo.id);
      setSelectedTicketId(null);
      setSelectedSessionId(null);
      setSelectedRunId(null);
      setRoutePreview(null);
      setContextPackPreview(null);
      setBlueprintPreview(blueprint);
      setProjectSetupState(null);
      setRepoPickerMessage(null);
      setActionMessage("Repo connected.");
      toast.success("Project connected");
      setActiveSection("live");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to connect the selected folder.";
      setRepoPickerMessage(message);
      setActionMessage(`Local repo attach failed: ${message}`);
      toast.error("Failed to connect project");
    },
  });

  const bootstrapProjectMutation = useMutation({
    onMutate: () => {
      setRepoPickerMessage(null);
      setActionMessage("Initializing new project...");
    },
    mutationFn: async ({
      folderPath,
      displayName,
      starterId,
    }: {
      folderPath: string;
      displayName?: string;
      starterId?: ProjectStarterId | null;
    }) => {
      const bootstrap = await bootstrapEmptyProjectV8({
        actor: "user",
        folderPath,
        displayName,
        starterId: starterId ?? null,
        initializeGit: true,
      });

      await rememberRepoPath(folderPath, displayName || bootstrap.repo.displayName);
      await activateProjectV5({
        actor: "user",
        repo_id: bootstrap.repo.id,
        state: {
          selectedTicketId,
          selectedRunId,
          recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
        },
      });

      const scaffold = starterId
        ? await executeScaffoldV8(bootstrap.repo.id, {
            actor: "user",
            starterId,
            objective: starterObjective(starterId),
          })
        : null;

      return {
        bootstrap,
        scaffold,
        starterId: starterId ?? null,
      };
    },
    onSuccess: ({ bootstrap, scaffold, starterId }) => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-recent-repos"] });
      setSelectedRepoId(bootstrap.repo.id);
      setSelectedTicketId(null);
      setSelectedSessionId(null);
      setSelectedRunId(scaffold?.result.runId ?? null);
      setRoutePreview(null);
      setContextPackPreview(null);
      setBlueprintPreview(scaffold?.blueprint || bootstrap.blueprint);
      setProjectSetupState(null);
      setRepoPickerMessage(null);
      setActionMessage(
        starterId && scaffold
          ? starterSuccessMessage(starterId, scaffold.result.status)
          : "Blank project created. Go to Work or apply a starter."
      );
      setActiveSection(starterId ? "live" : "projects");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to initialize the selected folder.";
      setRepoPickerMessage(message);
      setActionMessage(`Project initialization failed: ${message}`);
    },
  });

  const applyStarterMutation = useMutation({
    onMutate: () => {
      setRepoPickerMessage(null);
      setActionMessage("Applying starter...");
    },
    mutationFn: async ({ repoId, starterId }: { repoId: string; starterId: ProjectStarterId }) =>
      executeScaffoldV8(repoId, {
        actor: "user",
        starterId,
        objective: starterObjective(starterId),
      }),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-recent-repos"] });
      setSelectedRunId(result.result.runId ?? null);
      setBlueprintPreview(result.blueprint);
      setProjectSetupState(null);
      setActionMessage(starterSuccessMessage(variables.starterId, result.result.status));
      setActiveSection("live");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to apply the selected starter.";
      setRepoPickerMessage(message);
      setActionMessage(`Starter application failed: ${message}`);
    },
  });

  const connectGithubMutation = useMutation({
    mutationFn: async () => {
      if (!githubOwner.trim() || !githubRepo.trim()) {
        throw new Error("Enter owner and repo.");
      }
      const result = await connectGithubProjectV8({
        actor: "user",
        owner: githubOwner.trim(),
        repo: githubRepo.trim(),
      });
      const activation = await activateProjectV5({
        actor: "user",
        repo_id: result.repo.id,
        state: {
          selectedTicketId,
          selectedRunId,
          recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
        },
      });
      return { repo: result.repo, activation };
    },
    onSuccess: ({ repo }) => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setSelectedRepoId(repo.id);
      setSelectedTicketId(null);
      setSelectedSessionId(null);
      setSelectedRunId(null);
      setGithubOwner("");
      setGithubRepo("");
      setActionMessage("GitHub project connected.");
      toast.success("GitHub project connected");
      setActiveSection("live");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Unable to connect GitHub project.";
      setActionMessage(`GitHub connect failed: ${message}`);
      toast.error("Failed to connect GitHub project");
    },
  });

  const syncProjectMutation = useMutation({
    onMutate: (repoId: string) => {
      const targetRepo = recentRepos.find((repo) => repo.id === repoId) || (selectedRepo?.id === repoId ? selectedRepo : null);
      setActionMessage(`${targetRepo?.sourceKind === "github_app_bound" ? "Syncing" : "Refreshing"} ${targetRepo?.displayName || "project"}...`);
    },
    mutationFn: (repoId: string) => syncProjectV5({ actor: "user", repo_id: repoId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Project synced.");
    },
    onError: (error) => {
      const message = error instanceof Error ? error.message : "Project sync failed.";
      setActionMessage(`Project sync failed: ${message}`);
    },
  });

  const reviewRouteMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRepo?.id) {
        throw new Error("Choose a repo first.");
      }
      const objective = input.trim();
      if (!objective) {
        throw new Error("Enter an objective first.");
      }
      const ticketId = resolveTicketForObjective({
        selectedTicketId,
        selectedTicket: snapshot?.selectedTicket,
        objective,
      });
      return reviewOverseerRouteV8({
        actor: "user",
        project_id: selectedRepo.id,
        ticket_id: ticketId,
        prompt: objective,
        risk_level: snapshot?.selectedTicket?.risk || "medium",
        execution_profile_id: selectedExecutionProfile?.id,
      });
    },
    onMutate: () => {
      setActionMessage("Scoping objective into a backlog ticket...");
    },
    onSuccess: (result) => {
      setSelectedTicketId(result.ticket.id);
      setRoutePreview(result.route);
      setContextPackPreview(result.contextPack);
      if (result.blueprint) {
        setBlueprintPreview(result.blueprint);
      }
      setActionMessage("Ticket scoped and queued in backlog.");
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
    },
    onError: (error) => {
      if (error instanceof Error) {
        setActionMessage(`Route review failed: ${error.message}`);
        return;
      }
      setActionMessage("Route review failed.");
    },
  });

  const executeMutation = useMutation({
    mutationFn: async () => {
      if (!selectedRepo?.id) {
        throw new Error("Choose a repo first.");
      }
      const objective = input.trim();
      if (!objective) {
        throw new Error("Enter an objective first.");
      }
      const ticketId = resolveTicketForObjective({
        selectedTicketId,
        selectedTicket: snapshot?.selectedTicket,
        objective,
      });
      return startAgenticRun({
        actor: "user",
        project_id: selectedRepo.id,
        ticket_id: ticketId,
        objective,
        initial_model_role: selectedExecutionProfileStages.build,
        use_deferred_tools: true,
        plan_mode: planModeEnabled,
        coordinator: coordinatorEnabled || undefined,
        coordinator_options: coordinatorEnabled ? {
          max_agents: coordinatorMaxAgents,
          max_concurrent: coordinatorMaxConcurrent,
        } : undefined,
      });
    },
    onMutate: () => {
      setActionMessage("Starting tracked agentic run...");
    },
    onSuccess: (result) => {
      setSelectedTicketId(result.ticket.id);
      setSelectedRunId(result.runId);
      setAgenticAssistantText("");
      setAgenticLiveEvents([]);
      setActionMessage("Agentic run started. Mission Control is now following the live execution stream.");
      toast.success("Execution started");
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
    },
    onError: (error) => {
      if (error instanceof Error) {
        setActionMessage(buildExecutionFailureActionMessage(error.message));
        toast.error("Execution failed", { description: error.message });
        return;
      }
      setActionMessage("Execution failed.");
      toast.error("Execution failed");
    },
  });

  const approvePlanMutation = useMutation({
    mutationFn: (runId: string) => approveAgenticRunPlan(runId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Plan approved. Execution resumed.");
    },
  });

  const rejectPlanMutation = useMutation({
    mutationFn: ({ runId, reason }: { runId: string; reason: string }) => rejectAgenticRunPlan(runId, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Plan rejected.");
    },
  });

  const refinePlanMutation = useMutation({
    mutationFn: ({ runId, feedback }: { runId: string; feedback: string }) => refineAgenticRunPlan(runId, feedback),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Requested plan refinement.");
    },
  });

  const answerPlanQuestionMutation = useMutation({
    mutationFn: ({ runId, questionId, answer }: { runId: string; questionId: string; answer: string }) =>
      answerAgenticRunPlanQuestion(runId, questionId, answer),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Plan question answered. Planning resumed.");
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) =>
      sendOverseerMessageV8({
        actor: "user",
        project_id: selectedRepo?.id,
        session_id: snapshot?.overseer.selectedSessionId || undefined,
        content,
        model_role: selectedExecutionProfileStages.scope,
      }),
    onSuccess: ({ sessionId }) => {
      setSelectedSessionId(sessionId);
      setInput("");
      setStreamText("");
      setActionMessage(null);
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
    },
  });

  const approvalMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" }) =>
      decideMissionApprovalV8({
        approval_id: id,
        decision,
        decided_by: "user",
      }),
    onSuccess: (result, variables) => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      const followup = buildApprovalFollowup({
        decision: variables.decision,
        requeue: result.lifecycle_requeue,
        commandExecution: result.command_execution,
        fallbackTicketId: selectedTicketId,
      });

      if (followup.ticketId && followup.notice) {
        setTicketLifecycleNotices((prev) => ({
          ...prev,
          [followup.ticketId]: followup.notice,
        }));
      }

      setActionMessage(followup.actionMessage);
      toast(variables.decision === "approved" ? "Approved" : "Rejected");
    },
  });

  const moveWorkflowMutation = useMutation({
    mutationFn: moveMissionWorkflowV8,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Workflow updated.");
    },
  });

  const addTaskCommentMutation = useMutation({
    mutationFn: ({
      taskId,
      body,
      parentCommentId,
    }: {
      taskId: string;
      body: string;
      parentCommentId?: string | null;
    }) => addTicketComment(taskId, { body, parentCommentId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      queryClient.invalidateQueries({ queryKey: ["command-workflow-task-detail"] });
      setActionMessage("Comment added.");
    },
  });

  const setTicketExecutionProfileMutation = useMutation({
    mutationFn: ({
      taskId,
      executionProfileId,
    }: {
      taskId: string;
      executionProfileId?: string | null;
    }) =>
      setMissionWorkflowExecutionProfileV8({
        workflowId: taskId,
        executionProfileId: executionProfileId ?? null,
        actor: "user",
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      queryClient.invalidateQueries({ queryKey: ["command-workflow-task-detail"] });
      const profileName =
        executionProfiles.profiles.find((item) => item.id === variables.executionProfileId)?.name || null;
      setActionMessage(profileName ? `Ticket override set to ${profileName}.` : "Ticket override cleared.");
    },
  });

  const setTicketPermissionMutation = useMutation({
    mutationFn: ({
      taskId,
      mode,
    }: {
      taskId: string;
      mode: "balanced" | "strict";
    }) =>
      setMissionTicketPermissionV9({
        ticket_id: taskId,
        mode,
        actor: "user",
      }),
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      queryClient.invalidateQueries({ queryKey: ["command-workflow-task-detail"] });
      const modeLabel = variables.mode === "strict" ? "Strict" : "Balanced";
      setActionMessage(`Ticket permissions set to ${modeLabel}.`);
    },
  });

  const updateBlueprintMutation = useMutation({
    mutationFn: (patch: Partial<ProjectBlueprint>) => {
      if (!selectedRepo?.id) {
        throw new Error("Choose a repo first.");
      }
      return updateProjectBlueprintV8(selectedRepo.id, patch);
    },
    onSuccess: ({ item }) => {
      setBlueprintPreview(item);
      setPendingExecutionProfileId(null);
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      queryClient.invalidateQueries({ queryKey: ["project-blueprint-v8"] });
      setActionMessage(pendingBlueprintSuccessMessage || "Project blueprint updated.");
      setPendingBlueprintSuccessMessage(null);
    },
    onError: () => {
      setPendingExecutionProfileId(null);
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setPendingBlueprintSuccessMessage(null);
    },
  });

  const regenerateBlueprintMutation = useMutation({
    mutationFn: () => {
      if (!selectedRepo?.id) {
        throw new Error("Choose a repo first.");
      }
      return generateProjectBlueprintV8(selectedRepo.id);
    },
    onSuccess: ({ item }) => {
      setBlueprintPreview(item);
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      queryClient.invalidateQueries({ queryKey: ["project-blueprint-v8"] });
      setActionMessage("Blueprint regenerated from repo guidance.");
      toast.success("Blueprint regenerated");
    },
    onError: () => toast.error("Failed to regenerate blueprint"),
  });

  function setExecutionProfile(profileId: string) {
    const nextProfile =
      executionProfiles.profiles.find((item) => item.id === profileId) ??
      executionProfiles.profiles.find((item) => item.id === executionProfiles.activeProfileId) ??
      executionProfiles.profiles[0];
    if (!nextProfile) {
      return;
    }

    setPendingExecutionProfileId(nextProfile.id);

    if (selectedRepo?.id) {
      const currentBlueprint = blueprintPreview ?? snapshot?.blueprint ?? null;
      if (currentBlueprint) {
        setBlueprintPreview({
          ...currentBlueprint,
          providerPolicy: {
            ...currentBlueprint.providerPolicy,
            executionProfileId: nextProfile.id,
          },
        });
      }
      setPendingBlueprintSuccessMessage(`Execution profile updated to ${nextProfile.name}. Re-scope or continue work to apply it.`);
      updateBlueprintMutation.mutate({
        providerPolicy: {
          ...(blueprintPreview?.providerPolicy ?? snapshot?.blueprint?.providerPolicy ?? {}),
          executionProfileId: nextProfile.id,
        },
      });
      return;
    }

    void updateSettings({
      executionProfiles: {
        ...executionProfiles,
        activeProfileId: nextProfile.id,
      },
    })
      .then(() => {
        setPendingExecutionProfileId(null);
        queryClient.invalidateQueries({ queryKey: ["app-settings"] });
        setActionMessage(`Execution profile set to ${nextProfile.name}. Re-scope or continue work to apply it.`);
      })
      .catch((error) => {
        setPendingExecutionProfileId(null);
        setActionMessage(error instanceof Error ? error.message : "Unable to update execution profile.");
      });
  }

  async function chooseLocalRepo() {
    if (!hasDesktopRepoPicker()) {
      setRepoPickerMessage("Repo picker is available in the desktop app. Open the Electron window or use the Projects screen advanced path fallback.");
      return;
    }
    setRepoPickerMessage(null);
    try {
      const picked = await pickRepoDirectory();
      if (picked.canceled || !picked.path) {
        return;
      }
      connectLocalMutation.mutate({ sourcePath: picked.path });
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unable to open the repo picker.";
      setRepoPickerMessage(message);
      setActionMessage(`Local repo selection failed: ${message}`);
    }
  }

  function openNewProjectDialog() {
    setProjectSetupState({
      mode: "create",
      source: "new_project",
    });
  }

  function openStarterDialogForActiveProject() {
    if (!selectedRepo?.id) {
      return;
    }
    setProjectSetupState({
      mode: "apply",
      source: "active_repo",
      targetRepoId: selectedRepo.id,
      targetRepoName: selectedRepo.displayName,
    });
  }

  function dismissProjectSetupDialog() {
    setProjectSetupState(null);
  }

  async function runProjectSetup(starterId: ProjectStarterId | null) {
    const setupState = projectSetupState;
    if (!setupState) {
      return;
    }

    if (setupState.mode === "apply") {
      if (!setupState.targetRepoId || !starterId) {
        return;
      }
      applyStarterMutation.mutate({
        repoId: setupState.targetRepoId,
        starterId,
      });
      return;
    }

    if (!hasDesktopRepoPicker() && !setupState.folderPath) {
      setRepoPickerMessage("New Project uses the desktop folder picker. Open the Electron window to choose a target folder.");
      return;
    }

    let folderPath = setupState.folderPath;
    if (!folderPath) {
      const picked = await pickRepoDirectory();
      if (picked.canceled || !picked.path) {
        return;
      }
      folderPath = picked.path;
    }

    bootstrapProjectMutation.mutate({
      folderPath,
      displayName: setupState.displayName,
      starterId,
    });
  }

  const effectiveRoute = routePreview || snapshot?.route || null;
  const effectiveContextPack = contextPackPreview || snapshot?.contextPack || null;
  const effectiveAgenticRun = mergeAgenticRunWithLiveEvents(snapshot?.agenticRun ?? null, agenticLiveEvents, agenticAssistantText);
  const pendingApprovals = (snapshot?.approvals ?? []).map(toPendingApproval);
  const runSummary = snapshot?.runSummary || null;
  const verification = snapshot?.verification || null;
  const backendError = snapshotQuery.error ?? settingsQuery.error ?? null;
  const appMode: AppMode = !hasDesktopPicker ? "limited_preview" : backendError ? "backend_unavailable" : "desktop";
  const appModeNotice = resolveAppModeNotice({ appMode, error: backendError });
  const messages = useMemo(() => {
    const rows = snapshot?.overseer.messages ?? [];
    if (!streamText) return rows;
    return [
      ...rows,
      {
        id: "streaming-assistant",
        sessionId: snapshot?.overseer.selectedSessionId || "",
        role: "assistant",
        content: streamText,
        createdAt: new Date().toISOString(),
        metadata: { streaming: true },
      } satisfies ChatMessageDto,
    ];
  }, [snapshot?.overseer.messages, snapshot?.overseer.selectedSessionId, streamText]);

  const headerRepos = useMemo(() => {
    const items = [...recentRepos];
    if (selectedRepo && !items.some((repo) => repo.id === selectedRepo.id)) {
      items.unshift(selectedRepo);
    }
    return items;
  }, [recentRepos, selectedRepo]);

  return {
    selectedRepo,
    visibleRepos,
    recentRepos,
    headerRepos,
    recentRepoPaths: recentPathsQuery.data ?? [],
    selectedTicket: snapshot?.selectedTicket || null,
    tickets: snapshot?.tickets ?? [],
    sessions: snapshot?.overseer.sessions ?? [],
    selectedSessionId: snapshot?.overseer.selectedSessionId || null,
    messages,
    input,
    setInput,
    planModeEnabled,
    setPlanModeEnabled,
    coordinatorEnabled,
    setCoordinatorEnabled,
    coordinatorMaxAgents,
    setCoordinatorMaxAgents,
    coordinatorMaxConcurrent,
    setCoordinatorMaxConcurrent,
    streaming,
    roleLabels: ROLE_LABELS,
    executionProfiles,
    selectedExecutionProfileId: selectedExecutionProfile?.id ?? executionProfiles.activeProfileId,
    selectedExecutionProfile,
    selectedExecutionProfileStages,
    setExecutionProfile,
    route: effectiveRoute,
    contextPack: effectiveContextPack,
    blueprint: blueprintPreview,
    workflowPillars: snapshot?.workflowPillars ?? [],
    workflowCards: snapshot?.workflowCards ?? [],
    ticketLifecycleNotices,
    changeBriefs: (snapshot?.changeBriefs ?? []) as MissionChangeBrief[],
    streams: (snapshot?.streams ?? []) as MissionStream[],
    timeline: (snapshot?.timeline ?? []) as MissionTimelineEvent[],
    tasks: (snapshot?.tasks ?? []) as MissionTaskCard[],
    spotlight: (snapshot?.spotlight ?? null) as TaskSpotlight | null,
    codebaseFiles: (snapshot?.codebaseFiles ?? []) as CodebaseFile[],
    consoleLogs: (snapshot?.consoleLogs ?? []) as ConsoleLog[],
    consoleEvents: (snapshot?.consoleEvents ?? []) as import("../../shared/contracts").ConsoleEvent[],
    experimentalAutonomy: snapshot?.experimentalAutonomy ?? { channels: [], subagents: [] },
    agenticRun: effectiveAgenticRun,
    pendingApprovals,
    liveState: !selectedRepo ? "disconnected" : snapshotQuery.isLoading ? "loading" : snapshotQuery.isError ? "degraded" : "live",
    lastUpdatedAt: snapshot?.lastUpdatedAt || selectedRepo?.updatedAt || null,
    error:
      connectLocalMutation.error instanceof Error
        ? connectLocalMutation.error.message
        : connectGithubMutation.error instanceof Error
        ? connectGithubMutation.error.message
        : reviewRouteMutation.error instanceof Error
        ? reviewRouteMutation.error.message
        : executeMutation.error instanceof Error
        ? executeMutation.error.message
        : sendMutation.error instanceof Error
        ? sendMutation.error.message
        : updateBlueprintMutation.error instanceof Error
        ? updateBlueprintMutation.error.message
        : setTicketExecutionProfileMutation.error instanceof Error
        ? setTicketExecutionProfileMutation.error.message
        : setTicketPermissionMutation.error instanceof Error
        ? setTicketPermissionMutation.error.message
        : starterCatalogQuery.error instanceof Error
        ? starterCatalogQuery.error.message
        : snapshotQuery.error instanceof Error
        ? snapshotQuery.error.message
        : null,
    actionMessage,
    repoPickerMessage,
    setRepoPickerMessage,
    runPhase: (snapshot?.runPhase || "idle") as MissionRunPhase,
    runSummary,
    verification,
    guidelines: snapshot?.guidelines ?? null,
    projectState: snapshot?.projectState ?? null,
    codeGraphStatus: snapshot?.codeGraphStatus ?? null,
    shareReport: snapshot?.shareReport ?? null,
    appMode,
    appModeNotice,
    actionCapabilities: snapshot?.actionCapabilities ?? {
      canRefresh: true,
      canStop: false,
      canRequeue: false,
      canMarkActive: false,
      canComplete: false,
      canRetry: false,
    },
    githubOwner,
    setGithubOwner,
    githubRepo,
    setGithubRepo,
    hasDesktopPicker,
    hasAnyProjects: recentRepos.length > 0,
    projectStarters,
    projectSetupState,
    activeStarterId,
    activeProjectIsBlank,
    isActing:
      sendMutation.isPending ||
      reviewRouteMutation.isPending ||
      executeMutation.isPending ||
      connectLocalMutation.isPending ||
      bootstrapProjectMutation.isPending ||
      applyStarterMutation.isPending ||
      connectGithubMutation.isPending ||
      activateRepoMutation.isPending ||
      syncProjectMutation.isPending ||
      updateBlueprintMutation.isPending ||
      regenerateBlueprintMutation.isPending ||
      moveWorkflowMutation.isPending ||
      addTaskCommentMutation.isPending ||
      setTicketExecutionProfileMutation.isPending ||
      setTicketPermissionMutation.isPending ||
      approvePlanMutation.isPending ||
      rejectPlanMutation.isPending ||
      refinePlanMutation.isPending ||
      answerPlanQuestionMutation.isPending,
    chooseLocalRepo,
    openNewProjectDialog,
    openStarterDialogForActiveProject,
    dismissProjectSetupDialog,
    createBlankProject: () => runProjectSetup(null),
    createProjectFromStarter: (starterId: ProjectStarterId) => runProjectSetup(starterId),
    connectRecentPath: (path: string, label?: string) =>
      openRecentProjectV8({ actor: "user", source_path: path, display_name: label }).then(async (result) => {
        if ("bootstrapRequired" in result && result.bootstrapRequired) {
          setProjectSetupState({
            mode: "create",
            source: "empty_folder",
            folderPath: result.folderPath,
            displayName: label,
          });
          setActionMessage("This folder is empty. Create a blank project or apply a starter to continue.");
          setActiveSection("projects");
          return;
        }

        const { repo, blueprint } = result;
        void rememberRepoPath(path, label || repo.displayName);
        await activateProjectV5({
          actor: "user",
          repo_id: repo.id,
          state: {
            selectedTicketId,
            selectedRunId,
            recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
          },
        });
        setSelectedRepoId(repo.id);
        setSelectedTicketId(null);
        setSelectedSessionId(null);
        setSelectedRunId(null);
        setRoutePreview(null);
        setContextPackPreview(null);
        setBlueprintPreview(blueprint ?? null);
        setProjectSetupState(null);
        queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
        setActiveSection("live");
      }),
    connectGithubProject: () => connectGithubMutation.mutate(),
    activateRepo: (repoId: string) => activateRepoMutation.mutate(repoId),
    syncProject: (repoId: string) => syncProjectMutation.mutate(repoId),
    syncingRepoId: syncProjectMutation.isPending ? syncProjectMutation.variables ?? null : null,
    isConnectingLocal: connectLocalMutation.isPending,
    isBootstrappingProject: bootstrapProjectMutation.isPending || applyStarterMutation.isPending,
    isConnectingGithub: connectGithubMutation.isPending,
    isRefreshingBlueprint: regenerateBlueprintMutation.isPending,
    setSelectedTicketId,
    setSelectedSessionId,
    reviewRoute: () => reviewRouteMutation.mutate(),
    executeRoute: () => executeMutation.mutate(),
    approvePlan: (runId: string) => approvePlanMutation.mutate(runId),
    rejectPlan: (runId: string, reason: string) => rejectPlanMutation.mutate({ runId, reason }),
    refinePlan: (runId: string, feedback: string) => refinePlanMutation.mutate({ runId, feedback }),
    answerPlanQuestion: (runId: string, questionId: string, answer: string) =>
      answerPlanQuestionMutation.mutate({ runId, questionId, answer }),
    sendMessage: () => {
      if (!input.trim()) return;
      sendMutation.mutate(input.trim());
    },
    decideApproval: (id: string, decision: "approved" | "rejected") => approvalMutation.mutate({ id, decision }),
    moveWorkflow: (input: import("../../shared/contracts").WorkflowMoveRequest) => moveWorkflowMutation.mutate(input),
    addTaskComment: (taskId: string, body: string, parentCommentId?: string | null) =>
      addTaskCommentMutation.mutate({ taskId, body, parentCommentId }),
    setTicketExecutionProfile: (taskId: string, executionProfileId?: string | null) =>
      setTicketExecutionProfileMutation.mutate({ taskId, executionProfileId }),
    setTicketPermissionMode: (taskId: string, mode: "balanced" | "strict") =>
      setTicketPermissionMutation.mutate({ taskId, mode }),
    isCommenting: addTaskCommentMutation.isPending,
    isUpdatingTicketExecutionProfile: setTicketExecutionProfileMutation.isPending,
    isUpdatingTicketPermissionMode: setTicketPermissionMutation.isPending,
    isUpdatingExecutionProfile: Boolean(pendingExecutionProfileId) || updateBlueprintMutation.isPending,
    isReviewing: reviewRouteMutation.isPending,
    isExecuting:
      executeMutation.isPending ||
      effectiveAgenticRun?.status === "running" ||
      runSummary?.status === "running",
    updateBlueprint: (patch: Partial<ProjectBlueprint>) => updateBlueprintMutation.mutate(patch),
    regenerateBlueprint: () => regenerateBlueprintMutation.mutate(),
    openProjects: () => setActiveSection("projects"),
    openWork: () => setActiveSection("live"),
    refreshSnapshot: () => {
      void queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Mission state refreshed.");
    },
  };
}
