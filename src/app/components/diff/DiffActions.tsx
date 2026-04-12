import { useMemo } from "react";
import { Check, X, ChevronDown } from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "../ui/tabs";
import { cn } from "../ui/utils";
import type { DiffFile } from "./DiffParser";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type DiffViewMode = "unified" | "side-by-side";

export interface DiffActionsProps {
  files: DiffFile[];
  selectedFileIndex: number;
  onSelectFile: (index: number) => void;
  viewMode: DiffViewMode;
  onViewModeChange: (mode: DiffViewMode) => void;
  decisions: Map<number, "accept" | "reject">;
  totalHunkCount: number;
  onAcceptAll: () => void;
  onRejectAll: () => void;
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

export function DiffActions({
  files,
  selectedFileIndex,
  onSelectFile,
  viewMode,
  onViewModeChange,
  decisions,
  totalHunkCount,
  onAcceptAll,
  onRejectAll,
}: DiffActionsProps) {
  const acceptedCount = useMemo(() => {
    let count = 0;
    for (const [, decision] of decisions) {
      if (decision === "accept") count++;
    }
    return count;
  }, [decisions]);

  const rejectedCount = useMemo(() => {
    let count = 0;
    for (const [, decision] of decisions) {
      if (decision === "reject") count++;
    }
    return count;
  }, [decisions]);

  const selectedFile = files[selectedFileIndex] ?? null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/6 bg-[#0a0a0c] px-4 py-2.5">
      {/* Left: file selector + hunk count */}
      <div className="flex items-center gap-3 min-w-0">
        {/* File selector */}
        {files.length > 1 ? (
          <div className="relative">
            <select
              value={selectedFileIndex}
              onChange={(e) => onSelectFile(Number(e.target.value))}
              className="appearance-none rounded-lg border border-white/10 bg-white/[0.03] py-1 pl-2.5 pr-7 font-mono text-xs text-zinc-200 outline-none transition hover:bg-white/[0.08] focus:border-white/20"
              aria-label="Select file"
            >
              {files.map((file, idx) => (
                <option key={idx} value={idx} className="bg-zinc-900 text-zinc-200">
                  {file.newPath}
                </option>
              ))}
            </select>
            <ChevronDown className="pointer-events-none absolute right-2 top-1/2 h-3 w-3 -translate-y-1/2 text-zinc-500" />
          </div>
        ) : selectedFile ? (
          <span className="truncate font-mono text-xs text-zinc-300">
            {selectedFile.newPath}
          </span>
        ) : null}

        {/* Hunk counter */}
        <span className="text-[11px] text-zinc-500 whitespace-nowrap" data-testid="hunk-counter">
          {acceptedCount} of {totalHunkCount} hunks accepted
          {rejectedCount > 0 && (
            <span className="text-rose-400/70"> ({rejectedCount} rejected)</span>
          )}
        </span>
      </div>

      {/* Right: view toggle + bulk actions */}
      <div className="flex items-center gap-2">
        {/* View mode toggle */}
        <Tabs
          value={viewMode}
          onValueChange={(v) => onViewModeChange(v as DiffViewMode)}
          className="flex-none"
        >
          <TabsList className="h-7 bg-white/[0.04] border border-white/6 rounded-lg p-0.5">
            <TabsTrigger
              value="unified"
              className={cn(
                "h-6 rounded-md px-2 text-[10px] uppercase tracking-[0.12em] font-medium transition",
                "data-[state=active]:bg-white/10 data-[state=active]:text-white",
                "data-[state=inactive]:text-zinc-500 data-[state=inactive]:hover:text-zinc-300"
              )}
            >
              Unified
            </TabsTrigger>
            <TabsTrigger
              value="side-by-side"
              className={cn(
                "h-6 rounded-md px-2 text-[10px] uppercase tracking-[0.12em] font-medium transition",
                "data-[state=active]:bg-white/10 data-[state=active]:text-white",
                "data-[state=inactive]:text-zinc-500 data-[state=inactive]:hover:text-zinc-300"
              )}
            >
              Split
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {/* Bulk actions */}
        <button
          type="button"
          onClick={onAcceptAll}
          className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-500/20 bg-emerald-500/8 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-emerald-300 transition hover:bg-emerald-500/14"
          data-testid="accept-all-btn"
        >
          <Check className="h-3 w-3" />
          Accept All
        </button>
        <button
          type="button"
          onClick={onRejectAll}
          className="inline-flex items-center gap-1.5 rounded-lg border border-rose-500/20 bg-rose-500/8 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-rose-300 transition hover:bg-rose-500/14"
          data-testid="reject-all-btn"
        >
          <X className="h-3 w-3" />
          Reject All
        </button>
      </div>
    </div>
  );
}
