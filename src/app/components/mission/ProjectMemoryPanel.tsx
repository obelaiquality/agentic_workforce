import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Panel, PanelHeader, Button, Chip, cn } from "../UI";

// ---------------------------------------------------------------------------
// Types (mirrors server memoryRoutes.ts)
// ---------------------------------------------------------------------------

interface MemoryListItem {
  id: string;
  taskDescription: string;
  summary: string;
  outcome: "success" | "failure" | "partial";
  keyFiles: string[];
  lessons: string[];
  createdAt: string;
  ageLabel: string;
  ageDays: number;
}

interface MemoryStats {
  episodicCount: number;
  oldestCreatedAt: string | null;
  newestCreatedAt: string | null;
  successCount: number;
  failureCount: number;
  partialCount: number;
}

interface MemoryApiResponse {
  memories: MemoryListItem[];
  stats: MemoryStats | null;
}

// ---------------------------------------------------------------------------
// API helpers
// ---------------------------------------------------------------------------

async function fetchMemories(
  worktreePath: string,
  filter?: { search?: string; outcome?: string },
): Promise<MemoryApiResponse> {
  const params = new URLSearchParams({ worktreePath });
  if (filter?.search) params.set("search", filter.search);
  if (filter?.outcome) params.set("outcome", filter.outcome);
  const res = await fetch(`/api/v1/memory?${params}`);
  return res.json();
}

async function deleteMemory(worktreePath: string, id: string): Promise<void> {
  await fetch(`/api/v1/memory/${id}?worktreePath=${encodeURIComponent(worktreePath)}`, {
    method: "DELETE",
  });
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function OutcomeBadge({ outcome }: { outcome: MemoryListItem["outcome"] }) {
  const variant = outcome === "success" ? "ok" : outcome === "failure" ? "stop" : "warn";
  return <Chip variant={variant}>{outcome}</Chip>;
}

function MemoryCard({
  memory,
  onDelete,
  expanded,
  onToggle,
}: {
  memory: MemoryListItem;
  onDelete: () => void;
  expanded: boolean;
  onToggle: () => void;
}) {
  return (
    <div
      className={cn(
        "border border-white/5 rounded-lg p-3 transition-colors",
        "hover:border-white/10 bg-white/[0.01]",
        expanded && "border-white/10 bg-white/[0.03]",
      )}
    >
      <div className="flex items-start justify-between gap-2">
        <button
          onClick={onToggle}
          className="flex-1 text-left"
        >
          <div className="flex items-center gap-2 mb-1">
            <OutcomeBadge outcome={memory.outcome} />
            <span className="text-xs text-zinc-500">{memory.ageLabel}</span>
          </div>
          <p className="text-sm text-zinc-300 line-clamp-2">{memory.summary}</p>
        </button>
        <button
          onClick={onDelete}
          className="text-zinc-600 hover:text-rose-400 transition-colors p-1 rounded"
          title="Delete memory"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <path d="M3 6h18M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
          </svg>
        </button>
      </div>

      {expanded && (
        <div className="mt-3 pt-3 border-t border-white/5 space-y-2">
          <div>
            <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Task</span>
            <p className="text-xs text-zinc-400 mt-0.5">{memory.taskDescription}</p>
          </div>
          {memory.keyFiles.length > 0 && (
            <div>
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Files</span>
              <div className="flex flex-wrap gap-1 mt-0.5">
                {memory.keyFiles.map((file) => (
                  <span key={file} className="text-xs text-zinc-500 bg-zinc-800 px-1.5 py-0.5 rounded font-mono">
                    {file}
                  </span>
                ))}
              </div>
            </div>
          )}
          {memory.lessons.length > 0 && (
            <div>
              <span className="text-xs font-medium text-zinc-500 uppercase tracking-wider">Lessons</span>
              <ul className="mt-0.5 space-y-0.5">
                {memory.lessons.map((lesson, i) => (
                  <li key={i} className="text-xs text-amber-400/80 flex gap-1">
                    <span className="text-amber-500/50">-</span>
                    {lesson}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <div className="text-xs text-zinc-600">
            {new Date(memory.createdAt).toLocaleString()}
          </div>
        </div>
      )}
    </div>
  );
}

function StatsBar({ stats }: { stats: MemoryStats }) {
  const total = stats.episodicCount;
  if (total === 0) return null;

  return (
    <div className="flex items-center gap-3 px-1 py-1.5 text-xs text-zinc-500">
      <span>{total} memories</span>
      <span className="text-zinc-700">|</span>
      <span className="text-emerald-500/70">{stats.successCount} passed</span>
      {stats.failureCount > 0 && (
        <span className="text-rose-500/70">{stats.failureCount} failed</span>
      )}
      {stats.partialCount > 0 && (
        <span className="text-amber-500/70">{stats.partialCount} partial</span>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function ProjectMemoryPanel({
  worktreePath,
  className,
}: {
  worktreePath: string | null;
  className?: string;
}) {
  const queryClient = useQueryClient();
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [outcomeFilter, setOutcomeFilter] = useState<string>("");

  const { data, isLoading } = useQuery({
    queryKey: ["project-memory", worktreePath, searchQuery, outcomeFilter],
    queryFn: () =>
      worktreePath
        ? fetchMemories(worktreePath, {
            search: searchQuery || undefined,
            outcome: outcomeFilter || undefined,
          })
        : Promise.resolve({ memories: [], stats: null }),
    enabled: Boolean(worktreePath),
    refetchInterval: 30000, // Refresh every 30s
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteMemory(worktreePath!, id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["project-memory"] });
    },
  });

  const memories = data?.memories ?? [];
  const stats = data?.stats ?? null;

  return (
    <Panel className={className}>
      <PanelHeader title="Project Memory">
        {stats && <StatsBar stats={stats} />}
      </PanelHeader>

      <div className="p-3 space-y-3">
        {/* Search + Filter */}
        <div className="flex gap-2">
          <input
            type="text"
            placeholder="Search memories..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className={cn(
              "flex-1 bg-zinc-900 border border-white/10 rounded-md px-3 py-1.5",
              "text-sm text-zinc-300 placeholder:text-zinc-600",
              "focus:outline-none focus:ring-1 focus:ring-purple-500/50 focus:border-purple-500/30",
            )}
          />
          <select
            value={outcomeFilter}
            onChange={(e) => setOutcomeFilter(e.target.value)}
            className="bg-zinc-900 border border-white/10 rounded-md px-2 py-1.5 text-sm text-zinc-400 focus:outline-none"
          >
            <option value="">All</option>
            <option value="success">Passed</option>
            <option value="failure">Failed</option>
            <option value="partial">Partial</option>
          </select>
        </div>

        {/* Memory List */}
        {isLoading ? (
          <div className="text-center py-8 text-zinc-600 text-sm">Loading memories...</div>
        ) : !worktreePath ? (
          <div className="text-center py-8 text-zinc-600 text-sm">
            Select a project to view its memory
          </div>
        ) : memories.length === 0 ? (
          <div className="text-center py-8">
            <p className="text-zinc-600 text-sm">No memories yet</p>
            <p className="text-zinc-700 text-xs mt-1">
              Memories are created automatically as tasks complete
            </p>
          </div>
        ) : (
          <div className="space-y-2 max-h-[60vh] overflow-y-auto pr-1">
            {memories.map((memory) => (
              <MemoryCard
                key={memory.id}
                memory={memory}
                expanded={expandedId === memory.id}
                onToggle={() => setExpandedId(expandedId === memory.id ? null : memory.id)}
                onDelete={() => deleteMutation.mutate(memory.id)}
              />
            ))}
          </div>
        )}
      </div>
    </Panel>
  );
}

export default ProjectMemoryPanel;
