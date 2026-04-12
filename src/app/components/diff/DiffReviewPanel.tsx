import { useCallback, useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronDown, ChevronUp, FileCode2, GitMerge } from "lucide-react";
import { cn } from "../ui/utils";
import { getMissionCodeFileDiffV8 } from "../../lib/apiClient";
import { parseDiff, applyHunkDecisions } from "./DiffParser";
import type { DiffFile } from "./DiffParser";
import { DiffActions, type DiffViewMode } from "./DiffActions";
import { UnifiedDiffView } from "./UnifiedDiffView";
import { SideBySideDiffView } from "./SideBySideDiffView";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface HunkDecisionMap {
  /** keyed by "filePath::hunkIndex" */
  [key: string]: "accept" | "reject";
}

export interface DiffReviewDecisions {
  decisions: HunkDecisionMap;
  filesReviewed: number;
  totalFiles: number;
  hunksAccepted: number;
  hunksRejected: number;
  totalHunks: number;
}

export interface DiffReviewPanelProps {
  projectId: string;
  changedFiles: string[];
  onDecisionsChange?: (decisions: DiffReviewDecisions) => void;
  onApply?: (decisions: DiffReviewDecisions) => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DiffReviewPanel({
  projectId,
  changedFiles,
  onDecisionsChange,
  onApply,
}: DiffReviewPanelProps) {
  const [expanded, setExpanded] = useState(true);
  const [selectedFileIndex, setSelectedFileIndex] = useState(0);
  const [viewMode, setViewMode] = useState<DiffViewMode>("unified");
  // Keyed by "filePath::hunkIndex"
  const [decisions, setDecisions] = useState<Map<string, "accept" | "reject">>(new Map());

  // Fetch diff for the selected file
  const selectedFilePath = changedFiles[selectedFileIndex] ?? null;

  const diffQuery = useQuery({
    queryKey: ["diff-review", projectId, selectedFilePath],
    queryFn: () => getMissionCodeFileDiffV8(projectId, selectedFilePath!),
    enabled: Boolean(selectedFilePath),
    staleTime: 30_000,
  });

  const parsedFiles = useMemo<DiffFile[]>(() => {
    if (!diffQuery.data?.item?.patch) return [];
    return parseDiff(diffQuery.data.item.patch);
  }, [diffQuery.data]);

  // We show one file at a time from the changedFiles list
  const currentFile = parsedFiles[0] ?? null;

  // Build a decisions Map<number, decision> scoped to the current file
  const fileDecisions = useMemo(() => {
    const map = new Map<number, "accept" | "reject">();
    if (!selectedFilePath || !currentFile) return map;
    for (const [key, decision] of decisions) {
      const [filePath, hunkIndexStr] = key.split("::");
      if (filePath === selectedFilePath) {
        map.set(parseInt(hunkIndexStr, 10), decision);
      }
    }
    return map;
  }, [decisions, selectedFilePath, currentFile]);

  const totalHunkCount = currentFile?.hunks.length ?? 0;

  // Compute the aggregate summary across all files
  const summary = useMemo<DiffReviewDecisions>(() => {
    let hunksAccepted = 0;
    let hunksRejected = 0;
    let totalHunks = 0;
    const filesWithDecisions = new Set<string>();

    for (const [key, decision] of decisions) {
      const [filePath] = key.split("::");
      filesWithDecisions.add(filePath);
      if (decision === "accept") hunksAccepted++;
      if (decision === "reject") hunksRejected++;
    }

    // Count total hunks across all fetched diffs (approximate with decisions count + undecided)
    totalHunks = decisions.size; // will grow as files are visited

    const decisionMap: HunkDecisionMap = {};
    for (const [key, decision] of decisions) {
      decisionMap[key] = decision;
    }

    return {
      decisions: decisionMap,
      filesReviewed: filesWithDecisions.size,
      totalFiles: changedFiles.length,
      hunksAccepted,
      hunksRejected,
      totalHunks,
    };
  }, [decisions, changedFiles.length]);

  // Emit decisions on change
  useEffect(() => {
    onDecisionsChange?.(summary);
  }, [summary, onDecisionsChange]);

  const handleDecide = useCallback(
    (hunkIndex: number, decision: "accept" | "reject") => {
      if (!selectedFilePath) return;
      setDecisions((prev) => {
        const next = new Map(prev);
        const key = `${selectedFilePath}::${hunkIndex}`;
        // Toggle off if clicking same decision
        if (next.get(key) === decision) {
          next.delete(key);
        } else {
          next.set(key, decision);
        }
        return next;
      });
    },
    [selectedFilePath]
  );

  const handleAcceptAll = useCallback(() => {
    if (!selectedFilePath || !currentFile) return;
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const hunk of currentFile.hunks) {
        next.set(`${selectedFilePath}::${hunk.index}`, "accept");
      }
      return next;
    });
  }, [selectedFilePath, currentFile]);

  const handleRejectAll = useCallback(() => {
    if (!selectedFilePath || !currentFile) return;
    setDecisions((prev) => {
      const next = new Map(prev);
      for (const hunk of currentFile.hunks) {
        next.set(`${selectedFilePath}::${hunk.index}`, "reject");
      }
      return next;
    });
  }, [selectedFilePath, currentFile]);

  const handleApply = useCallback(() => {
    onApply?.(summary);
  }, [onApply, summary]);

  // Build a fake DiffFile[] for the file selector in DiffActions
  const fileSelectorEntries = useMemo<DiffFile[]>(() => {
    return changedFiles.map((fp) => ({
      oldPath: fp,
      newPath: fp,
      status: "modified" as const,
      hunks: [],
      additions: 0,
      deletions: 0,
    }));
  }, [changedFiles]);

  if (changedFiles.length === 0) return null;

  return (
    <div className="rounded-xl border border-white/6 bg-black/20 overflow-hidden" data-testid="diff-review-panel">
      {/* Collapsible header (ExpandableSection pattern) */}
      <button
        onClick={() => setExpanded(!expanded)}
        className="w-full flex items-center justify-between px-4 py-3 hover:bg-white/[0.02] transition-colors"
      >
        <div className="flex items-center gap-2">
          <GitMerge className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-medium text-zinc-200">Diff Review</span>
          <span className="text-xs text-zinc-500 font-mono">
            {changedFiles.length} file{changedFiles.length !== 1 ? "s" : ""}
          </span>
        </div>
        {expanded ? (
          <ChevronUp className="h-4 w-4 text-zinc-500" />
        ) : (
          <ChevronDown className="h-4 w-4 text-zinc-500" />
        )}
      </button>

      {expanded && (
        <div className="space-y-3 px-4 pb-4">
          {/* Toolbar */}
          <DiffActions
            files={fileSelectorEntries}
            selectedFileIndex={selectedFileIndex}
            onSelectFile={setSelectedFileIndex}
            viewMode={viewMode}
            onViewModeChange={setViewMode}
            decisions={fileDecisions}
            totalHunkCount={totalHunkCount}
            onAcceptAll={handleAcceptAll}
            onRejectAll={handleRejectAll}
          />

          {/* Diff content */}
          {diffQuery.isLoading ? (
            <div className="flex items-center justify-center py-8">
              <div className="flex items-center gap-2 text-sm text-zinc-400">
                <FileCode2 className="h-4 w-4 animate-pulse" />
                Loading diff...
              </div>
            </div>
          ) : diffQuery.isError ? (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 px-4 py-3 text-sm text-rose-300">
              Failed to load diff: {diffQuery.error instanceof Error ? diffQuery.error.message : "Unknown error"}
            </div>
          ) : currentFile ? (
            viewMode === "unified" ? (
              <UnifiedDiffView
                file={currentFile}
                decisions={fileDecisions}
                onDecide={handleDecide}
              />
            ) : (
              <SideBySideDiffView
                file={currentFile}
                decisions={fileDecisions}
                onDecide={handleDecide}
              />
            )
          ) : (
            <div className="rounded-xl border border-white/6 bg-black/10 px-4 py-8 text-center text-sm text-zinc-500">
              No diff available for this file.
            </div>
          )}

          {/* Summary footer */}
          <div className="flex items-center justify-between gap-3 rounded-xl border border-white/6 bg-[#0a0a0c] px-4 py-2.5">
            <div className="flex items-center gap-4 text-[11px] text-zinc-400">
              <span>
                <span className="text-zinc-200">{summary.filesReviewed}</span> / {summary.totalFiles} files reviewed
              </span>
              {summary.hunksAccepted > 0 && (
                <span className="text-emerald-400">{summary.hunksAccepted} accepted</span>
              )}
              {summary.hunksRejected > 0 && (
                <span className="text-rose-400">{summary.hunksRejected} rejected</span>
              )}
            </div>
            <button
              type="button"
              onClick={handleApply}
              disabled={summary.hunksAccepted === 0 && summary.hunksRejected === 0}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[10px] font-medium uppercase tracking-[0.14em] transition",
                summary.hunksAccepted > 0 || summary.hunksRejected > 0
                  ? "border border-cyan-500/20 bg-cyan-500/8 text-cyan-200 hover:bg-cyan-500/14"
                  : "border border-white/6 bg-white/[0.03] text-zinc-500 cursor-not-allowed"
              )}
            >
              Apply Changes
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
