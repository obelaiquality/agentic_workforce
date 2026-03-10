"use client";

import { RotateCcw, TimerReset, CheckCircle2 } from "lucide-react";
import type { MissionTaskCard, OperatorActionRequest, TaskSpotlight } from "@/types/mission-control";

interface ActiveExecutionPanelProps {
  tasks: MissionTaskCard[];
  selectedTaskId: string;
  spotlight: TaskSpotlight | null;
  guidanceCount: number;
  isActing: boolean;
  onSelectTask: (taskId: string) => void;
  onTaskAction: (request: OperatorActionRequest) => Promise<boolean>;
}

function phaseTag(phase: string): string {
  if (!phase) {
    return "queued";
  }
  return phase.replace(/_/g, " ");
}

export function ActiveExecutionPanel({
  tasks,
  selectedTaskId,
  spotlight,
  guidanceCount,
  isActing,
  onSelectTask,
  onTaskAction,
}: ActiveExecutionPanelProps) {
  const selectedTask = tasks.find((task) => task.task_id === selectedTaskId) ?? tasks[0] ?? null;
  const focusedTaskId = selectedTask?.task_id ?? selectedTaskId;

  return (
    <section className="mc2-panel" data-testid="mc2-active-execution">
      <div className="mc2-panel-head">
        <h2>Active Execution Focus</h2>
        <span className="mc2-chip mc2-chip-subtle">{tasks.length} active</span>
      </div>

      <div className="mc2-active-grid">
        <div className="mc2-active-list" role="list" aria-label="Active tasks">
          {tasks.length === 0 ? <p className="mc2-muted">No active tasks right now.</p> : null}
          {tasks.map((task) => (
            <button
              key={task.task_id}
              type="button"
              className="mc2-active-item"
              data-selected={focusedTaskId === task.task_id}
              onClick={() => onSelectTask(task.task_id)}
            >
              <p className="mc2-active-id">{task.task_id}</p>
              <p className="mc2-active-title">{task.title}</p>
              <span className="mc2-chip mc2-chip-subtle">{phaseTag(task.phase)}</span>
            </button>
          ))}
        </div>

        <div className="mc2-task-focus" data-testid="mc2-task-focus">
          {spotlight ? (
            <>
              <p className="mc2-kicker">Task Spotlight</p>
              <h3>{spotlight.task_id}</h3>
              <p className="mc2-task-title">{spotlight.title}</p>
              <p className="mc2-muted">Current phase: {phaseTag(spotlight.lifecycle.current_phase)}</p>
              {spotlight.latest_transition_reason ? <p className="mc2-muted">Last transition: {spotlight.latest_transition_reason}</p> : null}

              {spotlight.phase_durations ? (
                <div className="mc2-phase-duration-row">
                  {Object.entries(spotlight.phase_durations)
                    .slice(0, 5)
                    .map(([phase, seconds]) => (
                      <span key={phase} className="mc2-chip mc2-chip-subtle">
                        {phaseTag(phase)} {Math.round(seconds)}s
                      </span>
                    ))}
                </div>
              ) : null}

              <p className="mc2-muted">Bound guidance entries: {guidanceCount}</p>

              <div className="mc2-inline-actions">
                <button
                  type="button"
                  className="mc2-btn mc2-btn-subtle"
                  disabled={isActing || !focusedTaskId}
                  onClick={() => void onTaskAction({ action: "requeue", task_id: focusedTaskId })}
                >
                  <RotateCcw className="h-4 w-4" /> Requeue
                </button>
                <button
                  type="button"
                  className="mc2-btn mc2-btn-subtle"
                  disabled={isActing || !focusedTaskId}
                  onClick={() => void onTaskAction({ action: "mark_active", task_id: focusedTaskId })}
                >
                  <TimerReset className="h-4 w-4" /> Mark Active
                </button>
                <button
                  type="button"
                  className="mc2-btn mc2-btn-subtle"
                  disabled={isActing || !focusedTaskId}
                  onClick={() => void onTaskAction({ action: "mark_completed", task_id: focusedTaskId })}
                >
                  <CheckCircle2 className="h-4 w-4" /> Complete
                </button>
              </div>
            </>
          ) : (
            <p className="mc2-muted">Select a task to inspect active execution details.</p>
          )}
        </div>
      </div>
    </section>
  );
}
