import { useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import { Filter, Terminal } from "lucide-react";
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

export function ConsoleView({ projectId, snapshotEvents }: { projectId: string | null; snapshotEvents?: ConsoleEvent[] }) {
  const [categoryFilter, setCategoryFilter] = useState<"all" | ConsoleEvent["category"]>("all");
  const [followTail, setFollowTail] = useState(true);
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

  const logs = useMemo(() => {
    const initial = snapshotEvents?.length ? snapshotEvents : (query.data?.items ?? []);
    const merged = [...initial, ...liveEvents].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());
    return merged.slice(-240);
  }, [liveEvents, query.data?.items, snapshotEvents]);

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
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2 flex-wrap">
        <div className="flex items-center gap-0.5 bg-[#121214] border border-white/8 rounded-lg p-1">
          {(Object.keys(CATEGORY_LABELS) as Array<keyof typeof CATEGORY_LABELS>).map((category) => (
            <button
              key={category}
              onClick={() => setCategoryFilter(category as "all" | ConsoleEvent["category"])}
              className={`px-2.5 py-1 rounded text-[10px] font-medium transition-colors ${
                categoryFilter === category ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"
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
              className="text-[10px] px-2.5 py-1 rounded-md border bg-zinc-800 text-zinc-200 border-zinc-700"
            >
              Jump to latest
            </button>
          ) : null}
          <div className="flex items-center gap-1.5 text-[10px] text-zinc-500">
            <Filter className="w-3 h-3" />
            {filtered.length} entries
          </div>
        </div>
      </div>

      <div className="bg-[#0a0a0b] border border-white/8 rounded-xl overflow-hidden flex flex-col" style={{ minHeight: 500 }}>
        <div className="px-4 py-2 border-b border-white/5 bg-zinc-900/30 flex items-center gap-2 shrink-0">
          <Terminal className="w-3.5 h-3.5 text-green-400" />
          <span className="text-[10px] text-zinc-400 font-mono">mission-control — real event stream</span>
          <span className="ml-auto text-[10px] font-mono text-zinc-600">{query.isLoading ? "loading" : `${filtered.length} entries`}</span>
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-pulse" />
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
