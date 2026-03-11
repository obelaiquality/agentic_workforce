import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Filter, Terminal, Workflow } from "lucide-react";
import type { ConsoleEvent } from "../../../shared/contracts";
import { getMissionConsoleV8, openMissionConsoleStreamV8 } from "../../lib/apiClient";

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
};

type WorkflowLog = {
  id: string;
  timestamp: string;
  message: string;
  level?: "info" | "warn" | "error" | "success" | "debug";
  source?: string;
  taskId?: string;
};

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
  const [categoryFilter, setCategoryFilter] = useState<"all" | ConsoleEvent["category"]>("all");
  const [followTail, setFollowTail] = useState(true);
  const [scope, setScope] = useState<"workflow" | "project">("project");
  const [liveEvents, setLiveEvents] = useState<ConsoleEvent[]>([]);
  const scrollRef = useRef<HTMLDivElement | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const query = useQuery({
    queryKey: ["mission-console-v8", projectId],
    queryFn: () => getMissionConsoleV8(projectId!),
    enabled: Boolean(projectId) && !snapshotEvents?.length,
    staleTime: 3000,
  });

  useEffect(() => {
    setLiveEvents([]);
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

    let source: EventSource | null = null;
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

  useEffect(() => {
    if (followTail) {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    }
  }, [filtered, followTail]);

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
            {workflowId ? (
              <div className="inline-flex items-center rounded-xl border border-white/10 bg-white/[0.03] p-1 shadow-[inset_0_1px_0_rgba(255,255,255,0.03)]">
                <button
                  onClick={() => setScope("workflow")}
                  className={`rounded-lg px-3 py-1.5 text-[10px] uppercase tracking-[0.18em] transition-colors ${
                    scope === "workflow"
                      ? "border border-cyan-400/20 bg-cyan-500/[0.12] text-cyan-100 shadow-[0_0_0_1px_rgba(34,211,238,0.08)]"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  Workflow
                </button>
                <button
                  onClick={() => setScope("project")}
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
                {filtered.length} entries
              </div>
            </div>
          </div>

          {workflowId && scope === "workflow" ? (
            <div className="rounded-[18px] border border-cyan-500/16 bg-cyan-500/[0.06] px-4 py-3 text-xs text-cyan-100">
              <div className="flex items-center gap-2 font-medium">
                <Workflow className="h-3.5 w-3.5 text-cyan-300" />
                {workflowTitle ? `${workflowTitle} telemetry` : "Workflow telemetry"}
              </div>
              <div className="mt-1 text-cyan-100/80">
                Showing task-linked execution history first. Live project-wide events remain available under Project scope.
              </div>
            </div>
          ) : null}
        </div>
      </div>

      <div
        className="overflow-hidden rounded-[22px] border border-white/8 bg-[linear-gradient(180deg,rgba(10,11,14,0.98),rgba(7,8,11,0.96))] shadow-[0_16px_44px_rgba(0,0,0,0.28)] flex flex-col"
        style={{ minHeight: 500 }}
      >
        <div className="px-4 py-3 border-b border-white/6 bg-zinc-900/30 flex items-center gap-2 shrink-0">
          <Terminal className="w-3.5 h-3.5 text-cyan-400" />
          <span className="text-[10px] uppercase tracking-[0.18em] text-zinc-400 font-mono">
            mission-control — {scope === "workflow" ? "workflow telemetry" : "real event stream"}
          </span>
          <span className="ml-auto text-[10px] font-mono text-zinc-600">{query.isLoading ? "loading" : `${filtered.length} entries`}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
        </div>

        <div ref={scrollRef} onScroll={handleScroll} className="flex-1 overflow-y-auto custom-scrollbar p-3 font-mono text-[11px] leading-relaxed">
          {filtered.length === 0 ? (
            <div className="text-zinc-700 text-center py-8">{query.isLoading ? "Loading event stream…" : "No real events yet for this project"}</div>
          ) : (
            filtered.map((event) => {
              const cfg = LEVEL_STYLES[event.level];
              return (
                <div key={event.id} className="flex gap-2 py-0.5 hover:bg-white/[0.02] rounded group items-start">
                  <span className="text-zinc-700 shrink-0 tabular-nums select-none pt-px">{format(new Date(event.createdAt), "HH:mm:ss.SSS")}</span>
                  <span className={`shrink-0 text-[9px] px-1.5 py-0.5 rounded border ${cfg.badge}`}>{cfg.label}</span>
                  <span className="text-zinc-500 shrink-0 hidden sm:block">[{event.category}]</span>
                  <span className={cfg.color}>{event.message}</span>
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
