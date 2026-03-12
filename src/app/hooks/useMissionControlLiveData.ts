import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateProjectV5,
  addTicketComment,
  bootstrapEmptyProjectV8,
  connectGithubProjectV8,
  connectLocalProjectV8,
  decideMissionApprovalV8,
  executeScaffoldV8,
  generateProjectBlueprintV8,
  getMissionSnapshotV8,
  openRecentProjectV8,
  openSessionStream,
  reviewOverseerRouteV8,
  sendOverseerMessageV8,
  syncProjectV5,
  updateProjectBlueprintV8,
  executeOverseerRouteV8,
  moveMissionWorkflowV8,
} from "../lib/apiClient";
import { getRecentRepos, getVisibleRepos } from "../lib/projectVisibility";
import { hasDesktopRepoPicker, listRecentRepoPaths, pickRepoDirectory, rememberRepoPath } from "../lib/desktopBridge";
import { useUiStore } from "../store/uiStore";
import type {
  ChatMessageDto,
  ContextPack,
  ModelRole,
  MissionControlSnapshot,
  ProjectBlueprint,
  RepoRegistration,
  RoutingDecision,
} from "../../shared/contracts";
import type {
  CodebaseFile,
  ConsoleLog,
  MissionChangeBrief,
  MissionRunPhase,
  MissionStream,
  MissionTaskCard,
  MissionTimelineEvent,
  TaskSpotlight,
} from "../data/mockData";

const ROLE_LABELS: Record<ModelRole, string> = {
  utility_fast: "Fast",
  coder_default: "Build",
  review_deep: "Review",
  overseer_escalation: "Escalate",
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
  const [selectedModelRole, setSelectedModelRole] = useState<ModelRole>("coder_default");
  const [routePreview, setRoutePreview] = useState<RoutingDecision | null>(null);
  const [contextPackPreview, setContextPackPreview] = useState<ContextPack | null>(null);
  const [blueprintPreview, setBlueprintPreview] = useState<ProjectBlueprint | null>(null);
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const [repoPickerMessage, setRepoPickerMessage] = useState<string | null>(null);
  const [githubOwner, setGithubOwner] = useState("");
  const [githubRepo, setGithubRepo] = useState("");
  const [newProjectTemplate, setNewProjectTemplate] = useState<"typescript_vite_react">("typescript_vite_react");
  const [pendingBootstrap, setPendingBootstrap] = useState<{
    folderPath: string;
    suggestedTemplate: "typescript_vite_react";
    displayName?: string;
  } | null>(null);

  const recentPathsQuery = useQuery({
    queryKey: ["desktop-recent-repos"],
    queryFn: listRecentRepoPaths,
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
  const visibleRepos = useMemo(() => getVisibleRepos(snapshot?.recentProjects ?? [], labsMode), [snapshot?.recentProjects, labsMode]);
  const recentRepos = useMemo(() => getRecentRepos(snapshot?.recentProjects ?? [], labsMode, 8), [snapshot?.recentProjects, labsMode]);
  const selectedRepo = useMemo(
    () => (snapshot?.project ? visibleRepos.find((repo) => repo.id === snapshot.project?.id) ?? snapshot.project : recentRepos[0] ?? null),
    [snapshot?.project, visibleRepos, recentRepos]
  );

  useEffect(() => {
    if (selectedRepo?.id && selectedRepo?.id !== selectedRepoId) {
      setSelectedRepoId(selectedRepo.id);
    }
  }, [selectedRepo?.id, selectedRepoId, setSelectedRepoId]);

  useEffect(() => {
    if (snapshot?.selectedTicket?.id && snapshot.selectedTicket.id !== selectedTicketId) {
      setSelectedTicketId(snapshot.selectedTicket.id);
    }
  }, [selectedTicketId, setSelectedTicketId, snapshot?.selectedTicket?.id]);

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
    const resolvedSessionId = snapshot?.overseer.selectedSessionId;
    if (!resolvedSessionId) {
      return;
    }

    let source: EventSource | null = null;
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
        setPendingBootstrap({
          folderPath: result.folderPath,
          suggestedTemplate: result.suggestedTemplate,
        });
        setRepoPickerMessage(null);
        setActionMessage("Empty folder detected. Initialize a new TypeScript project to continue.");
        setActiveSection("live");
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
      setPendingBootstrap(null);
      setRepoPickerMessage(null);
      setActionMessage("Repo connected.");
      setActiveSection("live");
    },
  });

  const bootstrapProjectMutation = useMutation({
    mutationFn: async ({ folderPath, displayName, template }: { folderPath: string; displayName?: string; template?: "typescript_vite_react" }) => {
      const bootstrap = await bootstrapEmptyProjectV8({
        actor: "user",
        folderPath,
        displayName,
        template: template || "typescript_vite_react",
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

      const scaffold = await executeScaffoldV8(bootstrap.repo.id, {
        actor: "user",
        template: template || "typescript_vite_react",
        objective: "Scaffold a TypeScript app with tests and documentation.",
      });

      return {
        bootstrap,
        scaffold,
      };
    },
    onSuccess: ({ bootstrap, scaffold }) => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      queryClient.invalidateQueries({ queryKey: ["desktop-recent-repos"] });
      setSelectedRepoId(bootstrap.repo.id);
      setSelectedTicketId(null);
      setSelectedSessionId(null);
      setSelectedRunId(scaffold.result.runId);
      setRoutePreview(null);
      setContextPackPreview(null);
      setBlueprintPreview(scaffold.blueprint || bootstrap.blueprint);
      setPendingBootstrap(null);
      setRepoPickerMessage(null);
      setActionMessage(scaffold.result.status === "completed" ? "TypeScript project scaffolded and verified." : "Project scaffolded. Review the verification follow-up.");
      setActiveSection("live");
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
      setActiveSection("live");
    },
  });

  const syncProjectMutation = useMutation({
    mutationFn: (repoId: string) => syncProjectV5({ actor: "user", repo_id: repoId }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Project synced.");
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
      return reviewOverseerRouteV8({
        actor: "user",
        project_id: selectedRepo.id,
        ticket_id: selectedTicketId || undefined,
        prompt: objective,
        risk_level: snapshot?.selectedTicket?.risk || "medium",
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
      return executeOverseerRouteV8({
        actor: "user",
        project_id: selectedRepo.id,
        ticket_id: selectedTicketId || undefined,
        prompt: objective,
        model_role: selectedModelRole,
      });
    },
    onMutate: () => {
      setActionMessage("Starting work: moving ticket to In Progress...");
    },
    onSuccess: (result) => {
      setSelectedTicketId(result.ticket.id);
      setSelectedRunId(result.runId);
      setRoutePreview(result.route);
      if (result.blueprint) {
        setBlueprintPreview(result.blueprint);
      }
      if (result.lifecycle?.completed) {
        setActionMessage(
          `Execution and auto-review completed (${result.lifecycle.roundsRun}/${result.lifecycle.maxRounds} review rounds). Ticket moved to Completed.`
        );
      } else if (result.verification?.pass) {
        setActionMessage("Execution verified. Ticket moved through review.");
      } else if (result.lifecycle?.roundsRun) {
        setActionMessage(
          `Execution needs follow-up after ${result.lifecycle.roundsRun} auto-review rounds. Ticket moved back to In Progress.`
        );
      } else {
        setActionMessage("Execution finished. Ticket remains in progress for follow-up.");
      }
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
    },
    onError: (error) => {
      if (error instanceof Error) {
        setActionMessage(`Execution failed: ${error.message}`);
        return;
      }
      setActionMessage("Execution failed.");
    },
  });

  const sendMutation = useMutation({
    mutationFn: async (content: string) =>
      sendOverseerMessageV8({
        actor: "user",
        project_id: selectedRepo?.id,
        session_id: snapshot?.overseer.selectedSessionId || undefined,
        content,
        model_role: selectedModelRole,
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
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Approval updated.");
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

  const updateBlueprintMutation = useMutation({
    mutationFn: (patch: Partial<ProjectBlueprint>) => {
      if (!selectedRepo?.id) {
        throw new Error("Choose a repo first.");
      }
      return updateProjectBlueprintV8(selectedRepo.id, patch);
    },
    onSuccess: ({ item }) => {
      setBlueprintPreview(item);
      queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Project blueprint updated.");
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
      setActionMessage("Blueprint regenerated from repo guidance.");
    },
  });

  async function chooseLocalRepo() {
    if (!hasDesktopRepoPicker()) {
      setRepoPickerMessage("Repo picker is available in the desktop app. Open the Electron window or use the Projects screen advanced path fallback.");
      return;
    }
    const picked = await pickRepoDirectory();
    if (picked.canceled || !picked.path) {
      return;
    }
    connectLocalMutation.mutate({ sourcePath: picked.path });
  }

  async function startNewProject() {
    if (!hasDesktopRepoPicker()) {
      setRepoPickerMessage("New Project uses the desktop folder picker. Open the Electron window to choose a target folder.");
      return;
    }
    const picked = await pickRepoDirectory();
    if (picked.canceled || !picked.path) {
      return;
    }
    bootstrapProjectMutation.mutate({
      folderPath: picked.path,
      template: newProjectTemplate,
    });
  }

  const effectiveRoute = routePreview || snapshot?.route || null;
  const effectiveContextPack = contextPackPreview || snapshot?.contextPack || null;
  const pendingApprovals = (snapshot?.approvals ?? []).map(toPendingApproval);
  const runSummary = snapshot?.runSummary || null;
  const verification = snapshot?.verification || null;
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
    streaming,
    selectedModelRole,
    setSelectedModelRole,
    roleLabels: ROLE_LABELS,
    route: effectiveRoute,
    contextPack: effectiveContextPack,
    blueprint: blueprintPreview,
    workflowPillars: snapshot?.workflowPillars ?? [],
    workflowCards: snapshot?.workflowCards ?? [],
    changeBriefs: (snapshot?.changeBriefs ?? []) as MissionChangeBrief[],
    streams: (snapshot?.streams ?? []) as MissionStream[],
    timeline: (snapshot?.timeline ?? []) as MissionTimelineEvent[],
    tasks: (snapshot?.tasks ?? []) as MissionTaskCard[],
    spotlight: (snapshot?.spotlight ?? null) as TaskSpotlight | null,
    codebaseFiles: (snapshot?.codebaseFiles ?? []) as CodebaseFile[],
    consoleLogs: (snapshot?.consoleLogs ?? []) as ConsoleLog[],
    consoleEvents: (snapshot?.consoleEvents ?? []) as import("../../shared/contracts").ConsoleEvent[],
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
    hasDesktopPicker: hasDesktopRepoPicker(),
    hasAnyProjects: recentRepos.length > 0,
    newProjectTemplate,
    setNewProjectTemplate,
    isActing:
      sendMutation.isPending ||
      reviewRouteMutation.isPending ||
      executeMutation.isPending ||
      connectLocalMutation.isPending ||
      bootstrapProjectMutation.isPending ||
      connectGithubMutation.isPending ||
      activateRepoMutation.isPending ||
      syncProjectMutation.isPending ||
      updateBlueprintMutation.isPending ||
      regenerateBlueprintMutation.isPending ||
      moveWorkflowMutation.isPending ||
      addTaskCommentMutation.isPending,
    chooseLocalRepo,
    startNewProject,
    pendingBootstrap,
    initializeNewProject: () => {
      if (!pendingBootstrap) return;
      bootstrapProjectMutation.mutate({
        folderPath: pendingBootstrap.folderPath,
        displayName: pendingBootstrap.displayName,
        template: pendingBootstrap.suggestedTemplate,
      });
    },
    connectRecentPath: (path: string, label?: string) =>
      openRecentProjectV8({ actor: "user", source_path: path, display_name: label }).then((result) => {
        if ("bootstrapRequired" in result && result.bootstrapRequired) {
          setPendingBootstrap({
            folderPath: result.folderPath,
            suggestedTemplate: result.suggestedTemplate,
            displayName: label,
          });
          setActionMessage("This folder is empty. Initialize a new TypeScript project to continue.");
          setActiveSection("live");
          return;
        }

        const { repo, blueprint } = result;
        void rememberRepoPath(path, label || repo.displayName);
        setSelectedRepoId(repo.id);
        setSelectedTicketId(null);
        setSelectedSessionId(null);
        setSelectedRunId(null);
        setRoutePreview(null);
        setContextPackPreview(null);
        setBlueprintPreview(blueprint ?? null);
        setPendingBootstrap(null);
        queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
        setActiveSection("live");
      }),
    connectGithubProject: () => connectGithubMutation.mutate(),
    activateRepo: (repoId: string) => activateRepoMutation.mutate(repoId),
    syncProject: (repoId: string) => syncProjectMutation.mutate(repoId),
    setSelectedTicketId,
    setSelectedSessionId,
    reviewRoute: () => reviewRouteMutation.mutate(),
    executeRoute: () => executeMutation.mutate(),
    sendMessage: () => {
      if (!input.trim()) return;
      sendMutation.mutate(input.trim());
    },
    decideApproval: (id: string, decision: "approved" | "rejected") => approvalMutation.mutate({ id, decision }),
    moveWorkflow: (input: import("../../shared/contracts").WorkflowMoveRequest) => moveWorkflowMutation.mutate(input),
    addTaskComment: (taskId: string, body: string, parentCommentId?: string | null) =>
      addTaskCommentMutation.mutate({ taskId, body, parentCommentId }),
    isCommenting: addTaskCommentMutation.isPending,
    isReviewing: reviewRouteMutation.isPending,
    isExecuting: executeMutation.isPending,
    updateBlueprint: (patch: Partial<ProjectBlueprint>) => updateBlueprintMutation.mutate(patch),
    regenerateBlueprint: () => regenerateBlueprintMutation.mutate(),
    openProjects: () => setActiveSection("projects"),
    refreshSnapshot: () => {
      void queryClient.invalidateQueries({ queryKey: ["mission-snapshot-v8"] });
      setActionMessage("Mission state refreshed.");
    },
  };
}
