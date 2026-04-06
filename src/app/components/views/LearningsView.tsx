import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Brain, Lightbulb, AlertTriangle, Sparkles, Trash2, RefreshCw } from "lucide-react";
import { Panel, PanelHeader, Chip } from "../UI";
import type { LearningCategory, LearningEntry, ConsolidatedPrinciple, SuggestedSkill, DreamCycleStats } from "../../../shared/contracts";
import {
  listLearnings,
  listPrinciples,
  deleteLearning,
  triggerDreamCycle,
  getDreamStats,
  listSuggestedSkills,
  approveSuggestedSkill,
  dismissSuggestedSkill,
} from "../../lib/apiClient";

const CATEGORY_META: Record<LearningCategory, { label: string; icon: React.ReactNode; chipClass: string }> = {
  pattern: { label: "Pattern", icon: <Lightbulb className="h-3.5 w-3.5" />, chipClass: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20" },
  antipattern: { label: "Antipattern", icon: <AlertTriangle className="h-3.5 w-3.5" />, chipClass: "bg-rose-500/10 text-rose-300 border-rose-500/20" },
  preference: { label: "Preference", icon: <Brain className="h-3.5 w-3.5" />, chipClass: "bg-cyan-500/10 text-cyan-300 border-cyan-500/20" },
};

function ConfidenceBar({ value }: { value: number }) {
  return (
    <div className="h-1 w-16 rounded-full bg-white/10">
      <div
        className="h-full rounded-full bg-gradient-to-r from-violet-500 to-cyan-400"
        style={{ width: `${Math.round(value * 100)}%` }}
      />
    </div>
  );
}

export function LearningsView({ projectId }: { projectId?: string | null }) {
  const queryClient = useQueryClient();
  const [categoryFilter, setCategoryFilter] = useState<LearningCategory | "all">("all");

  const learningsQuery = useQuery({
    queryKey: ["learnings", projectId, categoryFilter],
    queryFn: () => listLearnings({ projectId: projectId ?? undefined, category: categoryFilter === "all" ? undefined : categoryFilter }),
    staleTime: 30_000,
  });

  const principlesQuery = useQuery({
    queryKey: ["principles", projectId],
    queryFn: () => listPrinciples(projectId ?? undefined),
    staleTime: 30_000,
  });

  const dreamStatsQuery = useQuery({
    queryKey: ["dream-stats"],
    queryFn: () => getDreamStats(),
    staleTime: 60_000,
  });

  const suggestedSkillsQuery = useQuery({
    queryKey: ["suggested-skills", projectId],
    queryFn: () => listSuggestedSkills(projectId ?? undefined),
    staleTime: 30_000,
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteLearning(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["learnings"] }),
  });

  const dreamMutation = useMutation({
    mutationFn: () => triggerDreamCycle(),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["learnings"] });
      queryClient.invalidateQueries({ queryKey: ["principles"] });
      queryClient.invalidateQueries({ queryKey: ["dream-stats"] });
      queryClient.invalidateQueries({ queryKey: ["suggested-skills"] });
    },
  });

  const approveMutation = useMutation({
    mutationFn: (id: string) => approveSuggestedSkill(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suggested-skills"] }),
  });

  const dismissMutation = useMutation({
    mutationFn: (id: string) => dismissSuggestedSkill(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["suggested-skills"] }),
  });

  const learnings: LearningEntry[] = learningsQuery.data?.items ?? [];
  const principles: ConsolidatedPrinciple[] = principlesQuery.data?.items ?? [];
  const dreamStats: DreamCycleStats | null = dreamStatsQuery.data ?? null;
  const suggestedSkills: SuggestedSkill[] = (suggestedSkillsQuery.data?.items ?? []).filter((s: SuggestedSkill) => s.status === "pending");

  return (
    <div className="space-y-4">
      <Panel className="border-white/8">
        <PanelHeader title="Dream Cycle">
          <button
            onClick={() => dreamMutation.mutate()}
            disabled={dreamMutation.isPending}
            className="inline-flex items-center gap-1.5 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-1.5 text-xs text-zinc-300 hover:bg-white/[0.08] disabled:opacity-50"
          >
            <RefreshCw className={`h-3 w-3 ${dreamMutation.isPending ? "animate-spin" : ""}`} />
            {dreamMutation.isPending ? "Running..." : "Trigger Dream"}
          </button>
        </PanelHeader>
        <div className="p-4 grid grid-cols-2 md:grid-cols-5 gap-3">
          <StatCard label="Dream Cycles" value={dreamStats?.dreamCount ?? 0} />
          <StatCard label="Last Dream" value={dreamStats?.lastDreamAt ? new Date(dreamStats.lastDreamAt).toLocaleDateString() : "Never"} />
          <StatCard label="Learnings" value={dreamStats?.learningsCount ?? learnings.length} />
          <StatCard label="Principles" value={dreamStats?.principlesCount ?? principles.length} />
          <StatCard label="Suggested Skills" value={dreamStats?.suggestedSkillsCount ?? suggestedSkills.length} />
        </div>
      </Panel>

      {suggestedSkills.length > 0 && (
        <Panel className="border-amber-500/20">
          <PanelHeader title={`Suggested Skills (${suggestedSkills.length})`} />
          <div className="p-4 space-y-3">
            {suggestedSkills.map((skill) => (
              <div key={skill.id} className="rounded-xl border border-white/8 bg-white/[0.02] p-3">
                <div className="flex items-center justify-between gap-2">
                  <div className="flex items-center gap-2">
                    <Sparkles className="h-4 w-4 text-amber-400" />
                    <span className="text-sm font-medium text-white">{skill.name}</span>
                    <ConfidenceBar value={skill.confidence} />
                  </div>
                  <div className="flex gap-1.5">
                    <button
                      onClick={() => approveMutation.mutate(skill.id)}
                      disabled={approveMutation.isPending}
                      className="rounded-lg bg-emerald-600 px-3 py-1 text-xs text-white hover:bg-emerald-500"
                    >
                      Approve
                    </button>
                    <button
                      onClick={() => dismissMutation.mutate(skill.id)}
                      disabled={dismissMutation.isPending}
                      className="rounded-lg border border-white/10 px-3 py-1 text-xs text-zinc-400 hover:bg-white/[0.06]"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
                <div className="mt-2 text-xs text-zinc-400">{skill.description}</div>
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {skill.allowedTools.map((t) => (
                    <Chip key={t} variant="subtle" className="text-[10px]">{t}</Chip>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </Panel>
      )}

      <Panel className="border-white/8">
        <PanelHeader title="Consolidated Principles" />
        <div className="p-4 space-y-2">
          {principles.length === 0 ? (
            <div className="text-sm text-zinc-500">No principles consolidated yet. Principles emerge after multiple dream cycles.</div>
          ) : (
            principles.map((p) => (
              <div key={p.id} className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2">
                <div className="flex items-center gap-2">
                  <Brain className="h-3.5 w-3.5 text-violet-400 shrink-0" />
                  <span className="text-sm text-white">{p.principle}</span>
                  <ConfidenceBar value={p.confidence} />
                </div>
                {p.reasoning && <div className="mt-1 pl-5.5 text-xs text-zinc-500">{p.reasoning}</div>}
              </div>
            ))
          )}
        </div>
      </Panel>

      <Panel className="border-white/8">
        <PanelHeader title="Learnings">
          <div className="flex gap-1">
            {(["all", "pattern", "antipattern", "preference"] as const).map((cat) => (
              <button
                key={cat}
                onClick={() => setCategoryFilter(cat)}
                className={`rounded-md px-2 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                  categoryFilter === cat ? "bg-white/[0.08] text-white" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {cat === "all" ? "All" : cat}
              </button>
            ))}
          </div>
        </PanelHeader>
        <div className="p-4 space-y-2">
          {learnings.length === 0 ? (
            <div className="text-sm text-zinc-500">No learnings recorded yet. Learnings are extracted automatically from agentic runs.</div>
          ) : (
            learnings.map((l) => {
              const meta = CATEGORY_META[l.category];
              return (
                <div key={l.id} className="rounded-lg border border-white/8 bg-white/[0.02] px-3 py-2 group">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2 min-w-0">
                      <Chip variant="subtle" className={`text-[10px] shrink-0 ${meta.chipClass}`}>
                        {meta.icon}
                        <span className="ml-1">{meta.label}</span>
                      </Chip>
                      <span className="text-sm text-zinc-200 truncate">{l.summary}</span>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <span className="text-[10px] text-zinc-600">{l.occurrences}x</span>
                      <ConfidenceBar value={l.confidence} />
                      <button
                        onClick={() => deleteMutation.mutate(l.id)}
                        className="opacity-0 group-hover:opacity-100 text-zinc-600 hover:text-rose-400 transition-opacity"
                      >
                        <Trash2 className="h-3 w-3" />
                      </button>
                    </div>
                  </div>
                  {l.detail && <div className="mt-1 text-xs text-zinc-500 pl-1">{l.detail}</div>}
                  {l.relatedTools.length > 0 && (
                    <div className="mt-1 flex flex-wrap gap-1">
                      {l.relatedTools.map((t) => (
                        <span key={t} className="text-[10px] text-zinc-600">{t}</span>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </Panel>
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number | string }) {
  return (
    <div className="rounded-xl border border-white/8 bg-white/[0.02] px-3 py-2 text-center">
      <div className="text-lg font-semibold text-white">{value}</div>
      <div className="text-[10px] uppercase tracking-wider text-zinc-500">{label}</div>
    </div>
  );
}
