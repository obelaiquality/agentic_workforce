"use client";

import type { MissionChangeBrief } from "@/types/mission-control";

interface ChangeBriefStripProps {
  briefs: MissionChangeBrief[];
  onSelectTask: (taskId: string) => void;
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(Math.max(0, Math.floor(value)));
}

function formatStamp(raw: string): string {
  if (!raw) {
    return "n/a";
  }
  const stamp = new Date(raw);
  if (Number.isNaN(stamp.getTime())) {
    return raw;
  }
  return stamp.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
}

function statusClass(status: MissionChangeBrief["status"]): string {
  if (status === "success") {
    return "mc2-chip mc2-chip-ok";
  }
  if (status === "failed") {
    return "mc2-chip mc2-chip-stop";
  }
  return "mc2-chip mc2-chip-warn";
}

function statusLabel(status: MissionChangeBrief["status"]): string {
  if (status === "success") {
    return "Applied";
  }
  if (status === "failed") {
    return "Needs Fix";
  }
  return "Active";
}

function statusRank(status: MissionChangeBrief["status"]): number {
  if (status === "failed") {
    return 0;
  }
  if (status === "active") {
    return 1;
  }
  return 2;
}

function friendlySummary(summary: string): string {
  const trimmed = summary.trim();
  if (!trimmed) {
    return "No summary yet. Open Task Insight for full run details.";
  }
  if (trimmed.startsWith("[NO_DIFF]")) {
    return "No code change was produced in the last attempt. This task likely needs tighter guidance or narrower scope.";
  }
  if (trimmed.startsWith("[PATCH_APPLY_FAIL]")) {
    return "Patch generation succeeded, but apply failed due to file context mismatch. Regenerate against latest file state.";
  }
  if (trimmed.startsWith("[VERIFY_FAIL]")) {
    return "Patch applied, but verification checks failed. Inspect failing checks before retrying.";
  }
  if (trimmed.startsWith("[MALFORMED_PATCH]")) {
    return "Model output was not a valid patch format. Retry with stricter patch formatting guidance.";
  }
  if (trimmed.startsWith("[LLM_TIMEOUT]")) {
    return "Model request timed out. Reduce patch scope or increase timeout for this task.";
  }
  return trimmed.replace(/^\[[A-Z_]+\]\s*/i, "");
}

export function ChangeBriefStrip({ briefs, onSelectTask }: ChangeBriefStripProps) {
  const orderedBriefs = [...briefs].sort((a, b) => {
    const rank = statusRank(a.status) - statusRank(b.status);
    if (rank !== 0) {
      return rank;
    }
    return b.generated_at.localeCompare(a.generated_at);
  });

  const appliedCount = orderedBriefs.filter((item) => item.status === "success").length;
  const activeCount = orderedBriefs.filter((item) => item.status === "active").length;
  const needsFixCount = orderedBriefs.filter((item) => item.status === "failed").length;

  return (
    <section className="mc2-panel" data-testid="mc2-change-briefs">
      <div className="mc2-panel-head">
        <h2>AI Change Briefs</h2>
        <span className="mc2-chip mc2-chip-subtle">latest code-change summaries</span>
      </div>
      <p className="mc2-muted">
        Plain-language summaries of recent task changes derived from run artifacts, diff content, and LLM output.
      </p>
      <div className="mc2-brief-counts">
        <span className="mc2-chip mc2-chip-ok">Applied {appliedCount}</span>
        <span className="mc2-chip mc2-chip-warn">Active {activeCount}</span>
        <span className="mc2-chip mc2-chip-stop">Needs Fix {needsFixCount}</span>
      </div>

      {orderedBriefs.length === 0 ? (
        <p className="mc2-muted">No recent patch artifacts found for this run yet.</p>
      ) : (
        <div className="mc2-brief-grid">
          {orderedBriefs.map((brief) => (
            <article key={brief.task_id} className="mc2-brief-card">
              <div className="mc2-brief-head">
                <div>
                  <p className="mc2-brief-id">{brief.task_id}</p>
                  <h3>{brief.title}</h3>
                </div>
                <span className={statusClass(brief.status)}>{statusLabel(brief.status)}</span>
              </div>

              <div className="mc2-brief-summary-panel">
                <p className="mc2-brief-summary">{friendlySummary(brief.summary)}</p>
              </div>

              <div className="mc2-brief-metrics">
                <div>
                  <p>Patches</p>
                  <strong>{formatCount(brief.patches_applied)}</strong>
                </div>
                <div>
                  <p>Tokens</p>
                  <strong>{formatCount(brief.token_total)}</strong>
                </div>
                <div>
                  <p>Worker</p>
                  <strong>{brief.worker_id ?? "-"}</strong>
                </div>
                <div>
                  <p>Updated</p>
                  <strong>{formatStamp(brief.generated_at)}</strong>
                </div>
              </div>

              <div className="mc2-brief-files">
                {brief.files.length === 0 ? (
                  <span className="mc2-chip mc2-chip-subtle">No file list</span>
                ) : (
                  <>
                    {brief.files.slice(0, 2).map((path) => (
                      <code key={path}>{path}</code>
                    ))}
                    {brief.files.length > 2 ? <span className="mc2-chip mc2-chip-subtle">+{brief.files.length - 2} more</span> : null}
                  </>
                )}
              </div>

              <button className="mc2-btn mc2-btn-subtle" type="button" onClick={() => onSelectTask(brief.task_id)}>
                Open Task Insight
              </button>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
