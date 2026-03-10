"use client";

import { useMemo, useState } from "react";
import type { MissionStream } from "@/types/mission-control";

interface StreamProgressBoardProps {
  streams: MissionStream[];
  onSelectTask: (taskId: string) => void;
}

type RiskFilter = "all" | "critical" | "warn" | "ok" | "active";

const RISK_FILTERS: Array<{ key: RiskFilter; label: string }> = [
  { key: "all", label: "All" },
  { key: "critical", label: "Critical" },
  { key: "warn", label: "Warn" },
  { key: "ok", label: "OK" },
  { key: "active", label: "Active" },
];

function riskClass(risk: MissionStream["risk"]): string {
  if (risk === "critical") {
    return "mc2-chip mc2-chip-stop";
  }
  if (risk === "warn") {
    return "mc2-chip mc2-chip-warn";
  }
  return "mc2-chip mc2-chip-ok";
}

function riskWeight(risk: MissionStream["risk"]): number {
  if (risk === "critical") {
    return 0;
  }
  if (risk === "warn") {
    return 1;
  }
  return 2;
}

function isActiveStream(stream: MissionStream): boolean {
  return stream.queued > 0 || stream.in_progress > 0 || stream.blocked > 0 || stream.failed > 0;
}

export function StreamProgressBoard({ streams, onSelectTask }: StreamProgressBoardProps) {
  const [riskFilter, setRiskFilter] = useState<RiskFilter>("all");
  const [search, setSearch] = useState("");
  const [expanded, setExpanded] = useState(false);
  const openBacklogTotal = useMemo(
    () => streams.reduce((sum, stream) => sum + stream.queued + stream.in_progress + stream.blocked + stream.failed, 0),
    [streams]
  );

  const filteredStreams = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    const sorted = [...streams].sort((a, b) => {
      const riskOrder = riskWeight(a.risk) - riskWeight(b.risk);
      if (riskOrder !== 0) {
        return riskOrder;
      }
      const inProgressOrder = b.in_progress - a.in_progress;
      if (inProgressOrder !== 0) {
        return inProgressOrder;
      }
      const failedOrder = b.failed - a.failed;
      if (failedOrder !== 0) {
        return failedOrder;
      }
      return (a.workstream || "").localeCompare(b.workstream || "");
    });

    return sorted.filter((stream) => {
      if (riskFilter === "critical" && stream.risk !== "critical") {
        return false;
      }
      if (riskFilter === "warn" && stream.risk !== "warn") {
        return false;
      }
      if (riskFilter === "ok" && stream.risk !== "ok") {
        return false;
      }
      if (riskFilter === "active" && !isActiveStream(stream)) {
        return false;
      }
      if (normalizedSearch) {
        const haystack = `${stream.workstream} ${stream.top_task_id}`.toLowerCase();
        return haystack.includes(normalizedSearch);
      }
      return true;
    });
  }, [riskFilter, search, streams]);

  const visibleStreams = expanded ? filteredStreams : filteredStreams.slice(0, 12);

  return (
    <section className="mc2-panel" data-testid="mc2-stream-board">
      <div className="mc2-panel-head">
        <h2>Stream Progress Lanes</h2>
        <div className="mc2-inline-actions">
          <span className="mc2-chip mc2-chip-subtle">{openBacklogTotal} open backlog</span>
          <span className="mc2-chip mc2-chip-subtle">{streams.length} workstreams</span>
        </div>
      </div>
      <p className="mc2-stream-legend">
        Each stream card shows queued, in progress, blocked, failed, and completed counts.
      </p>

      <div className="mc2-stream-controls">
        <div className="mc2-stream-filter-row">
          {RISK_FILTERS.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className="mc2-chip mc2-chip-subtle"
              data-active={riskFilter === filter.key}
              onClick={() => setRiskFilter(filter.key)}
            >
              {filter.label}
            </button>
          ))}
        </div>
        <div className="mc2-stream-search-row">
          <input
            className="mc2-stream-search"
            type="search"
            value={search}
            placeholder="Search stream or task..."
            onChange={(event) => setSearch(event.target.value)}
          />
          <button
            type="button"
            className="mc2-btn mc2-btn-subtle"
            onClick={() => setExpanded((previous) => !previous)}
            disabled={filteredStreams.length <= 12}
          >
            {expanded ? "Collapse" : "Show all"}
          </button>
        </div>
      </div>

      <div className="mc2-stream-grid">
        {filteredStreams.length === 0 ? <p className="mc2-muted">No stream data available for this filter.</p> : null}
        {visibleStreams.map((stream) => (
          <button
            key={stream.workstream}
            className="mc2-stream-card mc2-stream-card-btn"
            type="button"
            onClick={() => stream.top_task_id && onSelectTask(stream.top_task_id)}
            disabled={!stream.top_task_id}
          >
            <div className="mc2-stream-head">
              <h3 className="mc2-stream-title">{stream.workstream || "Unassigned"}</h3>
            </div>

            <div className="mc2-stream-badges">
              <span className="mc2-chip mc2-chip-subtle">
                backlog {stream.queued + stream.in_progress + stream.blocked + stream.failed}
              </span>
              <span className={riskClass(stream.risk)}>{stream.risk}</span>
            </div>

            <div className="mc2-stream-metrics-grid">
              <div className="mc2-stream-stat">
                <p>Queued</p>
                <strong>{stream.queued}</strong>
              </div>
              <div className="mc2-stream-stat">
                <p>In Progress</p>
                <strong>{stream.in_progress}</strong>
              </div>
              <div className="mc2-stream-stat">
                <p>Blocked</p>
                <strong>{stream.blocked}</strong>
              </div>
              <div className="mc2-stream-stat">
                <p>Failed</p>
                <strong>{stream.failed}</strong>
              </div>
              <div className="mc2-stream-stat">
                <p>Completed</p>
                <strong>{stream.completed}</strong>
              </div>
            </div>

            {stream.top_task_id ? (
              <p className="mc2-inline-link">Focus task: {stream.top_task_id}</p>
            ) : (
              <p className="mc2-muted">No focus task</p>
            )}
          </button>
        ))}
      </div>
    </section>
  );
}
