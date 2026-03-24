import { useState } from "react";
import type { TaskSpotlight } from "../lib/missionTypes";
import { Panel, PanelHeader, Chip } from "./UI";
import { ChevronRight, FileCode2, Info, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";

export function TaskInsightPanel({ spotlight }: { spotlight: TaskSpotlight | null }) {
  const [patchExpanded, setPatchExpanded] = useState(false);

  if (!spotlight) {
    return (
      <Panel>
        <PanelHeader title="Task Insight Report" />
        <div className="p-8 text-center text-zinc-500 text-xs">
          Select a task to view artifact summary, diffs, and lifecycle details.
        </div>
      </Panel>
    );
  }

  const payload = spotlight.latest_artifact?.payload || {};
  const outcome = payload.outcome || {};
  const success = outcome.success === true;
  const workerId = outcome.worker_id;
  const attempts = outcome.attempts || 1;
  const patchesApplied = outcome.patches_applied || 0;
  const tokens = outcome.token_usage?.total_tokens || 0;

  const stats = [
    { label: "Attempts", value: attempts },
    { label: "Patches", value: patchesApplied },
    { label: "LLM Out", value: spotlight.latest_artifact?.llm_output_count || 0 },
    { label: "Tokens", value: tokens >= 1000 ? `${(tokens / 1000).toFixed(1)}k` : tokens },
    { label: "Worker", value: workerId || "—" },
    { label: "Status", value: success ? "OK" : "Fail", isStatus: true },
  ];

  return (
    <Panel>
      <PanelHeader title="Task Insight Report">
        <Chip variant="subtle" className="text-purple-400 border-purple-500/30 bg-purple-500/10">
          {spotlight.task_id}
        </Chip>
      </PanelHeader>

      <div className="p-4 flex flex-col gap-4">

        {/* Key Metrics */}
        <div className="grid grid-cols-3 gap-2">
          {stats.map((stat, i) => (
            <div key={i} className="bg-[#18181b] border border-white/5 rounded-md p-2.5 flex flex-col items-center text-center">
              <span className="text-[9px] text-zinc-500 mb-1 uppercase tracking-wide">{stat.label}</span>
              <span className={`text-base font-mono font-medium ${
                stat.isStatus
                  ? success ? "text-emerald-400" : "text-rose-400"
                  : "text-zinc-200"
              }`}>
                {stat.value}
              </span>
            </div>
          ))}
        </div>

        {/* Status Banner */}
        <div className={`flex items-center gap-2 p-2.5 rounded-md border text-[10px] font-mono ${
          success
            ? "bg-emerald-500/10 border-emerald-500/20"
            : "bg-rose-500/10 border-rose-500/20"
        }`}>
          <Chip variant={success ? "ok" : "stop"} className="text-[9px]">
            {success ? "Success" : "Failed"}
          </Chip>
          <span className="text-zinc-400">worker: {workerId || "—"}</span>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-400">attempts: {attempts}</span>
          <span className="text-zinc-700">|</span>
          <span className="text-zinc-400">patches: {patchesApplied}</span>
        </div>

        {/* Markdown Summary */}
        {spotlight.latest_artifact?.markdown_summary && (
          <div className="bg-zinc-950 border border-white/5 rounded-md p-3">
            <h3 className="text-[10px] font-semibold text-zinc-300 mb-2 flex items-center gap-1.5 uppercase tracking-wide">
              <Info className="w-3 h-3 text-purple-400" /> Run Summary
            </h3>
            <div className="text-[11px] text-zinc-400 whitespace-pre-wrap leading-relaxed font-mono">
              {spotlight.latest_artifact.markdown_summary.replace(/\\n/g, "\n")}
            </div>
          </div>
        )}

        {/* Collapsible Patch Preview */}
        {payload.llm_outputs && payload.llm_outputs.length > 0 && (
          <div className="bg-zinc-950 border border-white/5 rounded-md overflow-hidden">
            <button
              onClick={() => setPatchExpanded(v => !v)}
              className="w-full px-3 py-2 border-b border-white/5 bg-zinc-900/50 flex items-center justify-between hover:bg-zinc-800/50 transition-colors"
            >
              <h3 className="text-[10px] font-semibold text-zinc-300 flex items-center gap-1.5 uppercase tracking-wide">
                <FileCode2 className="w-3 h-3 text-cyan-400" /> Latest Patch Preview
                <span className="text-zinc-600 font-normal normal-case">({payload.llm_outputs.length} output{payload.llm_outputs.length > 1 ? "s" : ""})</span>
              </h3>
              {patchExpanded
                ? <ChevronUp className="w-3.5 h-3.5 text-zinc-500" />
                : <ChevronDown className="w-3.5 h-3.5 text-zinc-500" />
              }
            </button>

            {patchExpanded && (
              <div className="p-3 overflow-x-auto custom-scrollbar max-h-64">
                <pre className="text-[10px] font-mono leading-relaxed">
                  {payload.llm_outputs[0].split("\n").map((line: string, i: number) => {
                    let color = "text-zinc-400";
                    let bg = "";
                    if (line.startsWith("+") && !line.startsWith("+++")) {
                      color = "text-emerald-400"; bg = "bg-emerald-500/10";
                    } else if (line.startsWith("-") && !line.startsWith("---")) {
                      color = "text-rose-400"; bg = "bg-rose-500/10";
                    } else if (line.startsWith("@@")) {
                      color = "text-cyan-400"; bg = "bg-cyan-500/10";
                    } else if (line.startsWith("diff") || line.startsWith("index")) {
                      color = "text-zinc-500";
                    }
                    return (
                      <div key={i} className={`px-1.5 py-px ${bg} flex gap-3`}>
                        <span className="select-none text-zinc-700 w-5 text-right shrink-0">{i + 1}</span>
                        <span className={color}>{line}</span>
                      </div>
                    );
                  })}
                </pre>
              </div>
            )}
          </div>
        )}

        {/* Lifecycle Events */}
        <div>
          <h3 className="text-[10px] font-semibold text-zinc-400 flex items-center gap-1.5 uppercase tracking-wide pb-2 mb-2 border-b border-white/5">
            <ChevronRight className="w-3 h-3" /> Recent Events
          </h3>
          <div className="flex flex-col gap-2">
            {spotlight.lifecycle.events.map((event, i) => (
              <div key={i} className="flex gap-2 text-[11px] items-start">
                <span className="text-zinc-600 font-mono shrink-0 tabular-nums pt-px">
                  {format(new Date(event.timestamp), "HH:mm:ss")}
                </span>
                <Chip variant="subtle" className="text-[9px] py-0 px-1 h-4 shrink-0">{event.severity}</Chip>
                <span className="text-zinc-300 leading-relaxed">{event.message}</span>
              </div>
            ))}
          </div>
        </div>

      </div>
    </Panel>
  );
}
