import { useState } from "react";
import { MissionStream } from "../data/mockData";
import { Panel, PanelHeader, Chip } from "./UI";
import { ArrowRight } from "lucide-react";

const FILTERS = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warn", label: "Warn" },
  { key: "ok", label: "OK" },
];

export function StreamProgressBoard({
  streams,
  onSelectTask,
}: {
  streams: MissionStream[];
  onSelectTask: (id: string) => void;
}) {
  const [filter, setFilter] = useState("all");

  const openBacklogTotal = streams.reduce(
    (sum, s) => sum + s.queued + s.in_progress + s.blocked + s.failed,
    0,
  );
  const filtered = streams.filter(s => filter === "all" || s.risk === filter);

  return (
    <Panel>
      <PanelHeader title="Stream Progress Lanes">
        <div className="flex gap-2">
          <Chip variant="subtle" className="text-[10px]">{openBacklogTotal} open</Chip>
          <Chip variant="subtle" className="text-[10px]">{streams.length} streams</Chip>
        </div>
      </PanelHeader>

      <div className="p-4 flex flex-col gap-3">
        {/* Filters */}
        <div className="flex items-center gap-1.5">
          {FILTERS.map(f => (
            <button
              key={f.key}
              onClick={() => setFilter(f.key)}
              className={`px-2.5 py-1 rounded text-xs font-medium transition-colors border ${
                filter === f.key
                  ? "bg-zinc-800 text-zinc-200 border-zinc-600"
                  : "bg-transparent text-zinc-500 border-transparent hover:text-zinc-300 hover:border-zinc-700"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Stream Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {filtered.map(stream => (
            <button
              key={stream.workstream}
              onClick={() => stream.top_task_id && onSelectTask(stream.top_task_id)}
              disabled={!stream.top_task_id}
              className="text-left bg-[#18181b] border border-white/5 hover:border-white/12 rounded-lg p-4 transition-all group disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {/* Header */}
              <div className="flex justify-between items-start mb-3">
                <h3 className="text-sm font-semibold text-zinc-100">{stream.workstream}</h3>
                <Chip
                  variant={stream.risk === "critical" ? "stop" : stream.risk === "warn" ? "warn" : "ok"}
                  className="text-[10px]"
                >
                  {stream.risk.toUpperCase()}
                </Chip>
              </div>

              {/* Stats grid */}
              <div className="grid grid-cols-5 gap-1.5 text-center text-[10px] mb-3">
                <StatCell label="Q'd" value={stream.queued} />
                <StatCell label="Prog" value={stream.in_progress} variant="purple" />
                <StatCell label="Blk" value={stream.blocked} />
                <StatCell label="Fail" value={stream.failed} variant={stream.failed > 0 ? "rose" : "default"} />
                <StatCell label="Done" value={stream.completed} variant="emerald" />
              </div>

              {/* Progress bar */}
              <div className="mb-3">
                <div className="h-1 rounded-full bg-zinc-800 overflow-hidden">
                  {(() => {
                    const total = stream.queued + stream.in_progress + stream.blocked + stream.failed + stream.completed;
                    const pct = total > 0 ? Math.round((stream.completed / total) * 100) : 0;
                    return (
                      <div
                        className="h-full rounded-full bg-emerald-500/70 transition-all"
                        style={{ width: `${pct}%` }}
                      />
                    );
                  })()}
                </div>
              </div>

              {/* Focus task */}
              {stream.top_task_id ? (
                <div className="text-[10px] text-zinc-500 flex justify-between items-center group-hover:text-zinc-300 transition-colors">
                  <span>
                    Focus: <span className="font-mono text-purple-400 group-hover:text-purple-300">{stream.top_task_id}</span>
                  </span>
                  <ArrowRight className="w-3 h-3" />
                </div>
              ) : (
                <div className="text-[10px] text-zinc-600">No focus task</div>
              )}
            </button>
          ))}
        </div>
      </div>
    </Panel>
  );
}

function StatCell({
  label,
  value,
  variant = "default",
}: {
  label: string;
  value: number;
  variant?: "default" | "purple" | "rose" | "emerald";
}) {
  const styles = {
    default: "bg-zinc-900/60",
    purple: "bg-purple-500/10 border border-purple-500/20",
    rose: "bg-rose-500/10 border border-rose-500/20",
    emerald: "bg-emerald-500/10 border border-emerald-500/20",
  };
  const textStyles = {
    default: "text-zinc-400",
    purple: "text-purple-300",
    rose: "text-rose-300",
    emerald: "text-emerald-300",
  };
  const labelStyles = {
    default: "text-zinc-600",
    purple: "text-purple-500",
    rose: "text-rose-500",
    emerald: "text-emerald-500",
  };
  return (
    <div className={`flex flex-col gap-0.5 p-1.5 rounded ${styles[variant]}`}>
      <span className={`text-[9px] ${labelStyles[variant]}`}>{label}</span>
      <span className={`font-mono text-xs font-medium ${textStyles[variant]}`}>{value}</span>
    </div>
  );
}
