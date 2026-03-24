import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { format } from "date-fns";
import { ChevronDown, ChevronRight, Filter } from "lucide-react";
import type { ConsoleEvent } from "../../../shared/contracts";
import type { ApiEventStream } from "../../lib/apiClient";
import { getMissionConsoleV8, openMissionConsoleStreamV8, requestDependencyBootstrapV9 } from "../../lib/apiClient";
import { modelRoleLabel, providerLabel } from "../../lib/missionLabels";
import { ProcessingIndicator } from "../ui/processing-indicator";
import { cn } from "../ui/utils";

const LEVEL_STYLES: Record<ConsoleEvent["level"], { color: string; badge: string; label: string }> = {
  info: { color: "text-zinc-400", badge: "bg-zinc-800 text-zinc-400 border-zinc-700", label: "INFO" },
  warn: { color: "text-amber-400", badge: "bg-amber-500/10 text-amber-400 border-amber-500/20", label: "WARN" },
  error: { color: "text-rose-400", badge: "bg-rose-500/10 text-rose-400 border-rose-500/20", label: "ERR" },
};

const CATEGORY_LABELS: Record<string, string> = {
  all: "All",
  execution: "Execution",
  verification: "Verification",
  provider: "Providers",
  approval: "Approvals",
  indexing: "Indexing",
  automation: "Automation",
};

const CATEGORY_STYLES: Record<
  ConsoleEvent["category"],
  { badge: string; rail: string; message: string; dot: string; panel: string }
> = {
  execution: {
    badge: "border-cyan-500/20 bg-cyan-500/10 text-cyan-200",
    rail: "bg-cyan-400/70",
    message: "text-cyan-50/95",
    dot: "bg-cyan-400",
    panel: "from-cyan-500/8",
  },
  verification: {
    badge: "border-violet-500/20 bg-violet-500/10 text-violet-200",
    rail: "bg-violet-400/70",
    message: "text-violet-50/95",
    dot: "bg-violet-400",
    panel: "from-violet-500/8",
  },
  provider: {
    badge: "border-fuchsia-500/20 bg-fuchsia-500/10 text-fuchsia-200",
    rail: "bg-fuchsia-400/70",
    message: "text-fuchsia-50/95",
    dot: "bg-fuchsia-400",
    panel: "from-fuchsia-500/8",
  },
  approval: {
    badge: "border-amber-500/20 bg-amber-500/10 text-amber-200",
    rail: "bg-amber-400/70",
    message: "text-amber-50/95",
    dot: "bg-amber-400",
    panel: "from-amber-500/8",
  },
  indexing: {
    badge: "border-emerald-500/20 bg-emerald-500/10 text-emerald-200",
    rail: "bg-emerald-400/70",
    message: "text-emerald-50/95",
    dot: "bg-emerald-400",
    panel: "from-emerald-500/8",
  },
  automation: {
    badge: "border-sky-500/20 bg-sky-500/10 text-sky-200",
    rail: "bg-sky-400/70",
    message: "text-sky-50/95",
    dot: "bg-sky-400",
    panel: "from-sky-500/8",
  },
};

type WorkflowLog = {
  id: string;
  timestamp: string;
  message: string;
  level?: "info" | "warn" | "error" | "success" | "debug";
  source?: string;
  taskId?: string;
};

type StructuredConsolePayload = {
  headline: string;
  payload: Record<string, unknown>;
};

function tryParseStructuredPayload(message: string): StructuredConsolePayload | null {
  const trimmed = message.trim();
  const braceIndex = trimmed.indexOf("{");
  if (braceIndex <= 0 || !trimmed.endsWith("}")) {
    return null;
  }

  const headline = trimmed.slice(0, braceIndex).trim();
  const payloadText = trimmed.slice(braceIndex);
  try {
    const payload = JSON.parse(payloadText);
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      return null;
    }
    return {
      headline,
      payload: payload as Record<string, unknown>,
    };
  } catch {
    return null;
  }
}

function formatPayloadValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (Array.isArray(value)) return `${value.length} items`;
  if (typeof value === "object") return `${Object.keys(value as Record<string, unknown>).length} fields`;
  if (typeof value === "number") return Number.isInteger(value) ? String(value) : value.toFixed(2);
  return String(value);
}

function summarizeStructuredPayload(payload: Record<string, unknown>) {
  const summaryKeys = [
    "execution_profile_name",
    "execution_mode",
    "provider_id",
    "model_role",
    "verification_depth",
    "aggregate_type",
    "max_lanes",
    "repo_id",
    "run_id",
  ];

  return summaryKeys
    .filter((key) => payload[key] !== undefined && payload[key] !== null && payload[key] !== "")
    .slice(0, 4)
    .map((key) => ({
      key,
      label: key.replace(/_/g, " "),
      value: formatPayloadValue(payload[key]),
    }));
}

function executionProfileSummary(payload: Record<string, unknown>) {
  const raw = payload.execution_profile_snapshot;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return null;
  }

  const record = raw as Record<string, unknown>;
  if (typeof record.profileName !== "string" || !Array.isArray(record.stages)) {
    return null;
  }

  const stages = record.stages
    .map((item) => {
      if (!item || typeof item !== "object" || Array.isArray(item)) {
        return null;
      }
      const stage = item as Record<string, unknown>;
      if (
        typeof stage.stage !== "string" ||
        typeof stage.role !== "string" ||
        typeof stage.providerId !== "string" ||
        typeof stage.model !== "string"
      ) {
        return null;
      }
      return {
        stage: stage.stage,
        role: stage.role,
        providerId: stage.providerId,
        model: stage.model,
      };
    })
    .filter(Boolean) as Array<{
    stage: string;
    role: string;
    providerId: string;
    model: string;
  }>;

  if (!stages.length) {
    return null;
  }

  return {
    profileName: record.profileName,
    stages,
  };
}

function executionStageLabel(stage: string) {
  switch (stage) {
    case "scope":
      return "Scope";
    case "build":
      return "Build";
    case "review":
      return "Review";
    case "escalate":
      return "Escalate";
    default:
      return stage;
  }
}

function detailEntries(payload: Record<string, unknown>) {
  return Object.entries(payload)
    .filter(([key]) => key !== "execution_profile_snapshot")
    .map(([key, value]) => ({
      key,
      label: key.replace(/_/g, " "),
      value:
        Array.isArray(value)
          ? value.map((item) => (typeof item === "string" ? item : JSON.stringify(item)))
        : typeof value === "object" && value !== null
        ? JSON.stringify(value, null, 2)
        : String(value ?? "—"),
      multiline: Array.isArray(value) || (typeof value === "object" && value !== null),
    }));
}

function payloadString(payload: Record<string, unknown>, key: string) {
  const value = payload[key];
  return typeof value === "string" && value.trim() ? value : null;
}

export function ConsoleView({
  projectId,
  snapshotEvents,
  workflowId,
  workflowTitle,
  workflowLogs = [],
}: {
  projectId: string | null;
  snapshotEvents?: ConsoleEvent[];
  workflowId?: string | null;
  workflowTitle?: string | null;
  workflowLogs?: WorkflowLog[];
}) {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<"all" | ConsoleEvent["category"]>("all");
  const [followTail, setFollowTail] = useState(true);
  const [scope, setScope] = useState<"workflow" | "project">("project");
  const [liveEvents, setLiveEvents] = useState<ConsoleEvent[]>([]);
  const [expandedDetails, setExpandedDetails] = useState<Record<string, boolean>>({});
  const [actionMessage, setActionMessage] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const query = useQuery({
    queryKey: ["mission-console-v8", projectId],
    queryFn: () => getMissionConsoleV8(projectId!),
    enabled: Boolean(projectId) && !snapshotEvents?.length,
    staleTime: 3000,
  });

  const toolInvokeMutation = useMutation({
    mutationFn: requestDependencyBootstrapV9,
    onSuccess: (response) => {
      const decision = response.item.event.policyDecision;
      if (decision === "approval_required") {
        setActionMessage("Dependency bootstrap requires approval before it can run.");
      } else if (decision === "denied") {
        setActionMessage("Dependency bootstrap was denied by ticket policy.");
      } else {
        setActionMessage("Dependency bootstrap command queued.");
      }
      queryClient.invalidateQueries({ queryKey: ["mission-console-v8"] });
    },
    onError: (error) => {
      setActionMessage(error instanceof Error ? error.message : "Failed to queue dependency bootstrap.");
    },
  });

  useEffect(() => {
    setLiveEvents([]);
    setExpandedDetails({});
    setActionMessage(null);
  }, [projectId]);

  useEffect(() => {
    if (workflowId) {
      setScope("workflow");
    } else {
      setScope("project");
    }
  }, [workflowId]);

  useEffect(() => {
    if (!projectId) return;

    let source: ApiEventStream | null = null;
    let cancelled = false;

    void openMissionConsoleStreamV8(projectId).then((eventSource) => {
      if (cancelled) {
        eventSource.close();
        return;
      }
      source = eventSource;
      source.addEventListener("console.event", ((event: MessageEvent) => {
        const payload = JSON.parse(event.data) as ConsoleEvent;
        setLiveEvents((current) => {
          const next = [...current, payload];
          return next.slice(-200);
        });
      }) as EventListener);
    });

    return () => {
      cancelled = true;
      if (source) source.close();
    };
  }, [projectId]);

  const workflowSnapshotEvents = useMemo<ConsoleEvent[]>(
    () =>
      workflowLogs.map((item) => ({
        id: item.id,
        projectId: projectId || "",
        category: item.source === "approval" ? "approval" : item.source?.includes("verify") ? "verification" : "execution",
        level: item.level || "info",
        message: item.message,
        createdAt: item.timestamp,
        taskId: workflowId || item.taskId,
      })),
    [projectId, workflowId, workflowLogs]
  );

  const logs = useMemo(() => {
    const initial =
      scope === "workflow"
        ? workflowSnapshotEvents
        : snapshotEvents?.length
        ? snapshotEvents
        : (query.data?.items ?? []);
    const streamed =
      scope === "workflow" && workflowId ? liveEvents.filter((event) => event.taskId === workflowId) : liveEvents;
    const merged = [...initial, ...streamed].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    return merged.slice(-240);
  }, [liveEvents, query.data?.items, scope, snapshotEvents, workflowId, workflowSnapshotEvents]);

  const filtered = useMemo(
    () => logs.filter((event) => (categoryFilter === "all" ? true : event.category === categoryFilter)),
    [categoryFilter, logs]
  );

  const categoryCounts = useMemo(
    () =>
      logs.reduce(
        (acc, event) => {
          acc[event.category] += 1;
          return acc;
        },
        {
          execution: 0,
          verification: 0,
          provider: 0,
          approval: 0,
          indexing: 0,
        } as Record<ConsoleEvent["category"], number>
      ),
    [logs]
  );

  useEffect(() => {
    if (!followTail) return;
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [followTail, liveEvents.length]);

  function handleScroll() {
    const container = scrollRef.current;
    if (!container) return;
    const distanceFromBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    setFollowTail(distanceFromBottom < 64);
  }

  if (!projectId) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">
        Connect a repo to inspect execution, verification, and provider events.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-5">
      <div className="rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(16,18,24,0.96),rgba(10,11,15,0.94))] p-4 shadow-[0_16px_50px_rgba(0,0,0,0.26)]">
        <div className="flex flex-col gap-4">
          <div className="flex items-center gap-2 flex-wrap">
            <div className="inline-flex items-center gap-2 rounded-xl border border-white/10 bg-white/[0.03] px-3 py-2">
              <img
                src={scope === "workflow" ? "/assets/worker-cluster.svg" : "/assets/telemetry-wave.svg"}
                alt=""
                className="h-4 w-4 opacity-75"
                aria-hidden="true"
              />
              <img src="/assets/focus-reticle.svg" alt="" className="h-4 w-4 opacity-75" aria-hidden="true" />
              <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-400">
                {scope === "workflow" ? "Focused telemetry" : "Live project telemetry"}
              </span>
            </div>
            {workflowId ? (
              <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <button
                  onClick={() => {
                    setScope("workflow");
                    setFollowTail(false);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    scope === "workflow"
                      ? "border border-cyan-400/20 bg-cyan-500/[0.12] text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Workflow
                </button>
                <button
                  onClick={() => {
                    setScope("project");
                    setFollowTail(false);
                  }}
                  className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    scope === "project"
                      ? "border border-white/12 bg-white/[0.07] text-white shadow-[0_0_0_1px_rgba(255,255,255,0.04)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Project
                </button>
              </div>
            ) : null}
            <div className="inline-flex flex-wrap items-center gap-1 rounded-xl border border-white/10 bg-white/[0.03] p-1">
              {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((category) => (
                <button
                  key={category}
                  onClick={() => setCategoryFilter(category as "all" | ConsoleEvent["category"])}
                  className={`rounded-lg px-2.5 py-1.5 text-[10px] uppercase tracking-[0.14em] transition-colors ${
                    categoryFilter === category
                      ? "border border-white/12 bg-white/[0.08] text-zinc-100"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {CATEGORY_LABELS[category]}
                </button>
              ))}
            </div>

            <div className="ml-auto flex items-center gap-2">
              {!followTail ? (
                <button
                  onClick={() => {
                    setFollowTail(true);
                    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
                  }}
                  className="rounded-lg border border-white/12 bg-white/[0.07] px-2.5 py-1.5 text-[10px] uppercase tracking-[0.14em] text-zinc-100"
                >
                  Jump to latest
                </button>
              ) : null}
              <div className="flex items-center gap-1.5 text-[10px] uppercase tracking-[0.14em] text-zinc-500">
                <Filter className="w-3 h-3" />
                {query.isLoading ? "syncing stream" : `${filtered.length} entries`}
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {(Object.keys(CATEGORY_STYLES) as Array<ConsoleEvent["category"]>).map((category) => (
              <div
                key={category}
                className={cn(
                  "inline-flex items-center gap-2 rounded-lg border px-2.5 py-1 text-[10px] uppercase tracking-[0.14em]",
                  CATEGORY_STYLES[category].badge
                )}
              >
                <span className={cn("h-1.5 w-1.5 rounded-full", CATEGORY_STYLES[category].dot)} />
                {CATEGORY_LABELS[category]}
                <span className="font-mono text-[9px]">{categoryCounts[category]}</span>
              </div>
            ))}
          </div>

          {workflowId && scope === "workflow" ? (
            <div className="rounded-[18px] border border-cyan-500/16 bg-cyan-500/[0.06] px-4 py-3 text-xs text-cyan-100">
              <div className="flex items-center gap-2 font-medium">
                <ProcessingIndicator kind="telemetry" active size="xs" tone="subtle" />
                <img src="/assets/autonomous-kanban.svg" alt="" className="h-3.5 w-3.5 opacity-85" aria-hidden="true" />
                {workflowTitle ? `${workflowTitle} telemetry` : "Workflow telemetry"}
              </div>
            </div>
          ) : null}

          {actionMessage ? (
            <div className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-2 text-[11px] text-zinc-300">{actionMessage}</div>
          ) : null}
        </div>
      </div>

      <div
        className="overflow-hidden rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,11,14,0.98),rgba(7,8,11,0.96))] shadow-[0_16px_44px_rgba(0,0,0,0.28)] flex flex-col"
        style={{ minHeight: 500 }}
      >
        <div className="px-4 py-3 border-b border-white/6 bg-zinc-900/30 flex items-center gap-2 shrink-0">
          <img src="/assets/quantum-rail.svg" alt="" className="h-3.5 w-3.5 opacity-85" aria-hidden="true" />
          <ProcessingIndicator kind="telemetry" active size="xs" tone="subtle" />
          <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-mono">
            mission-control — {scope === "workflow" ? "workflow telemetry" : "real event stream"}
          </span>
          <span className="ml-auto text-[10px] font-mono text-zinc-600">{query.isLoading ? "loading" : `${filtered.length} entries`}</span>
        </div>

        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar p-3 font-mono text-[11px] leading-relaxed">
          {filtered.length === 0 ? (
            <div className="text-zinc-700 text-center py-8">{query.isLoading ? "Loading event stream…" : "No real events yet for this project"}</div>
          ) : (
            filtered.map((event) => {
              const cfg = LEVEL_STYLES[event.level];
              const category = CATEGORY_STYLES[event.category];
              const structured = tryParseStructuredPayload(event.message);
              const summary = structured ? summarizeStructuredPayload(structured.payload) : [];
              const profileSummary = structured ? executionProfileSummary(structured.payload) : null;
              const expanded = Boolean(expandedDetails[event.id]);
              const hasToolContext =
                Boolean(payloadString(structured?.payload || {}, "run_id")) &&
                Boolean(payloadString(structured?.payload || {}, "ticket_id"));
              const canInstallDeps =
                hasToolContext &&
                (payloadString(structured?.payload || {}, "error_class") === "infra_missing_tool" ||
                  payloadString(structured?.payload || {}, "error_class") === "infra_missing_dependency");
              const canJumpToApprovals = payloadString(structured?.payload || {}, "policy_decision") === "approval_required";
              return (
                <div
                  key={event.id}
                  className={cn(
                    "group relative overflow-hidden rounded-lg border border-white/6 bg-[linear-gradient(90deg,rgba(255,255,255,0.02),rgba(0,0,0,0.12))] px-3 py-2 transition",
                    "hover:border-white/12 hover:bg-white/[0.03]"
                  )}
                >
                  <div className={cn("absolute bottom-0 left-0 top-0 w-[2px]", category.rail)} />
                  <div className={cn("absolute inset-0 bg-gradient-to-r to-transparent opacity-0 transition-opacity group-hover:opacity-100", category.panel)} />
                  <div className="relative z-[1] flex flex-wrap items-center gap-2">
                    <span
                      className="shrink-0 tabular-nums select-none rounded border border-white/6 bg-black/30 px-1.5 py-0.5 text-[10px] text-zinc-500"
                      title={format(new Date(event.createdAt), "yyyy-MM-dd HH:mm:ss.SSS")}
                    >
                      {format(new Date(event.createdAt), "HH:mm:ss")}
                    </span>
                    <span className={cn("shrink-0 text-[9px] px-1.5 py-0.5 rounded border uppercase tracking-[0.08em]", category.badge)}>
                      {CATEGORY_LABELS[event.category]}
                    </span>
                    <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border ${cfg.badge}`}>{cfg.label}</span>
                    <span className="ml-auto text-[9px] text-zinc-600">
                      {event.taskId ? `task:${event.taskId.slice(0, 8)}` : "project"}
                    </span>
                  </div>
                  <div className={cn("relative z-[1] mt-1.5 leading-5", cfg.color, category.message)}>
                    {structured ? (
                      <div className="space-y-2">
                        <div className="flex items-start justify-between gap-3">
                          <div className="min-w-0">
                            <div className="text-[12px] font-medium text-white/95">{structured.headline}</div>
                            {summary.length ? (
                              <div className="mt-2 flex flex-wrap gap-1.5">
                                {summary.map((item) => (
                                  <span
                                    key={`${event.id}-${item.key}`}
                                    className="inline-flex items-center gap-1 rounded-md border border-white/8 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-zinc-300"
                                  >
                                    <span className="text-zinc-500">{item.label}</span>
                                    <span className="text-white">{item.value}</span>
                                  </span>
                                ))}
                              </div>
                            ) : null}
                            {profileSummary ? (
                              <div className="mt-2.5 rounded-lg border border-white/6 bg-black/20 p-2.5">
                                <div className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">Execution Profile</div>
                                <div className="mt-1 text-[11px] text-white">{profileSummary.profileName}</div>
                                <div className="mt-2 flex flex-wrap gap-1.5">
                                  {profileSummary.stages.map((stage) => (
                                    <span
                                      key={`${event.id}-${stage.stage}`}
                                      className="inline-flex items-center gap-1 rounded-md border border-white/8 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-zinc-300"
                                    >
                                      <span className="text-zinc-500">{executionStageLabel(stage.stage)}</span>
                                      <span className="text-white">{modelRoleLabel(stage.role as Parameters<typeof modelRoleLabel>[0])}</span>
                                      <span className="text-zinc-500">·</span>
                                      <span className="text-zinc-400">{providerLabel(stage.providerId as Parameters<typeof providerLabel>[0])}</span>
                                    </span>
                                  ))}
                                </div>
                              </div>
                            ) : null}
                          </div>
                          <button
                            type="button"
                            onClick={() =>
                              setExpandedDetails((current) => ({
                                ...current,
                                [event.id]: !current[event.id],
                              }))
                            }
                            className="inline-flex items-center gap-1 rounded-md border border-white/8 bg-white/[0.04] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-zinc-300 transition hover:bg-white/[0.08]"
                          >
                            {expanded ? <ChevronDown className="h-3 w-3" /> : <ChevronRight className="h-3 w-3" />}
                            Details
                          </button>
                        </div>

                        {expanded ? (
                          <div className="rounded-lg border border-white/6 bg-black/20 p-3">
                            <div className="grid gap-2 sm:grid-cols-2">
                              {detailEntries(structured.payload).map((entry) => (
                                <div
                                  key={`${event.id}-${entry.key}`}
                                  className={cn(
                                    "rounded-md border border-white/6 bg-white/[0.02] px-2.5 py-2",
                                    entry.multiline ? "sm:col-span-2" : ""
                                  )}
                                >
                                  <div className="text-[9px] uppercase tracking-[0.14em] text-zinc-500">{entry.label}</div>
                                  {Array.isArray(entry.value) ? (
                                    <div className="mt-1.5 space-y-1">
                                      {entry.value.map((line, index) => (
                                        <div key={`${entry.key}-${index}`} className="break-words text-[11px] leading-5 text-zinc-200">
                                          {line}
                                        </div>
                                      ))}
                                    </div>
                                  ) : (
                                    <pre className="mt-1.5 whitespace-pre-wrap break-words font-mono text-[11px] leading-5 text-zinc-200">
                                      {entry.value}
                                    </pre>
                                  )}
                                </div>
                              ))}
                            </div>
                            {(canInstallDeps || canJumpToApprovals) && (
                              <div className="mt-2.5 flex flex-wrap gap-1.5 border-t border-white/6 pt-2.5">
                                {canInstallDeps ? (
                                  <button
                                    type="button"
                                    onClick={() => {
                                      if (!projectId) return;
                                      const runId = payloadString(structured.payload, "run_id");
                                      const ticketId = payloadString(structured.payload, "ticket_id");
                                      const stage = payloadString(structured.payload, "stage");
                                      if (!runId || !ticketId) {
                                        setActionMessage("Missing tool context for dependency bootstrap.");
                                        return;
                                      }
                                      toolInvokeMutation.mutate({
                                        actor: "user",
                                        run_id: runId,
                                        repo_id: projectId,
                                        ticket_id: ticketId,
                                        stage:
                                          stage === "scope" || stage === "build" || stage === "review" || stage === "escalate"
                                            ? stage
                                            : "review",
                                      });
                                    }}
                                    disabled={toolInvokeMutation.isPending}
                                    className="inline-flex items-center gap-1 rounded-md border border-cyan-500/24 bg-cyan-500/[0.12] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-cyan-100 transition hover:bg-cyan-500/[0.18] disabled:opacity-60"
                                  >
                                    {toolInvokeMutation.isPending ? <ProcessingIndicator kind="processing" active size="xs" tone="subtle" /> : null}
                                    Install deps
                                  </button>
                                ) : null}
                                {canJumpToApprovals ? (
                                  <button
                                    type="button"
                                    onClick={() => setCategoryFilter("approval")}
                                    className="inline-flex items-center gap-1 rounded-md border border-amber-500/24 bg-amber-500/[0.12] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-amber-100 transition hover:bg-amber-500/[0.18]"
                                  >
                                    View approvals
                                  </button>
                                ) : null}
                                <button
                                  type="button"
                                  onClick={() => setCategoryFilter("verification")}
                                  className="inline-flex items-center gap-1 rounded-md border border-white/12 bg-white/[0.05] px-2 py-1 text-[10px] uppercase tracking-[0.12em] text-zinc-200 transition hover:bg-white/[0.08]"
                                >
                                  Verification scope
                                </button>
                              </div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    ) : (
                      <div className="whitespace-pre-wrap break-words text-[12px] leading-6">{event.message}</div>
                    )}
                  </div>
                </div>
              );
            })
          )}
          <div ref={bottomRef} />
        </div>
      </div>
    </div>
  );
}
