"use client";

import { useMemo } from "react";
import { Clock3 } from "lucide-react";
import type { MissionRunPhase, MissionTimelineEvent } from "@/types/mission-control";

const PHASES: Array<{ key: MissionRunPhase; label: string }> = [
  { key: "starting", label: "Starting" },
  { key: "single_task_validation", label: "Single Validation" },
  { key: "parallel_running", label: "Parallel Running" },
  { key: "draining", label: "Draining" },
  { key: "completed", label: "Completed" },
];

interface RunTimelineRailProps {
  runPhase: MissionRunPhase;
  timeline: MissionTimelineEvent[];
}

interface DisplayTimelineEvent extends MissionTimelineEvent {
  heartbeatCount?: number;
}

function phaseIndex(phase: MissionRunPhase): number {
  return PHASES.findIndex((item) => item.key === phase);
}

function lifecycleIndexFromTimeline(timeline: MissionTimelineEvent[]): number {
  let maxReached = -1;
  for (const event of timeline) {
    const index = PHASES.findIndex((phase) => phase.key === event.phase);
    if (index > maxReached) {
      maxReached = index;
    }
  }
  return maxReached;
}

function normalizeRailIndex(runPhase: MissionRunPhase, timeline: MissionTimelineEvent[]): number {
  const directIndex = phaseIndex(runPhase);
  if (directIndex >= 0) {
    return directIndex;
  }
  const fromTimeline = lifecycleIndexFromTimeline(timeline);
  if (runPhase === "error" || runPhase === "stopped") {
    if (fromTimeline >= 0) {
      return Math.min(fromTimeline, PHASES.length - 2);
    }
    return 2;
  }
  return 0;
}

function formatStamp(raw: string): string {
  const parsed = new Date(raw);
  if (Number.isNaN(parsed.getTime())) {
    return raw;
  }
  return parsed.toLocaleTimeString();
}

function isHeartbeat(message: string): boolean {
  return message.toLowerCase().startsWith("worker heartbeat:");
}

function timeDiffSeconds(a: string, b: string): number {
  const first = new Date(a).getTime();
  const second = new Date(b).getTime();
  if (Number.isNaN(first) || Number.isNaN(second)) {
    return Number.MAX_SAFE_INTEGER;
  }
  return Math.abs(Math.floor((first - second) / 1000));
}

function severityClass(severity: MissionTimelineEvent["severity"]): string {
  if (severity === "ERROR") {
    return "mc2-chip mc2-chip-stop";
  }
  if (severity === "WARNING") {
    return "mc2-chip mc2-chip-warn";
  }
  return "mc2-chip mc2-chip-subtle";
}

function terminalClass(runPhase: MissionRunPhase): string {
  if (runPhase === "completed") {
    return "mc2-chip mc2-chip-ok";
  }
  if (runPhase === "error") {
    return "mc2-chip mc2-chip-stop";
  }
  if (runPhase === "stopped") {
    return "mc2-chip mc2-chip-warn";
  }
  return "mc2-chip mc2-chip-subtle";
}

export function RunTimelineRail({ runPhase, timeline }: RunTimelineRailProps) {
  const activeIndex = normalizeRailIndex(runPhase, timeline);
  const progressPercent = runPhase === "completed" ? 100 : ((Math.max(activeIndex, 0) + 1) / PHASES.length) * 100;

  const recentEvents = useMemo(() => {
    const deduped: DisplayTimelineEvent[] = [];
    for (const event of timeline) {
      const previous = deduped[deduped.length - 1];
      const sameHeartbeat =
        previous &&
        isHeartbeat(previous.message) &&
        isHeartbeat(event.message) &&
        previous.task_id === event.task_id &&
        timeDiffSeconds(previous.timestamp, event.timestamp) <= 30;
      if (sameHeartbeat) {
        previous.heartbeatCount = (previous.heartbeatCount ?? 1) + 1;
        continue;
      }
      deduped.push({
        ...event,
        heartbeatCount: isHeartbeat(event.message) ? 1 : undefined,
      });
      if (deduped.length >= 12) {
        break;
      }
    }
    return deduped;
  }, [timeline]);

  return (
    <section className="mc2-panel" data-testid="mc2-run-timeline">
      <div className="mc2-panel-head">
        <h2>Run Narrative Timeline</h2>
        <div className="mc2-head-chip-row">
          <span className="mc2-chip mc2-chip-subtle">phase: {runPhase}</span>
          {runPhase === "completed" || runPhase === "error" || runPhase === "stopped" ? (
            <span className={terminalClass(runPhase)}>terminal: {runPhase}</span>
          ) : null}
        </div>
      </div>

      <div className="mc2-phase-track-wrap">
        <div className="mc2-phase-track-line" />
        <div
          className="mc2-phase-track-fill"
          data-error={runPhase === "error"}
          style={{ width: `${progressPercent}%` }}
        />
        <div className="mc2-phase-track" role="list" aria-label="Run phase timeline">
          {PHASES.map((phase, index) => {
            const done = runPhase === "completed" ? index < PHASES.length : index < activeIndex;
            const active = runPhase === "completed" ? index === PHASES.length - 1 : index === activeIndex;
            const reached = runPhase === "completed" ? true : index <= activeIndex;

            return (
              <div
                key={phase.key}
                className="mc2-phase-step"
                role="listitem"
                data-active={active}
                data-done={done}
                data-reached={reached}
                aria-current={active ? "step" : undefined}
              >
                <div className="mc2-phase-dot" />
                <p>{phase.label}</p>
              </div>
            );
          })}
        </div>
      </div>

      <div className="mc2-event-rail" data-testid="mc2-timeline-events">
        {recentEvents.length === 0 ? (
          <p className="mc2-muted">No run events yet.</p>
        ) : (
          recentEvents.map((event) => (
            <article key={event.id} className="mc2-event-item">
              <div className="mc2-event-head">
                <div className="mc2-head-chip-row">
                  <span className={severityClass(event.severity)}>
                    {event.severity}
                    {event.heartbeatCount && event.heartbeatCount > 1 ? ` x${event.heartbeatCount}` : ""}
                  </span>
                  {event.kind ? <span className="mc2-chip mc2-chip-subtle">{event.kind}</span> : null}
                </div>
                <span className="mc2-muted">
                  <Clock3 className="inline h-3.5 w-3.5" /> {formatStamp(event.timestamp)}
                </span>
              </div>
              <p className="mc2-event-msg">{event.message}</p>
              {event.task_id ? <p className="mc2-muted">task: {event.task_id}</p> : null}
            </article>
          ))
        )}
      </div>
    </section>
  );
}
