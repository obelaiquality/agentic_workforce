import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronRight, FileCode2, FolderTree } from "lucide-react";
import type { CodebaseTreeNode } from "../../../shared/contracts";
import { getMissionCodeFileV8, getMissionCodebaseTreeV8 } from "../../lib/apiClient";

const STATUS_COLOR = {
  modified: "text-amber-400",
  added: "text-emerald-400",
  deleted: "text-rose-400",
  unchanged: "text-zinc-500",
};

const STATUS_BADGE = {
  modified: "bg-amber-500/10 text-amber-400",
  added: "bg-emerald-500/10 text-emerald-400",
  deleted: "bg-rose-500/10 text-rose-400",
  unchanged: "bg-zinc-800 text-zinc-500",
};

const STATUS_ICON = {
  modified: "M",
  added: "A",
  deleted: "D",
  unchanged: "·",
};

function flattenFiles(nodes: CodebaseTreeNode[]): Array<CodebaseTreeNode & { depth: number }> {
  const output: Array<CodebaseTreeNode & { depth: number }> = [];

  function walk(items: CodebaseTreeNode[], depth: number) {
    for (const item of items) {
      output.push({ ...item, depth });
      if (item.kind === "directory" && item.children?.length) {
        walk(item.children, depth + 1);
      }
    }
  }

  walk(nodes, 0);
  return output;
}

function firstFilePath(nodes: CodebaseTreeNode[]): string | null {
  for (const node of nodes) {
    if (node.kind === "file") {
      return node.path;
    }
    if (node.children?.length) {
      const nested = firstFilePath(node.children);
      if (nested) return nested;
    }
  }
  return null;
}

export function CodebaseView({ repoId }: { repoId: string | null }) {
  const [selectedPath, setSelectedPath] = useState<string | null>(null);
  const [filter, setFilter] = useState<"all" | "modified" | "added" | "unchanged" | "deleted">("all");

  const treeQuery = useQuery({
    queryKey: ["mission-codebase-tree-v8", repoId],
    queryFn: () => getMissionCodebaseTreeV8(repoId!),
    enabled: Boolean(repoId),
    staleTime: 3000,
  });

  const tree = treeQuery.data?.items ?? [];
  const flattened = useMemo(() => flattenFiles(tree), [tree]);
  const fileNodes = useMemo(() => flattened.filter((node) => node.kind === "file"), [flattened]);

  useEffect(() => {
    if (!selectedPath && tree.length > 0) {
      setSelectedPath(firstFilePath(tree));
    }
  }, [selectedPath, tree]);

  useEffect(() => {
    if (selectedPath && !fileNodes.some((node) => node.path === selectedPath)) {
      setSelectedPath(firstFilePath(tree));
    }
  }, [fileNodes, selectedPath, tree]);

  const filtered = useMemo(
    () =>
      fileNodes.filter((node) => {
        if (filter === "all") return true;
        return (node.status || "unchanged") === filter;
      }),
    [fileNodes, filter]
  );

  const fileQuery = useQuery({
    queryKey: ["mission-codebase-file-v8", repoId, selectedPath],
    queryFn: () => getMissionCodeFileV8(repoId!, selectedPath!),
    enabled: Boolean(repoId && selectedPath),
    staleTime: 3000,
  });

  const file = fileQuery.data?.item ?? null;
  const modCount = fileNodes.filter((node) => (node.status || "unchanged") === "modified").length;
  const addCount = fileNodes.filter((node) => (node.status || "unchanged") === "added").length;

  if (!repoId) {
    return (
      <div className="rounded-xl border border-dashed border-white/10 p-6 text-sm text-zinc-500">
        Connect a repo to inspect its code graph and managed worktree.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div className="flex items-center gap-1.5 text-xs text-zinc-400">
          <span className="text-amber-400 font-mono">{modCount} modified</span>
          <span className="text-zinc-700">·</span>
          <span className="text-emerald-400 font-mono">{addCount} added</span>
          <span className="text-zinc-700">·</span>
          <span className="text-zinc-500 font-mono">{fileNodes.length} total</span>
        </div>
        <div className="flex gap-1 ml-auto">
          {(["all", "modified", "added", "unchanged", "deleted"] as const).map((status) => (
            <button
              key={status}
              onClick={() => setFilter(status)}
              className={`text-[10px] px-2 py-1 rounded border capitalize transition-colors ${
                filter === status
                  ? "bg-zinc-800 text-zinc-200 border-zinc-600"
                  : "text-zinc-500 border-transparent hover:text-zinc-300"
              }`}
            >
              {status}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-4" style={{ minHeight: 500 }}>
        <div className="w-72 shrink-0 bg-[#121214] border border-white/8 rounded-xl overflow-hidden flex flex-col">
          <div className="px-3 py-2.5 border-b border-white/5 text-[10px] text-zinc-500 uppercase tracking-wide font-medium flex items-center gap-2">
            <FolderTree className="w-3.5 h-3.5 text-cyan-400" />
            Files
          </div>
          <div className="flex-1 overflow-y-auto custom-scrollbar p-2">
            {treeQuery.isLoading ? (
              <div className="p-3 text-xs text-zinc-500">Loading codebase…</div>
            ) : filtered.length === 0 ? (
              <div className="p-3 text-xs text-zinc-500">No files match the current filter.</div>
            ) : (
              filtered.map((node) => {
                const isSelected = selectedPath === node.path;
                const filename = node.path.split("/").pop()!;
                const status = node.status || "unchanged";
                return (
                  <button
                    key={node.path}
                    onClick={() => setSelectedPath(node.path)}
                    className={`w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left transition-colors group ${
                      isSelected ? "bg-purple-500/10 border border-purple-500/20" : "hover:bg-white/[0.04]"
                    }`}
                    style={{ paddingLeft: `${12 + node.depth * 12}px` }}
                  >
                    <ChevronRight className="w-3 h-3 text-zinc-700 shrink-0" />
                    <span className={`text-[9px] font-mono font-bold w-3 shrink-0 ${STATUS_COLOR[status]}`}>{STATUS_ICON[status]}</span>
                    <span className={`text-[11px] truncate ${isSelected ? "text-zinc-200" : "text-zinc-400 group-hover:text-zinc-300"}`}>
                      {filename}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="flex-1 min-w-0 bg-[#121214] border border-white/8 rounded-xl overflow-hidden flex flex-col">
          {selectedPath && file ? (
            <>
              <div className="px-4 py-2.5 border-b border-white/5 bg-zinc-900/30 flex items-center justify-between shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <FileCode2 className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
                  <span className="text-xs font-mono text-zinc-300 truncate">{file.path}</span>
                  <span
                    className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded shrink-0 ${
                      STATUS_BADGE[fileNodes.find((node) => node.path === file.path)?.status || "unchanged"]
                    }`}
                  >
                    {STATUS_ICON[fileNodes.find((node) => node.path === file.path)?.status || "unchanged"]}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-[10px] text-zinc-500 font-mono shrink-0">
                  <span>{file.content.split("\n").length} lines</span>
                  {file.truncated ? <span className="text-amber-400">truncated</span> : null}
                </div>
              </div>
              <div className="flex-1 overflow-auto custom-scrollbar">
                <pre className="text-[11px] font-mono leading-relaxed">
                  {file.content.split("\n").map((line, index) => (
                    <div key={`${file.path}-${index}`} className="flex gap-3 px-2 py-px hover:bg-white/[0.02] text-zinc-300">
                      <span className="select-none text-zinc-700 text-right w-8 shrink-0 tabular-nums">{index + 1}</span>
                      <span>{line || " "}</span>
                    </div>
                  ))}
                </pre>
              </div>
              {file.truncated ? (
                <div className="border-t border-white/5 px-4 py-2 text-[10px] text-amber-300">
                  File view truncated for performance. Open the managed worktree for the full source if needed.
                </div>
              ) : null}
            </>
          ) : (
            <div className="flex-1 flex items-center justify-center text-zinc-600 text-sm">
              {fileQuery.isLoading ? "Loading file…" : "Select a file to view its contents"}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
