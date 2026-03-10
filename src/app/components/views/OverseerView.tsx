import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  activateRepoV4,
  activateProjectV5,
  connectLocalProjectV5,
  createChatSession,
  createTicket,
  decideApproval,
  getTaskContextV3,
  getWorkflowStateV3,
  listChatSessions,
  listMessages,
  listPendingPolicyV2,
  listRecentCommandsV2,
  listReposV4,
  listTickets,
  materializeContextV3,
  openSessionStream,
  planRouteV3,
  requestExecutionV2,
  searchKnowledgeV2,
  sendMessageWithRole,
} from "../../lib/apiClient";
import { useUiStore } from "../../store/uiStore";
import { Chip, Panel, PanelHeader, cn } from "../UI";
import { Bot, FolderGit2, Plus, SendHorizontal, ShieldAlert, Sparkles } from "lucide-react";
import { formatDistanceToNow } from "date-fns";
import { getRecentRepos } from "../../lib/projectVisibility";
import { pickRepoDirectory, rememberRepoPath } from "../../lib/desktopBridge";

interface StreamEvent {
  type: string;
  payload: Record<string, unknown>;
}

export function OverseerView() {
  const queryClient = useQueryClient();
  const selectedSessionId = useUiStore((state) => state.selectedSessionId);
  const selectedTicketId = useUiStore((state) => state.selectedTicketId);
  const selectedRepoId = useUiStore((state) => state.selectedRepoId);
  const setSelectedRunId = useUiStore((state) => state.setSelectedRunId);
  const setSelectedSessionId = useUiStore((state) => state.setSelectedSessionId);
  const setSelectedRepoId = useUiStore((state) => state.setSelectedRepoId);
  const setSelectedTicketId = useUiStore((state) => state.setSelectedTicketId);
  const setActiveSection = useUiStore((state) => state.setActiveSection);
  const labsMode = useUiStore((state) => state.labsMode);

  const [input, setInput] = useState("");
  const [streamText, setStreamText] = useState("");
  const [streaming, setStreaming] = useState(false);
  const [selectedModelRole, setSelectedModelRole] = useState<"utility_fast" | "coder_default" | "review_deep" | "overseer_escalation">(
    "coder_default"
  );

  const reposQuery = useQuery({
    queryKey: ["repos-v4"],
    queryFn: listReposV4,
    refetchInterval: 15000,
  });

  const recentRepos = useMemo(() => getRecentRepos(reposQuery.data?.items ?? [], labsMode), [reposQuery.data?.items, labsMode]);
  const selectedRepo = useMemo(() => recentRepos.find((repo) => repo.id === selectedRepoId) ?? null, [recentRepos, selectedRepoId]);

  const sessionsQuery = useQuery({
    queryKey: ["chat-sessions", selectedRepoId],
    queryFn: () => listChatSessions(selectedRepoId || undefined),
    enabled: Boolean(selectedRepoId),
    refetchInterval: 10000,
  });

  const messagesQuery = useQuery({
    queryKey: ["chat-messages", selectedSessionId],
    enabled: Boolean(selectedSessionId),
    queryFn: () => listMessages(selectedSessionId as string),
  });

  const ticketsQuery = useQuery({
    queryKey: ["tickets", selectedRepoId],
    queryFn: () => listTickets(selectedRepoId || undefined),
    enabled: Boolean(selectedRepoId),
    refetchInterval: 10000,
  });

  const pendingPolicyQuery = useQuery({
    queryKey: ["policy-pending-v2"],
    queryFn: listPendingPolicyV2,
    refetchInterval: 5000,
  });

  const taskContextQuery = useQuery({
    queryKey: ["task-context-v3", selectedTicketId],
    enabled: Boolean(selectedTicketId),
    queryFn: () => getTaskContextV3(selectedTicketId as string),
    refetchInterval: 7000,
  });

  const workflowStateQuery = useQuery({
    queryKey: ["workflow-state-v3", selectedTicketId],
    enabled: Boolean(selectedTicketId),
    queryFn: () => getWorkflowStateV3(selectedTicketId as string),
    refetchInterval: 7000,
  });

  const commandsQuery = useQuery({
    queryKey: ["commands-v2"],
    queryFn: () => listRecentCommandsV2(80),
    refetchInterval: 5000,
  });

  const createSessionMutation = useMutation({
    mutationFn: () => createChatSession(selectedRepo ? `${selectedRepo.displayName} session` : "New Overseer Session", selectedRepoId || undefined),
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ["chat-sessions", selectedRepoId] });
      setSelectedSessionId(result.item.id);
    },
  });

  useEffect(() => {
    const sessions = sessionsQuery.data?.items || [];
    if (!sessions.length) {
      if (selectedRepoId && !selectedSessionId && !createSessionMutation.isPending && sessionsQuery.isFetched) {
        createSessionMutation.mutate();
      }
      return;
    }
    if (!selectedSessionId || !sessions.some((session) => session.id === selectedSessionId)) {
      setSelectedSessionId(sessions[0].id);
    }
  }, [createSessionMutation, selectedRepoId, selectedSessionId, setSelectedSessionId, sessionsQuery.data?.items, sessionsQuery.isFetched]);

  useEffect(() => {
    const currentSession = (sessionsQuery.data?.items || []).find((session) => session.id === selectedSessionId);
    const preferred =
      typeof currentSession?.metadata?.preferredModelRole === "string"
        ? (currentSession.metadata.preferredModelRole as "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation")
        : null;
    if (preferred) {
      setSelectedModelRole(preferred);
    }
  }, [selectedSessionId, sessionsQuery.data?.items]);

  useEffect(() => {
    if (!selectedSessionId) {
      return;
    }

    let source: EventSource | null = null;
    let cancelled = false;

    void openSessionStream(selectedSessionId).then((eventSource) => {
      if (cancelled) {
        eventSource.close();
        return;
      }

      source = eventSource;

      const handleToken = (evt: MessageEvent) => {
        const parsed = JSON.parse(evt.data) as StreamEvent;
        const token = String(parsed.payload.token || "");
        setStreaming(true);
        setStreamText((current) => current + token);
      };

      const handleDone = () => {
        setStreaming(false);
        queryClient.invalidateQueries({ queryKey: ["chat-messages", selectedSessionId] });
        queryClient.invalidateQueries({ queryKey: ["policy-pending-v2"] });
        queryClient.invalidateQueries({ queryKey: ["commands-v2"] });
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
      if (source) {
        source.close();
      }
    };
  }, [queryClient, selectedSessionId]);

  const sendMutation = useMutation({
    mutationFn: (content: string) => sendMessageWithRole(selectedSessionId as string, content, selectedModelRole),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["chat-messages", selectedSessionId] });
      queryClient.invalidateQueries({ queryKey: ["chat-sessions", selectedRepoId] });
      setInput("");
      setStreamText("");
    },
  });

  const decideApprovalMutation = useMutation({
    mutationFn: ({ id, decision }: { id: string; decision: "approved" | "rejected" }) => decideApproval(id, decision),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["policy-pending-v2"] });
      queryClient.invalidateQueries({ queryKey: ["commands-v2"] });
      queryClient.invalidateQueries({ queryKey: ["providers"] });
    },
  });

  const connectLocalMutation = useMutation({
    mutationFn: async () => {
      const picked = await pickRepoDirectory();
      if (picked.canceled || !picked.path) {
        return null;
      }
      const existing = (reposQuery.data?.items ?? []).find((repo) => repo.sourceKind === "local_path" && repo.sourceUri === picked.path);
      if (existing) {
        await rememberRepoPath(picked.path, existing.displayName);
        const activation = await activateProjectV5({
          actor: "user",
          repo_id: existing.id,
          state: {
            recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
          },
        });
        return {
          result: { repo: existing },
          activation,
        };
      }
      const result = await connectLocalProjectV5({ actor: "user", source_path: picked.path });
      await rememberRepoPath(picked.path, result.repo.displayName);
      const activation = await activateProjectV5({
        actor: "user",
        repo_id: result.repo.id,
        state: {
          recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
        },
      });
      return { result, activation };
    },
    onSuccess: (payload) => {
      if (!payload) {
        return;
      }
      const { result } = payload;
      queryClient.invalidateQueries({ queryKey: ["repos-v4"] });
      setSelectedRepoId(result.repo.id);
      setSelectedTicketId(null);
      setSelectedSessionId(null);
      setActiveSection("overseer");
    },
  });

  const activateRecentRepoMutation = useMutation({
    mutationFn: (repoId: string) =>
      activateRepoV4({
        actor: "user",
        repo_id: repoId,
        state: {
          selectedTicketId,
          recentChatSessionIds: selectedSessionId ? [selectedSessionId] : [],
        },
      }),
    onSuccess: ({ repo }) => {
      setSelectedRepoId(repo.id);
      setSelectedTicketId(null);
      setSelectedSessionId(null);
      setActiveSection("overseer");
      queryClient.invalidateQueries({ queryKey: ["repos-v4"] });
      queryClient.invalidateQueries({ queryKey: ["repos-v4", "active"] });
    },
  });

  async function ensureWorkingTicket() {
    if (selectedTicketId) {
      return selectedTicketId;
    }
    if (!selectedRepoId || !input.trim()) {
      throw new Error("Connect a repo and enter an objective first.");
    }
    const title = input.trim().split("\n")[0].slice(0, 90);
    const ticket = await createTicket({
      repoId: selectedRepoId,
      title,
      description: input.trim(),
      status: "ready",
      acceptanceCriteria: ["Implement the requested change.", "Verify impacted behavior.", "Update docs if behavior changes."],
      risk: "medium",
      priority: "p2",
    });
    setSelectedTicketId(ticket.item.id);
    queryClient.invalidateQueries({ queryKey: ["tickets", selectedRepoId] });
    return ticket.item.id;
  }

  const selectedTicket = useMemo(() => {
    if (!selectedTicketId) {
      return null;
    }
    return ticketsQuery.data?.items.find((ticket) => ticket.id === selectedTicketId) ?? null;
  }, [selectedTicketId, ticketsQuery.data?.items]);

  const latestRoute = taskContextQuery.data?.routing?.[0] ?? null;

  const latestExecutionCommand = useMemo(() => {
    if (!selectedTicketId) {
      return null;
    }

    return (
      commandsQuery.data?.items.find(
        (item) => item.command_type === "execution.request" && item.aggregate_id === selectedTicketId
      ) ?? null
    );
  }, [commandsQuery.data?.items, selectedTicketId]);

  const recentRunIds = useMemo(() => {
    const ids = new Set<string>();
    for (const row of commandsQuery.data?.items ?? []) {
      const runId = typeof row.result?.run_id === "string" ? row.result.run_id : null;
      if (runId) {
        ids.add(runId);
      }
    }
    return Array.from(ids).slice(0, 6);
  }, [commandsQuery.data?.items]);

  const planRouteMutation = useMutation({
    mutationFn: async () => {
      const ticketId = await ensureWorkingTicket();
      const retrievalSearch = await searchKnowledgeV2(input.trim());
      const retrievalIds = retrievalSearch.items.slice(0, 6).map((item) => item.id);

      const route = await planRouteV3({
        actor: "user",
        repo_id: selectedRepoId || undefined,
        ticket_id: ticketId,
        prompt: input.trim(),
        risk_level: selectedTicket?.risk || "medium",
        retrieval_context_ids: retrievalIds,
        active_files: [],
      });

      await materializeContextV3({
        actor: "user",
        repo_id: selectedRepoId || undefined,
        aggregate_id: ticketId,
        aggregate_type: "ticket",
        goal: input.trim(),
        query: input.trim(),
        constraints: selectedTicket?.acceptanceCriteria ?? [],
        active_files: [],
        retrieval_ids: retrievalIds,
        verification_plan:
          route.item.executionMode === "single_agent"
            ? ["lint_changed", "tests_impacted"]
            : ["spawn_lanes", "lint_changed", "tests_impacted", "prepare_merge_report"],
        rollback_plan: ["revert_patchset", "restore_previous_context"],
        policy_scopes: [`provider:${route.item.providerId}`, `role:${route.item.modelRole}`],
      });

      return route.item;
    },
    onSuccess: (route) => {
      setSelectedModelRole(route.modelRole);
      queryClient.invalidateQueries({ queryKey: ["task-context-v3", selectedTicketId] });
      queryClient.invalidateQueries({ queryKey: ["workflow-state-v3", selectedTicketId] });
      queryClient.invalidateQueries({ queryKey: ["commands-v2"] });
      queryClient.invalidateQueries({ queryKey: ["chat-sessions", selectedRepoId] });
      queryClient.invalidateQueries({ queryKey: ["tickets", selectedRepoId] });
    },
  });

  const executePlannedRouteMutation = useMutation({
    mutationFn: async () => {
      const ticketId = await ensureWorkingTicket();
      let route = latestRoute;
      if (!route) {
        route = await planRouteMutation.mutateAsync();
      }

      let retrievalIds = Array.isArray(taskContextQuery.data?.item?.retrievalIds)
        ? taskContextQuery.data?.item?.retrievalIds.filter((item): item is string => Boolean(item))
        : [];

      if (!retrievalIds.length) {
        const metadataIds = Array.isArray(route.metadata?.retrieval_context_ids)
          ? route.metadata?.retrieval_context_ids.filter((item): item is string => typeof item === "string")
          : [];
        retrievalIds = metadataIds;
      }

      if (!retrievalIds.length) {
        const retrievalSearch = await searchKnowledgeV2(input.trim());
        retrievalIds = retrievalSearch.items.slice(0, 6).map((item) => item.id);
      }

      if (!retrievalIds.length) {
        throw new Error("No retrieval sources available for execution. Try a more specific objective.");
      }

      await materializeContextV3({
        actor: "user",
        repo_id: selectedRepoId || undefined,
        aggregate_id: ticketId,
        aggregate_type: "ticket",
        goal: input.trim(),
        query: input.trim(),
        constraints: selectedTicket?.acceptanceCriteria ?? [],
        active_files: [],
        retrieval_ids: retrievalIds,
        verification_plan:
          route.executionMode === "single_agent"
            ? ["lint_changed", "tests_impacted"]
            : ["spawn_lanes", "lint_changed", "tests_impacted", "prepare_merge_report"],
        rollback_plan: ["revert_patchset", "restore_previous_context"],
        policy_scopes: [`provider:${route.providerId}`, `role:${route.modelRole}`],
        metadata: {
          routing_decision_id: route.id,
        },
      });

      return requestExecutionV2({
        ticket_id: ticketId,
        repo_id: selectedRepoId || undefined,
        actor: "user",
        prompt: input.trim(),
        retrieval_context_ids: retrievalIds,
        risk_level: selectedTicket?.risk || route.risk,
        routing_decision_id: route.id,
        model_role: route.modelRole,
        provider_id: route.providerId,
      });
    },
    onSuccess: (result) => {
      setSelectedRunId(result.run_id);
      queryClient.invalidateQueries({ queryKey: ["commands-v2"] });
      queryClient.invalidateQueries({ queryKey: ["workflow-state-v3", selectedTicketId] });
      queryClient.invalidateQueries({ queryKey: ["task-context-v3", selectedTicketId] });
      setActiveSection("runs");
    },
  });

  const messages = messagesQuery.data?.items ?? [];
  const pendingApprovals = pendingPolicyQuery.data?.items ?? [];
  const isEmptyConversation = messages.length === 0 && !streamText;

  const visibleApprovals = useMemo(() => {
    const relevant = pendingApprovals.filter((approval) => {
      const payload = approval.payload || {};
      const payloadTicketId = typeof payload.ticket_id === "string" ? payload.ticket_id : null;
      const payloadRepoId = typeof payload.repo_id === "string" ? payload.repo_id : null;

      if (selectedTicketId && payloadTicketId === selectedTicketId) {
        return true;
      }
      if (selectedRepoId && payloadRepoId === selectedRepoId) {
        return true;
      }
      return approval.action_type === "provider_change";
    });

    const source = relevant.length > 0 ? relevant : pendingApprovals;
    return source.slice(0, 4);
  }, [pendingApprovals, selectedRepoId, selectedTicketId]);

  const starterPrompts = [
    "Add a CSV export to the client list, update the docs, and verify the affected tests.",
    "Review the auth flow in this repo, find the weakest point, and propose the smallest safe fix.",
    "Plan a homepage cleanup, identify the key files, and prepare the execution route.",
  ];

  if (!selectedRepoId || !selectedRepo) {
    return (
      <Panel className="min-h-[780px]">
        <div className="flex min-h-[780px] items-center justify-center p-6">
          <div className="max-w-3xl w-full rounded-[28px] border border-white/10 bg-[radial-gradient(circle_at_top,rgba(8,145,178,0.16),rgba(10,10,12,0.2)_35%,rgba(10,10,12,0.92)_70%)] p-8 md:p-12 text-center shadow-2xl shadow-black/40">
            <div className="inline-flex items-center gap-2 rounded-full border border-cyan-400/20 bg-cyan-400/10 px-3 py-1 text-[11px] uppercase tracking-[0.24em] text-cyan-200">
              <Sparkles className="w-3.5 h-3.5" /> Overseer ready
            </div>
            <div className="text-3xl md:text-4xl text-white font-semibold tracking-tight mt-6">Connect a repo to begin</div>
            <div className="text-sm md:text-base text-zinc-400 mt-3 max-w-2xl mx-auto">
              Plug in your codebase, give the Overseer one objective, review the route, and let the app execute with verification.
            </div>

            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <button
                onClick={() => connectLocalMutation.mutate()}
                disabled={connectLocalMutation.isPending}
                className="inline-flex items-center gap-2 rounded-xl bg-cyan-600 px-5 py-3 text-sm font-medium text-white disabled:opacity-50"
              >
                <FolderGit2 className="w-4 h-4" /> Choose Local Repo
              </button>
              <button
                onClick={() => setActiveSection("projects")}
                className="rounded-xl border border-white/10 bg-white/[0.03] px-5 py-3 text-sm text-zinc-300"
              >
                Connect GitHub Repo
              </button>
            </div>

            <div className="mt-10 text-left max-w-2xl mx-auto">
              <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Recent projects</div>
              <div className="mt-3 grid grid-cols-1 md:grid-cols-2 gap-3">
                {recentRepos.slice(0, 4).map((repo) => (
                  <button
                    key={repo.id}
                    onClick={() => activateRecentRepoMutation.mutate(repo.id)}
                    className="rounded-xl border border-white/10 bg-black/30 p-4 text-left hover:bg-white/[0.04]"
                  >
                    <div className="text-sm text-white font-medium truncate">{repo.displayName}</div>
                    <div className="text-xs text-zinc-500 truncate mt-1">{repo.sourceUri}</div>
                  </button>
                ))}
                {recentRepos.length === 0 ? <div className="text-sm text-zinc-600">No recent repos yet.</div> : null}
              </div>
            </div>
          </div>
        </div>
      </Panel>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-[280px_minmax(0,1fr)_340px] gap-4 min-h-[780px]">
      <Panel className="min-h-[780px]">
        <PanelHeader title="Mission Rail">
          <button
            onClick={() => createSessionMutation.mutate()}
            className="p-1.5 rounded-md bg-white/[0.04] hover:bg-white/[0.08] text-zinc-300 border border-white/10"
            title="New session"
          >
            <Plus className="w-3.5 h-3.5" />
          </button>
        </PanelHeader>
        <div className="p-3 space-y-4 overflow-y-auto custom-scrollbar">
          <div className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3">
            <div className="text-[11px] uppercase tracking-[0.24em] text-cyan-200/80">Active project</div>
            <div className="text-sm text-white font-medium mt-2 truncate">{selectedRepo.displayName}</div>
            <div className="text-[11px] text-cyan-100/60 mt-1 truncate">{selectedRepo.branch || selectedRepo.defaultBranch}</div>
            <button
              onClick={() => setActiveSection("projects")}
              className="mt-3 rounded-lg border border-cyan-400/20 bg-black/20 px-3 py-1.5 text-[11px] text-cyan-100/80"
            >
              Switch project
            </button>
          </div>

          <section>
            <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 mb-2">Recent objectives</div>
            <div className="space-y-2">
              {sessionsQuery.data?.items.map((session) => (
                <button
                  key={session.id}
                  onClick={() => setSelectedSessionId(session.id)}
                  className={`w-full text-left rounded-xl p-3 border transition-colors ${
                    session.id === selectedSessionId
                      ? "bg-cyan-500/10 border-cyan-500/30"
                      : "bg-zinc-900/40 border-white/5 hover:border-white/15"
                  }`}
                >
                  <div className="text-xs text-zinc-100 truncate">{session.title}</div>
                  <div className="text-[10px] text-zinc-500 mt-1">
                    {formatDistanceToNow(new Date(session.updatedAt), { addSuffix: true })}
                  </div>
                </button>
              ))}
            </div>
          </section>

          <section>
            <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500 mb-2">Recent runs</div>
            <div className="space-y-2">
              {recentRunIds.map((runId) => (
                <button
                  key={runId}
                  onClick={() => {
                    setSelectedRunId(runId);
                    setActiveSection("runs");
                  }}
                  className="w-full rounded-xl border border-white/8 bg-zinc-950/70 px-3 py-2 text-left hover:bg-white/[0.04]"
                >
                  <div className="text-xs text-zinc-200 truncate">{runId}</div>
                </button>
              ))}
              {recentRunIds.length === 0 ? <div className="text-xs text-zinc-600">No runs yet.</div> : null}
            </div>
          </section>
        </div>
      </Panel>

      <Panel className="min-h-[780px]">
        <PanelHeader title="Overseer Mission">
          <div className="flex items-center gap-2">
            <Chip variant="subtle" className="text-[10px]">{streaming ? "streaming" : "ready"}</Chip>
            <Chip variant="subtle" className="text-[10px]">{selectedModelRole}</Chip>
          </div>
        </PanelHeader>

        <div className="flex-1 min-h-0 flex flex-col">
          <div className="px-4 pt-4">
            <div className="rounded-2xl border border-white/10 bg-[linear-gradient(180deg,rgba(255,255,255,0.04),rgba(255,255,255,0.01))] p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Current objective</div>
                  <div className="text-xl text-white font-semibold tracking-tight mt-2">
                    {selectedTicket?.title || "State the change you want this repo to make"}
                  </div>
                  <div className="text-sm text-zinc-500 mt-2 max-w-2xl">
                    Ask for a change in plain language. The app will build context, plan a route, and execute with verification.
                  </div>
                </div>
                <div className="flex flex-wrap gap-2 shrink-0">
                  {latestRoute ? <Chip variant="warn">{latestRoute.executionMode.replaceAll("_", " ")}</Chip> : null}
                  {latestRoute ? <Chip variant="subtle">{latestRoute.providerId}</Chip> : null}
                </div>
              </div>
            </div>
          </div>

          <div
            className={cn(
              "p-4",
              isEmptyConversation ? "space-y-4 pt-3" : "flex-1 overflow-y-auto custom-scrollbar space-y-3"
            )}
          >
            {isEmptyConversation ? (
              <>
                <div className="grid grid-cols-1 xl:grid-cols-[minmax(0,1fr)_280px] gap-4">
                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Ready state</div>
                    <div className="mt-3 text-base text-white font-medium">Tell the Overseer what you want changed.</div>
                    <div className="mt-2 text-sm text-zinc-500 max-w-2xl">
                      It will build a context pack first, choose the right route, and only then execute with verification.
                    </div>
                    <div className="mt-4 grid grid-cols-1 gap-2">
                      {starterPrompts.map((prompt) => (
                        <button
                          key={prompt}
                          onClick={() => setInput(prompt)}
                          className="rounded-xl border border-white/10 bg-zinc-950/60 px-4 py-3 text-left hover:bg-white/[0.04]"
                        >
                          <div className="text-sm text-zinc-100">{prompt}</div>
                        </button>
                      ))}
                    </div>
                  </div>

                  <div className="rounded-2xl border border-white/10 bg-white/[0.02] p-4">
                    <div className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Mission snapshot</div>
                    <div className="mt-4 space-y-3">
                      <div className="rounded-xl border border-white/8 bg-zinc-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Project</div>
                        <div className="mt-1 text-sm text-zinc-100">{selectedRepo.displayName}</div>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-zinc-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Route</div>
                        <div className="mt-1 text-sm text-zinc-100">{latestRoute ? latestRoute.executionMode.replaceAll("_", " ") : "Will be planned from your objective"}</div>
                      </div>
                      <div className="rounded-xl border border-white/8 bg-zinc-950/60 p-3">
                        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Verification</div>
                        <div className="mt-1 text-sm text-zinc-100">Docs, tests, and context provenance are checked before a run is considered complete.</div>
                      </div>
                    </div>
                  </div>
                </div>
              </>
            ) : (
              <>
                {messages.map((message) => (
                  <article
                    key={message.id}
                    className={`max-w-[84%] rounded-2xl px-4 py-3 border text-sm leading-relaxed ${
                      message.role === "user"
                        ? "ml-auto bg-cyan-500/12 border-cyan-500/25 text-zinc-100"
                        : message.role === "assistant"
                        ? "mr-auto bg-zinc-900/60 border-white/10 text-zinc-200"
                        : "mr-auto bg-zinc-800/40 border-zinc-700 text-zinc-400"
                    }`}
                  >
                    <div className="text-[10px] uppercase tracking-wide mb-1 opacity-70">{message.role}</div>
                    <div className="whitespace-pre-wrap">{message.content}</div>
                  </article>
                ))}

                {streamText && (
                  <article className="mr-auto max-w-[84%] rounded-2xl px-4 py-3 border text-sm leading-relaxed bg-zinc-900/60 border-cyan-500/30 text-zinc-200">
                    <div className="text-[10px] uppercase tracking-wide mb-1 opacity-70 flex items-center gap-1">
                      <Bot className="w-3 h-3" /> assistant
                    </div>
                    <div className="whitespace-pre-wrap">{streamText}</div>
                  </article>
                )}
              </>
            )}
          </div>

          <div className="border-t border-white/10 p-4 space-y-3">
            <div className="flex items-center gap-2 text-[11px] text-zinc-500 uppercase tracking-[0.24em]">
              <span>Mode</span>
              <select
                value={selectedModelRole}
                onChange={(event) =>
                  setSelectedModelRole(
                    event.target.value as "utility_fast" | "coder_default" | "review_deep" | "overseer_escalation"
                  )
                }
                className="ml-auto h-9 bg-zinc-900 border border-white/10 rounded-lg px-3 text-xs text-zinc-200"
              >
                <option value="utility_fast">utility_fast</option>
                <option value="coder_default">coder_default</option>
                <option value="review_deep">review_deep</option>
                <option value="overseer_escalation">overseer_escalation</option>
              </select>
            </div>
            <textarea
              className="w-full bg-zinc-900 border border-white/10 rounded-2xl p-4 text-sm text-zinc-200 resize-none min-h-[110px] focus:outline-none focus:border-cyan-500/40"
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="Describe what you want changed in this repo. Example: add a CSV export to the client list and verify the tests."
            />
            <div className="flex flex-wrap justify-between gap-2">
              <div className="text-xs text-zinc-500">Ticket context is created automatically the first time you plan or execute.</div>
              <div className="flex flex-wrap gap-2">
                <button
                  onClick={() => {
                    if (!input.trim()) {
                      return;
                    }
                    planRouteMutation.mutate();
                  }}
                  className="h-10 px-4 rounded-xl bg-white/[0.04] hover:bg-white/[0.08] text-zinc-200 text-xs font-medium disabled:opacity-40"
                  disabled={!input.trim() || planRouteMutation.isPending}
                >
                  Review route
                </button>
                <button
                  onClick={() => {
                    if (!input.trim()) {
                      return;
                    }
                    executePlannedRouteMutation.mutate();
                  }}
                  className="h-10 px-4 rounded-xl bg-cyan-600 hover:bg-cyan-500 text-white text-xs font-medium disabled:opacity-40"
                  disabled={!input.trim() || executePlannedRouteMutation.isPending}
                >
                  Execute
                </button>
                <button
                  onClick={() => {
                    if (!selectedSessionId || !input.trim()) {
                      return;
                    }
                    sendMutation.mutate(input.trim());
                  }}
                  className="h-10 px-4 rounded-xl bg-violet-600 hover:bg-violet-500 text-white text-xs font-medium disabled:opacity-40"
                  disabled={!selectedSessionId || !input.trim() || sendMutation.isPending}
                >
                  <SendHorizontal className="w-4 h-4" />
                </button>
              </div>
            </div>
          </div>
        </div>
      </Panel>

      <Panel className="min-h-[780px]">
        <PanelHeader title="Mission Context">
          <Chip variant="warn" className="text-[10px]">{pendingApprovals.length} pending</Chip>
        </PanelHeader>

        <div className="p-3 space-y-4 overflow-y-auto custom-scrollbar">
          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Route</h3>
            {latestRoute ? (
              <article className="rounded-xl border border-cyan-500/20 bg-cyan-500/10 p-3">
                <div className="text-sm text-cyan-100">{latestRoute.executionMode.replaceAll("_", " ")}</div>
                <div className="text-[11px] text-cyan-100/70 mt-1">{latestRoute.providerId} · {latestRoute.modelRole}</div>
                <div className="text-[11px] text-cyan-100/60 mt-1">verification {latestRoute.verificationDepth} · overlap {(latestRoute.estimatedFileOverlap * 100).toFixed(0)}%</div>
              </article>
            ) : (
              <div className="text-xs text-zinc-600">No route planned yet.</div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Working ticket</h3>
            {selectedTicket ? (
              <article className="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
                <div className="text-sm text-zinc-100 font-medium">{selectedTicket.title}</div>
                <div className="text-[11px] text-zinc-500 mt-1 whitespace-pre-wrap">{selectedTicket.description}</div>
                <div className="flex gap-2 mt-3">
                  <Chip variant="subtle">{selectedTicket.status.replace("_", " ")}</Chip>
                  <Chip variant="subtle">{selectedTicket.priority}</Chip>
                </div>
              </article>
            ) : (
              <div className="text-xs text-zinc-600">A working ticket will be created automatically when you plan or execute.</div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Context pack</h3>
            {taskContextQuery.data?.item ? (
              <article className="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
                <div className="text-sm text-zinc-100">{taskContextQuery.data.item.goal}</div>
                <div className="text-[11px] text-zinc-500 mt-1">{taskContextQuery.data.item.retrievalIds.length} retrieval sources · version {taskContextQuery.data.item.version}</div>
              </article>
            ) : (
              <div className="text-xs text-zinc-600">No context pack materialized yet.</div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Execution</h3>
            {latestExecutionCommand ? (
              <article className="rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3">
                <div className="text-sm text-emerald-100">{String(latestExecutionCommand.result?.status ?? latestExecutionCommand.status)}</div>
                <div className="text-[11px] text-emerald-100/70 mt-1">
                  {String(latestExecutionCommand.result?.provider_id ?? "n/a")} · {String(latestExecutionCommand.result?.model_role ?? "n/a")}
                </div>
                <div className="text-[11px] text-emerald-100/60 mt-1">run {String(latestExecutionCommand.result?.run_id ?? "n/a")}</div>
              </article>
            ) : (
              <div className="text-xs text-zinc-600">No execution requested yet.</div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Workflow</h3>
            {workflowStateQuery.data?.item ? (
              <article className="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
                <div className="text-sm text-zinc-100">{workflowStateQuery.data.item.phase} · {workflowStateQuery.data.item.status}</div>
                <div className="text-[11px] text-zinc-500 mt-1">{workflowStateQuery.data.item.summary}</div>
              </article>
            ) : (
              <div className="text-xs text-zinc-600">No workflow state recorded yet.</div>
            )}
          </section>

          <section className="space-y-2">
            <h3 className="text-[11px] uppercase tracking-[0.24em] text-zinc-500">Approvals</h3>
            {visibleApprovals.map((approval) => (
              <article key={approval.approval_id} className="rounded-xl border border-white/10 bg-zinc-900/40 p-3">
                <div className="flex justify-between gap-2">
                  <div className="text-xs text-zinc-200">{approval.action_type}</div>
                  <Chip variant="warn" className="text-[9px]">pending</Chip>
                </div>
                <div className="text-[10px] text-zinc-500 mt-1">{formatDistanceToNow(new Date(approval.requested_at), { addSuffix: true })}</div>
                <div className="mt-3 flex gap-2">
                  <button
                    onClick={() => decideApprovalMutation.mutate({ id: approval.approval_id, decision: "approved" })}
                    className="px-3 py-1.5 rounded-lg bg-emerald-600/30 border border-emerald-500/40 text-[10px] text-emerald-300"
                  >
                    Approve
                  </button>
                  <button
                    onClick={() => decideApprovalMutation.mutate({ id: approval.approval_id, decision: "rejected" })}
                    className="px-3 py-1.5 rounded-lg bg-rose-600/20 border border-rose-500/40 text-[10px] text-rose-300"
                  >
                    Reject
                  </button>
                </div>
              </article>
            ))}
            {pendingApprovals.length === 0 ? (
              <div className="text-xs text-zinc-600 flex items-center gap-2">
                <ShieldAlert className="w-3.5 h-3.5" /> No approvals required.
              </div>
            ) : null}
            {pendingApprovals.length > visibleApprovals.length ? (
              <div className="text-[11px] text-zinc-500">
                Showing {visibleApprovals.length} of {pendingApprovals.length} pending approvals.
              </div>
            ) : null}
          </section>
        </div>
      </Panel>
    </div>
  );
}
