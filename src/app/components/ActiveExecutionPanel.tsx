import type { MissionTaskCard, TaskSpotlight } from "../lib/missionTypes";
import { Panel, PanelHeader, Chip, Button } from "./UI";
import { Activity, Cpu } from "lucide-react";

export function ActiveExecutionPanel({
  tasks,
  selectedTaskId,
  spotlight,
  onSelectTask,
  canRequeue = false,
  canMarkActive = false,
  canComplete = false,
  onRequeue,
  onMarkActive,
  onComplete,
}: {
  tasks: MissionTaskCard[];
  selectedTaskId: string;
  spotlight: TaskSpotlight | null;
  onSelectTask: (id: string) => void;
  canRequeue?: boolean;
  canMarkActive?: boolean;
  canComplete?: boolean;
  onRequeue?: () => void;
  onMarkActive?: () => void;
  onComplete?: () => void;
}) {
  return (
    <Panel>
      <PanelHeader title="Active Execution Focus">
        <Chip variant="subtle" className="text-[10px]">{tasks.length} active tasks</Chip>
      </PanelHeader>

      <div className="grid grid-cols-1 lg:grid-cols-[220px_1fr] divide-y lg:divide-y-0 lg:divide-x divide-white/5 min-h-[320px] max-h-[420px]">

        {/* Task List */}
        <div className="flex flex-col bg-zinc-950/30 overflow-hidden">
          <div className="px-3 py-2 text-[9px] text-zinc-600 uppercase tracking-widest font-medium border-b border-white/5">
            Tasks
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2 flex flex-col gap-1.5">
            {tasks.map(task => {
              const isSelected = selectedTaskId === task.task_id;
              return (
                <button
                  key={task.task_id}
                  onClick={() => onSelectTask(task.task_id)}
                  className={`text-left p-2.5 rounded-md transition-all border ${
                    isSelected
                      ? "bg-purple-500/10 border-purple-500/25 shadow-[inset_3px_0_0_0_#a855f7]"
                      : "bg-zinc-900/40 border-transparent hover:bg-zinc-800/60"
                  }`}
                >
                  <div className="flex justify-between items-center mb-1">
                    <span className={`text-[10px] font-mono ${isSelected ? "text-purple-400" : "text-zinc-500"}`}>
                      {task.task_id}
                    </span>
                    <Activity className={`w-2.5 h-2.5 ${isSelected ? "text-purple-400" : "text-zinc-700"}`} />
                  </div>
                  <div className="text-xs font-medium text-zinc-200 truncate mb-1.5">{task.title}</div>
                  <Chip variant="subtle" className="text-[9px] py-0 px-1">
                    {task.phase.replace(/_/g, " ")}
                  </Chip>
                </button>
              );
            })}
          </div>
        </div>

        {/* Focus Detail */}
        <div className="flex flex-col bg-[#121214] overflow-hidden">
          {spotlight ? (
            <div className="flex-1 overflow-y-auto custom-scrollbar p-4 flex flex-col gap-4">
              {/* Task Title */}
              <div>
                <div className="text-[9px] font-bold tracking-widest text-purple-500 uppercase mb-1 flex items-center gap-1.5">
                  <Activity className="w-3 h-3" /> Spotlight
                </div>
                <h2 className="text-lg font-semibold text-white">{spotlight.task_id}</h2>
                <p className="text-zinc-400 text-sm">{spotlight.title}</p>
              </div>

              {/* Phase / Duration Info */}
              <div className="bg-[#18181b] border border-white/5 rounded-lg p-3">
                <div className="flex items-center justify-between mb-3">
                  <span className="text-[10px] text-zinc-500 uppercase tracking-wide">Current Phase</span>
                  <Chip variant="ok" className="text-[10px]">
                    {spotlight.lifecycle.current_phase.replace(/_/g, " ")}
                  </Chip>
                </div>

                {spotlight.phase_durations && (
                  <div className="flex flex-wrap gap-1.5 mb-3">
                    {Object.entries(spotlight.phase_durations).map(([phase, duration]) => (
                      <div key={phase} className="bg-black/40 border border-white/5 px-2 py-1 rounded text-[10px] font-mono flex items-center gap-1.5">
                        <span className="text-zinc-500">{phase.replace(/_/g, " ")}</span>
                        <span className="text-zinc-300">{duration}s</span>
                      </div>
                    ))}
                  </div>
                )}

                {spotlight.latest_transition_reason && (
                  <p className="text-[11px] text-zinc-500 italic border-l-2 border-zinc-700 pl-2.5 py-0.5">
                    "{spotlight.latest_transition_reason}"
                  </p>
                )}
              </div>

              {/* Worker info */}
              {spotlight.latest_artifact?.payload?.outcome && (
                <div className="flex items-center gap-2">
                  <Cpu className="w-3.5 h-3.5 text-purple-400" />
                  <span className="text-xs text-zinc-400">
                    Worker-{spotlight.latest_artifact.payload.outcome.worker_id} ·{" "}
                    {spotlight.latest_artifact.payload.outcome.token_usage?.total_tokens?.toLocaleString()} tokens
                  </span>
                </div>
              )}

              <div className="flex-1" />

              {/* Actions */}
              {(canRequeue && onRequeue) || (canMarkActive && onMarkActive) || (canComplete && onComplete) ? (
                <div className="flex flex-wrap gap-2 pt-3 border-t border-white/5">
                  {canRequeue && onRequeue ? (
                    <Button variant="subtle" className="flex-1 justify-center text-xs" onClick={onRequeue}>
                      Requeue
                    </Button>
                  ) : null}
                  {canMarkActive && onMarkActive ? (
                    <Button variant="subtle" className="flex-1 justify-center text-xs" onClick={onMarkActive}>
                      Mark Active
                    </Button>
                  ) : null}
                  {canComplete && onComplete ? (
                    <Button variant="primary" className="flex-1 justify-center text-xs" onClick={onComplete}>
                      Complete
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
              Select a task to view spotlight details
            </div>
          )}
        </div>
      </div>
    </Panel>
  );
}
