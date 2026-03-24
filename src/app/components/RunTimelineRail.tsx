import { useState } from "react";
import type { MissionRunPhase, MissionTimelineEvent } from "../lib/missionTypes";
import { Chip, Panel, PanelHeader } from "./UI";
import { Clock3, Activity, ChevronDown, ChevronUp } from "lucide-react";
import { format } from "date-fns";

const PHASES: Array<{ key: MissionRunPhase; label: string }> = [
  { key: "starting", label: "Starting" },
  { key: "single_task_validation", label: "Validation" },
  { key: "parallel_running", label: "Running" },
  { key: "draining", label: "Draining" },
  { key: "completed", label: "Completed" },
];

export function RunTimelineRail({
  runPhase,
  timeline,
}: {
  runPhase: MissionRunPhase;
  timeline: MissionTimelineEvent[];
}) {
  const [expanded, setExpanded] = useState(true);
  const activeIndex = Math.max(PHASES.findIndex(p => p.key === runPhase), 0);
  const progressPercent = runPhase === "completed" ? 100 : ((activeIndex + 0.5) / PHASES.length) * 100;

  return (
    <Panel>
      <PanelHeader title="Run Narrative Timeline">
        <div className="flex items-center gap-2">
          <Chip variant="subtle" className="text-[10px]">phase: {runPhase}</Chip>
          <button
            onClick={() => setExpanded(v => !v)}
            className="w-6 h-6 flex items-center justify-center rounded-md bg-zinc-800/80 hover:bg-zinc-700 border border-zinc-700/50 text-zinc-400 transition-colors"
          >
            {expanded ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
          </button>
        </div>
      </PanelHeader>

      {/* Phase Stepper */}
      <div className="px-5 pt-4 pb-3 border-b border-white/5 bg-zinc-900/20">
        <div className="relative pt-2 pb-1">
          <div className="absolute top-4 left-4 right-4 h-0.5 bg-zinc-800 rounded-full" />
          <div
            className="absolute top-4 left-4 h-0.5 bg-purple-500 rounded-full transition-all duration-700 shadow-[0_0_6px_rgba(168,85,247,0.5)]"
            style={{ width: `calc(${progressPercent}% - 2rem)` }}
          />
          <div className="relative flex justify-between items-start z-10">
            {PHASES.map((phase, idx) => {
              const reached = idx <= activeIndex;
              const active = idx === activeIndex;
              return (
                <div key={phase.key} className="flex flex-col items-center gap-1.5">
                  <div className={`w-3.5 h-3.5 rounded-full border-2 transition-colors ${
                    active
                      ? "bg-black border-purple-500 shadow-[0_0_10px_rgba(168,85,247,0.7)]"
                      : reached
                      ? "bg-purple-500 border-purple-500"
                      : "bg-black border-zinc-700"
                  }`} />
                  <span className={`text-[9px] font-medium tracking-wider uppercase ${
                    active ? "text-purple-400" : reached ? "text-zinc-400" : "text-zinc-600"
                  }`}>{phase.label}</span>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Event Log — collapsible */}
      {expanded && (
        <div className="overflow-y-auto custom-scrollbar p-4 flex flex-col gap-3 max-h-60">
          {timeline.map(event => (
            <div key={event.id} className="flex gap-3 relative">
              <div className="flex flex-col items-center shrink-0">
                <div className={`w-2 h-2 rounded-full mt-1.5 z-10 ${
                  event.severity === "ERROR"
                    ? "bg-rose-500 shadow-[0_0_6px_rgba(244,63,94,0.6)]"
                    : event.severity === "WARNING"
                    ? "bg-amber-500 shadow-[0_0_6px_rgba(245,158,11,0.6)]"
                    : "bg-zinc-600"
                }`} />
                <div className="w-px flex-1 bg-zinc-800/60 mt-1" />
              </div>
              <div className="flex-1 bg-[#18181b] border border-white/5 rounded-lg p-3 pb-2.5">
                <div className="flex items-center justify-between mb-1.5">
                  <div className="flex items-center gap-1.5">
                    <Chip
                      variant={event.severity === "ERROR" ? "stop" : event.severity === "WARNING" ? "warn" : "subtle"}
                      className="text-[9px] py-0"
                    >
                      {event.severity}
                    </Chip>
                    {event.kind && (
                      <span className="text-[9px] text-zinc-500 font-mono bg-zinc-800/50 px-1 py-0.5 rounded">{event.kind}</span>
                    )}
                  </div>
                  <span className="text-[9px] text-zinc-600 font-mono flex items-center gap-0.5">
                    <Clock3 className="w-2.5 h-2.5" />
                    {format(new Date(event.timestamp), "HH:mm:ss")}
                  </span>
                </div>
                <p className="text-xs text-zinc-300 leading-relaxed">{event.message}</p>
                {event.task_id && (
                  <div className="mt-1.5 text-[9px] text-zinc-600 font-mono flex items-center gap-1">
                    <Activity className="w-2.5 h-2.5" /> {event.task_id}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
