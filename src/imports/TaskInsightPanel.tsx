"use client";

import type { ReactNode } from "react";
import type { TaskSpotlight } from "@/types/mission-control";
import {
  asNumber,
  extractLatestDiff,
  extractTouchedFiles,
  normalizeTokenUsage,
} from "./missionArtifactUtils";

interface TaskInsightPanelProps {
  spotlight: TaskSpotlight | null;
}

type DiffLineKind = "meta" | "hunk" | "add" | "del" | "context";

function compactTimestamp(value: string): string {
  const stamp = value ? new Date(value) : null;
  if (!stamp || Number.isNaN(stamp.getTime())) {
    return value || "n/a";
  }
  return stamp.toLocaleString();
}

function formatCount(value: number): string {
  return new Intl.NumberFormat().format(Math.max(0, Math.floor(value)));
}

function classifyDiffLine(line: string): DiffLineKind {
  if (
    line.startsWith("diff --git ") ||
    line.startsWith("index ") ||
    line.startsWith("--- ") ||
    line.startsWith("+++ ")
  ) {
    return "meta";
  }
  if (line.startsWith("@@")) {
    return "hunk";
  }
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "add";
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "del";
  }
  return "context";
}

function renderMetaListText(text: string): ReactNode {
  const match = text.match(/^([A-Za-z][A-Za-z0-9 ()/_-]{1,40}):\s*(.+)$/);
  if (!match) {
    return text;
  }
  return (
    <>
      <strong>{match[1]}:</strong> {match[2]}
    </>
  );
}

function renderMarkdownSummary(markdown: string): ReactNode {
  const lines = markdown.replace(/\r\n/g, "\n").split("\n");
  const nodes: ReactNode[] = [];
  let paragraph: string[] = [];
  let listItems: string[] = [];
  let inCodeBlock = false;
  let codeLanguage = "";
  let codeLines: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) {
      return;
    }
    nodes.push(
      <p key={`p-${nodes.length}`} className="mc2-summary-paragraph">
        {paragraph.join(" ")}
      </p>
    );
    paragraph = [];
  };

  const flushList = () => {
    if (listItems.length === 0) {
      return;
    }
    nodes.push(
      <ul key={`ul-${nodes.length}`} className="mc2-summary-list">
        {listItems.map((item, index) => (
          <li key={`li-${nodes.length}-${index}`}>{renderMetaListText(item)}</li>
        ))}
      </ul>
    );
    listItems = [];
  };

  const flushCode = () => {
    if (codeLines.length === 0) {
      return;
    }
    nodes.push(
      <pre key={`code-${nodes.length}`} className="mc2-summary-code">
        <code>{codeLines.join("\n")}</code>
      </pre>
    );
    codeLines = [];
    codeLanguage = "";
  };

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.startsWith("```")) {
      if (!inCodeBlock) {
        flushParagraph();
        flushList();
        inCodeBlock = true;
        codeLanguage = trimmed.replace("```", "").trim().toLowerCase();
      } else {
        flushCode();
        inCodeBlock = false;
      }
      continue;
    }

    if (inCodeBlock) {
      if (codeLanguage === "text" && codeLines.length > 120) {
        continue;
      }
      codeLines.push(line);
      continue;
    }

    const headingMatch = line.match(/^(#{1,3})\s+(.+)$/);
    if (headingMatch) {
      flushParagraph();
      flushList();
      const level = headingMatch[1].length;
      const content = headingMatch[2].trim();
      const key = `h-${nodes.length}`;
      if (level === 1) {
        nodes.push(
          <h3 key={key} className="mc2-summary-h1">
            {content}
          </h3>
        );
      } else if (level === 2) {
        nodes.push(
          <h4 key={key} className="mc2-summary-h2">
            {content}
          </h4>
        );
      } else {
        nodes.push(
          <h5 key={key} className="mc2-summary-h3">
            {content}
          </h5>
        );
      }
      continue;
    }

    if (/^\s*-\s+/.test(line)) {
      flushParagraph();
      listItems.push(line.replace(/^\s*-\s+/, "").trim());
      continue;
    }

    if (!trimmed) {
      flushParagraph();
      flushList();
      continue;
    }

    paragraph.push(trimmed);
  }

  if (inCodeBlock) {
    flushCode();
  }
  flushParagraph();
  flushList();

  if (nodes.length === 0) {
    return <p className="mc2-muted">No markdown summary available yet.</p>;
  }
  return nodes;
}

export function TaskInsightPanel({ spotlight }: TaskInsightPanelProps) {
  if (!spotlight) {
    return (
      <section className="mc2-panel" data-testid="mc2-task-insight">
        <div className="mc2-panel-head">
          <h2>Task Insight Report</h2>
        </div>
        <p className="mc2-muted">Select a task to view artifact summary, files changed, diffs, and lifecycle details.</p>
      </section>
    );
  }

  const payload = (spotlight.latest_artifact?.payload ?? {}) as Record<string, unknown>;
  const outcome = ((payload.outcome ?? {}) as Record<string, unknown>);
  const runtimeConfig = ((payload.runtime_config ?? {}) as Record<string, unknown>);
  const llmOutputs = Array.isArray(payload.llm_outputs)
    ? payload.llm_outputs.filter((item): item is string => typeof item === "string")
    : [];

  const tokenUsage = normalizeTokenUsage(outcome.token_usage);
  const workerId = asNumber(outcome.worker_id);
  const success = outcome.success === true;
  const failureCode = String(outcome.failure_code || spotlight.failure.code || "").trim();
  const failureMessage = String(outcome.error || spotlight.failure.error || "").trim();
  const workspacePath = String(outcome.workspace_path || "");
  const branchName = String(outcome.branch_name || "");
  const attempts = asNumber(outcome.attempts);
  const patchesApplied = asNumber(outcome.patches_applied);
  const diffPreview = extractLatestDiff(llmOutputs);
  const diffLines = diffPreview ? diffPreview.split("\n") : [];
  const touchedFiles = extractTouchedFiles(diffPreview);
  const diffStats = diffLines.reduce(
    (summary, line) => {
      const kind = classifyDiffLine(line);
      if (kind === "add") {
        summary.additions += 1;
      } else if (kind === "del") {
        summary.deletions += 1;
      }
      return summary;
    },
    { additions: 0, deletions: 0 }
  );
  const lifecycleEvents = [...spotlight.lifecycle.events].slice(-10).reverse();
  const markdownSummary = spotlight.latest_artifact?.markdown_summary || "No markdown summary available yet.";
  const graphragEnabled = runtimeConfig.use_codebase_graphrag === true;

  return (
    <section className="mc2-panel mc2-insight" data-testid="mc2-task-insight">
      <div className="mc2-panel-head">
        <h2>Task Insight Report</h2>
        <span className="mc2-chip mc2-chip-subtle">{spotlight.task_id}</span>
      </div>

      <div className="mc2-insight-grid">
        <article className="mc2-insight-card">
          <p>Attempts</p>
          <h3>{attempts}</h3>
        </article>
        <article className="mc2-insight-card">
          <p>Patches Applied</p>
          <h3>{patchesApplied}</h3>
        </article>
        <article className="mc2-insight-card">
          <p>LLM Outputs</p>
          <h3>{spotlight.latest_artifact?.llm_output_count ?? 0}</h3>
        </article>
        <article className="mc2-insight-card">
          <p>Tokens (Total)</p>
          <h3>{formatCount(tokenUsage.total_tokens || 0)}</h3>
        </article>
        <article className="mc2-insight-card">
          <p>Worker</p>
          <h3>
            {workerId || "-"}
          </h3>
        </article>
        <article className="mc2-insight-card">
          <p>Status</p>
          <h3>{success ? "success" : "failed"}</h3>
        </article>
      </div>

      <div className="mc2-outcome-banner" data-state={success ? "success" : "failed"}>
        <span className={`mc2-chip ${success ? "mc2-chip-ok" : "mc2-chip-stop"}`}>{success ? "Success" : "Failed"}</span>
        {failureCode ? <span className="mc2-chip mc2-chip-subtle">{failureCode}</span> : null}
        <span className="mc2-chip mc2-chip-subtle">worker {workerId || "-"}</span>
        <span className="mc2-chip mc2-chip-subtle">attempts {attempts}</span>
        <span className="mc2-chip mc2-chip-subtle">patches {patchesApplied}</span>
      </div>
      {failureMessage ? <p className="mc2-inline-alert mc2-inline-alert-error">{failureMessage}</p> : null}

      <details className="mc2-report-section" open>
        <summary>Recent Progress Events</summary>
        {lifecycleEvents.length === 0 ? <p className="mc2-muted">No lifecycle events available.</p> : null}
        <div className="mc2-event-list">
          {lifecycleEvents.map((event, index) => (
            <article key={`${event.timestamp}-${index}`} className="mc2-event-item">
              <div className="mc2-event-head">
                <span className="mc2-chip mc2-chip-subtle">{event.severity}</span>
                <time>{compactTimestamp(event.timestamp)}</time>
              </div>
              <p className="mc2-event-msg">{event.message}</p>
            </article>
          ))}
        </div>
      </details>

      <details className="mc2-report-section" open>
        <summary>Files Updated</summary>
        {touchedFiles.length === 0 ? (
          <p className="mc2-muted">No file paths parsed from the latest diff payload.</p>
        ) : (
          <div className="mc2-insight-files">
            {touchedFiles.map((file) => (
              <code key={file}>{file}</code>
            ))}
          </div>
        )}
      </details>

      <details className="mc2-report-section">
        <summary>Task Diagnostics</summary>
        <div className="mc2-report-toolbar">
          <span className="mc2-chip mc2-chip-subtle">
            token in/out {formatCount(tokenUsage.input_tokens)} / {formatCount(tokenUsage.output_tokens)}
          </span>
          <span className="mc2-chip mc2-chip-subtle">graphrag {graphragEnabled ? "enabled" : "off"}</span>
        </div>
        {(workspacePath || branchName) ? (
          <div className="mc2-insight-meta-strip">
            {branchName ? <code>branch: {branchName}</code> : null}
            {workspacePath ? <code>workspace: {workspacePath}</code> : null}
          </div>
        ) : (
          <p className="mc2-muted">No branch/workspace metadata recorded for this artifact.</p>
        )}
      </details>

      <details className="mc2-report-section">
        <summary>Patch Preview</summary>
        <div className="mc2-report-toolbar">
          <span className="mc2-chip mc2-chip-subtle">files {formatCount(touchedFiles.length)}</span>
          <span className="mc2-chip mc2-chip-subtle">+{formatCount(diffStats.additions)}</span>
          <span className="mc2-chip mc2-chip-subtle">-{formatCount(diffStats.deletions)}</span>
        </div>
        {diffLines.length === 0 ? (
          <p className="mc2-muted">No diff content available.</p>
        ) : (
          <div className="mc2-diff-view">
            {diffLines.map((line, index) => {
              const kind = classifyDiffLine(line);
              return (
                <div key={`diff-${index}`} className={`mc2-diff-line mc2-diff-${kind}`}>
                  <span className="mc2-diff-ln">{index + 1}</span>
                  <code className="mc2-diff-content">{line || " "}</code>
                </div>
              );
            })}
          </div>
        )}
      </details>

      <details className="mc2-report-section">
        <summary>Run Summary</summary>
        <div className="mc2-summary-render">{renderMarkdownSummary(markdownSummary)}</div>
      </details>
    </section>
  );
}
