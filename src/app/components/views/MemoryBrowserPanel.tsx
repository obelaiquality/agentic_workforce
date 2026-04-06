import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { formatDistanceToNow } from "date-fns";
import { Brain, Plus, Search, Sparkles, BookOpen } from "lucide-react";
import { commitMemoryV3, searchMemoryV3, searchKnowledgeV2 } from "../../lib/apiClient";
import type { MemoryRecord, KnowledgeHit } from "../../../shared/contracts";

const MEMORY_KINDS: Array<MemoryRecord["kind"]> = [
  "episodic",
  "scratchpad",
  "fact",
  "procedural",
  "user",
  "reflection",
];

const EMPTY_DRAFT = {
  content: "",
  kind: "episodic" as MemoryRecord["kind"],
  confidence: "0.8",
  citations: "",
};

function kindLabel(kind: MemoryRecord["kind"]) {
  switch (kind) {
    case "episodic":
      return "Episodic";
    case "scratchpad":
      return "Scratchpad";
    case "fact":
      return "Fact";
    case "procedural":
      return "Procedural";
    case "user":
      return "User";
    case "reflection":
      return "Reflection";
  }
}

function kindColor(kind: MemoryRecord["kind"]) {
  switch (kind) {
    case "episodic":
      return "bg-violet-500/10 text-violet-300 border-violet-500/20";
    case "scratchpad":
      return "bg-cyan-500/10 text-cyan-300 border-cyan-500/20";
    case "fact":
      return "bg-emerald-500/10 text-emerald-300 border-emerald-500/20";
    case "procedural":
      return "bg-amber-500/10 text-amber-300 border-amber-500/20";
    case "user":
      return "bg-fuchsia-500/10 text-fuchsia-300 border-fuchsia-500/20";
    case "reflection":
      return "bg-indigo-500/10 text-indigo-300 border-indigo-500/20";
  }
}

export function MemoryBrowserPanel({ projectId }: { projectId?: string }) {
  const queryClient = useQueryClient();
  const [activeTab, setActiveTab] = useState<"memories" | "knowledge">("memories");
  const [searchQuery, setSearchQuery] = useState("");
  const [knowledgeQuery, setKnowledgeQuery] = useState("");
  const [showAddForm, setShowAddForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const memoriesQuery = useQuery({
    queryKey: ["memories", searchQuery],
    queryFn: () => searchMemoryV3(searchQuery || "*"),
    enabled: activeTab === "memories",
  });

  const knowledgeSearchQuery = useQuery({
    queryKey: ["knowledge", knowledgeQuery],
    queryFn: () => searchKnowledgeV2(knowledgeQuery),
    enabled: activeTab === "knowledge" && knowledgeQuery.trim().length > 0,
  });

  const commitMutation = useMutation({
    mutationFn: async () => {
      return commitMemoryV3({
        actor: "user",
        repo_id: projectId,
        aggregate_id: projectId || "global",
        kind: draft.kind,
        content: draft.content.trim(),
        citations: draft.citations.split(",").map((c) => c.trim()).filter(Boolean),
        confidence: parseFloat(draft.confidence) || 0.8,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["memories"] });
      setDraft(EMPTY_DRAFT);
      setShowAddForm(false);
    },
  });

  const memories = memoriesQuery.data?.items || [];
  const knowledgeHits = knowledgeSearchQuery.data?.items || [];

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/8 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <Brain className="h-5 w-5 text-violet-400" />
            <div>
              <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Memory Browser</div>
              <div className="mt-1 text-sm text-zinc-300">Episodic and working memory</div>
            </div>
          </div>
          {activeTab === "memories" && (
            <button
              type="button"
              onClick={() => setShowAddForm(!showAddForm)}
              className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-500/16"
            >
              <Plus className="inline h-3.5 w-3.5" /> Add Memory
            </button>
          )}
        </div>

        <div className="mt-4 flex gap-2">
          <button
            type="button"
            onClick={() => setActiveTab("memories")}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "memories"
                ? "border-violet-500/30 bg-violet-500/10 text-violet-300"
                : "border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.04]"
            }`}
          >
            <Brain className="h-3.5 w-3.5" />
            Memories
          </button>
          <button
            type="button"
            onClick={() => setActiveTab("knowledge")}
            className={`flex items-center gap-1.5 rounded-lg border px-3 py-1.5 text-xs font-medium transition ${
              activeTab === "knowledge"
                ? "border-cyan-500/30 bg-cyan-500/10 text-cyan-300"
                : "border-white/10 bg-white/[0.02] text-zinc-400 hover:bg-white/[0.04]"
            }`}
          >
            <BookOpen className="h-3.5 w-3.5" />
            Knowledge
          </button>
        </div>

        <div className="relative mt-4">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-zinc-500" />
          {activeTab === "memories" ? (
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search memories..."
              className="w-full rounded-lg border border-white/10 bg-[#111113] py-2 pl-10 pr-3 text-sm text-white outline-none focus:border-violet-500/30"
            />
          ) : (
            <input
              type="text"
              value={knowledgeQuery}
              onChange={(e) => setKnowledgeQuery(e.target.value)}
              placeholder="Search knowledge base..."
              className="w-full rounded-lg border border-white/10 bg-[#111113] py-2 pl-10 pr-3 text-sm text-white outline-none focus:border-cyan-500/30"
            />
          )}
        </div>
      </div>

      {showAddForm ? (
        <div className="rounded-xl border border-white/8 bg-black/20 p-4">
          <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Add New Memory</div>

          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Kind</span>
              <select
                value={draft.kind}
                onChange={(e) => setDraft({ ...draft, kind: e.target.value as MemoryRecord["kind"] })}
                className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
              >
                {MEMORY_KINDS.map((kind) => (
                  <option key={kind} value={kind}>
                    {kindLabel(kind)}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1">
              <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Confidence</span>
              <input
                type="number"
                min="0"
                max="1"
                step="0.1"
                value={draft.confidence}
                onChange={(e) => setDraft({ ...draft, confidence: e.target.value })}
                className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
              />
            </label>
          </div>

          <label className="mt-3 block space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Content</span>
            <textarea
              value={draft.content}
              onChange={(e) => setDraft({ ...draft, content: e.target.value })}
              rows={4}
              placeholder="Memory content..."
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>

          <label className="mt-3 block space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Citations (comma-separated)</span>
            <input
              type="text"
              value={draft.citations}
              onChange={(e) => setDraft({ ...draft, citations: e.target.value })}
              placeholder="file.ts, docs/README.md"
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>

          <div className="mt-3 flex items-center gap-2">
            <button
              type="button"
              onClick={() => commitMutation.mutate()}
              disabled={!draft.content.trim() || commitMutation.isPending}
              className="rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-violet-500 disabled:opacity-50"
            >
              Save Memory
            </button>
            <button
              type="button"
              onClick={() => {
                setShowAddForm(false);
                setDraft(EMPTY_DRAFT);
              }}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-white/[0.08]"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {activeTab === "memories" ? (
        <>
          {memoriesQuery.isLoading ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-600">
              <Sparkles className="mx-auto mb-2 h-5 w-5 animate-pulse text-violet-400" />
              Loading memories...
            </div>
          ) : memories.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-600">
              <Brain className="mx-auto mb-2 h-5 w-5 text-zinc-700" />
              {searchQuery ? "No memories match your search." : "No memories stored yet."}
            </div>
          ) : (
            <div className="space-y-2">
              {memories.map((memory) => (
                <div key={memory.id} className="rounded-xl border border-white/6 bg-black/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={`rounded px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide border ${kindColor(memory.kind)}`}>
                          {kindLabel(memory.kind)}
                        </span>
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">
                          {Math.round(memory.confidence * 100)}% confidence
                        </span>
                        <span className="text-[10px] text-zinc-600">
                          {formatDistanceToNow(new Date(memory.createdAt), { addSuffix: true })}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-300">{memory.content}</p>
                      {memory.citations.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-1">
                          {memory.citations.map((citation, i) => (
                            <span
                              key={i}
                              className="rounded-md border border-white/10 bg-white/[0.02] px-2 py-0.5 font-mono text-[10px] text-zinc-500"
                            >
                              {citation}
                            </span>
                          ))}
                        </div>
                      ) : null}
                      {memory.metadata && Object.keys(memory.metadata).length > 0 ? (
                        <div className="mt-2 text-[10px] text-zinc-600">
                          Aggregate: {memory.aggregateId}
                        </div>
                      ) : null}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {memories.length > 0 && !memoriesQuery.isLoading ? (
            <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2 text-center text-xs text-zinc-500">
              Showing {memories.length} {memories.length === 1 ? "memory" : "memories"}
            </div>
          ) : null}
        </>
      ) : (
        <>
          {knowledgeSearchQuery.isLoading ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-600">
              <Sparkles className="mx-auto mb-2 h-5 w-5 animate-pulse text-cyan-400" />
              Searching knowledge base...
            </div>
          ) : !knowledgeQuery.trim() ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-600">
              <BookOpen className="mx-auto mb-2 h-5 w-5 text-zinc-700" />
              Enter a search query to find knowledge items.
            </div>
          ) : knowledgeHits.length === 0 ? (
            <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-600">
              <BookOpen className="mx-auto mb-2 h-5 w-5 text-zinc-700" />
              No knowledge items match your search.
            </div>
          ) : (
            <div className="space-y-2">
              {knowledgeHits.map((hit) => (
                <div key={hit.id} className="rounded-xl border border-white/6 bg-black/20 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className="rounded border border-cyan-500/20 bg-cyan-500/10 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-cyan-300">
                          {hit.source}
                        </span>
                        <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">
                          {Math.round(hit.score * 100)}% relevance
                        </span>
                      </div>
                      <div className="mt-2 font-mono text-xs text-zinc-400">{hit.path}</div>
                      <p className="mt-2 text-sm leading-relaxed text-zinc-300">{hit.snippet}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}

          {knowledgeHits.length > 0 && !knowledgeSearchQuery.isLoading ? (
            <div className="rounded-lg border border-white/6 bg-black/20 px-3 py-2 text-center text-xs text-zinc-500">
              Showing {knowledgeHits.length} {knowledgeHits.length === 1 ? "result" : "results"}
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
