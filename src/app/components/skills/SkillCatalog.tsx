import { useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Search, Sparkles, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  createSkill,
  deleteSkill,
  listSkillInvocations,
  listSkills,
  updateSkill,
} from "../../lib/apiClient";
import type { SkillRecord } from "../../../shared/contracts";

const EMPTY_DRAFT = {
  name: "",
  description: "",
  contextMode: "inline" as const,
  allowedTools: "",
  maxIterations: "",
  systemPrompt: "",
  tags: "",
};

export function SkillCatalog() {
  const queryClient = useQueryClient();
  const [editingSkill, setEditingSkill] = useState<SkillRecord | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [searchQuery, setSearchQuery] = useState("");
  const [activeTag, setActiveTag] = useState<string | null>(null);

  const skillsQuery = useQuery({
    queryKey: ["skills"],
    queryFn: () => listSkills(),
  });
  const invocationsQuery = useQuery({
    queryKey: ["skills", "invocations"],
    queryFn: () => listSkillInvocations({ limit: 12 }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        version: editingSkill?.version || "1.0.0",
        contextMode: draft.contextMode,
        allowedTools: splitCsv(draft.allowedTools),
        maxIterations: draft.maxIterations ? Number(draft.maxIterations) : null,
        systemPrompt: draft.systemPrompt.trim(),
        referenceFiles: editingSkill?.referenceFiles || [],
        author: editingSkill?.author || "user",
        tags: splitCsv(draft.tags),
      };
      return editingSkill
        ? updateSkill(editingSkill.id, payload)
        : createSkill(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      toast.success(editingSkill ? "Skill updated" : "Skill created");
      setEditingSkill(null);
      setDraft(EMPTY_DRAFT);
    },
    onError: () => toast.error("Failed to save skill"),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteSkill(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["skills"] });
      toast("Skill removed");
    },
    onError: () => toast.error("Failed to delete skill"),
  });

  const skills = skillsQuery.data?.items || [];
  const allTags = useMemo(() => [...new Set(skills.flatMap((s) => s.tags))].sort(), [skills]);

  const filteredSkills = useMemo(() => {
    return skills.filter((skill) => {
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        if (!skill.name.toLowerCase().includes(q) && !skill.description.toLowerCase().includes(q)) return false;
      }
      if (activeTag && !skill.tags.includes(activeTag)) return false;
      return true;
    });
  }, [skills, searchQuery, activeTag]);

  const builtIn = filteredSkills.filter((skill) => skill.builtIn);
  const custom = filteredSkills.filter((skill) => !skill.builtIn);
  const recentInvocations = invocationsQuery.data?.items || [];
  const editorTitle = editingSkill ? `Edit ${editingSkill.name}` : "Create Custom Skill";
  const saveDisabled = !draft.name.trim() || !draft.description.trim() || !draft.systemPrompt.trim() || saveMutation.isPending;

  const openCreate = () => {
    setEditingSkill(null);
    setDraft(EMPTY_DRAFT);
  };

  const openEdit = (skill: SkillRecord) => {
    setEditingSkill(skill);
    setDraft({
      name: skill.name,
      description: skill.description,
      contextMode: skill.contextMode,
      allowedTools: skill.allowedTools.join(", "),
      maxIterations: skill.maxIterations ? String(skill.maxIterations) : "",
      systemPrompt: skill.systemPrompt,
      tags: skill.tags.join(", "),
    });
  };

  const invocationSummary = useMemo(
    () => recentInvocations.map((item) => `${item.skillName} · ${item.status}`).join(" · "),
    [recentInvocations],
  );

  if (skillsQuery.isLoading) {
    return <div className="p-4 text-sm text-zinc-500">Loading skills...</div>;
  }

  return (
    <div className="space-y-6">
      {/* Search & Filter Bar */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-zinc-500" />
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search skills..."
            className="w-full rounded-lg border border-white/10 bg-[#111113] pl-9 pr-3 py-2 text-sm text-white placeholder:text-zinc-600 outline-none focus:border-cyan-500/30"
          />
        </div>
        {allTags.length > 0 && (
          <div className="flex flex-wrap gap-1">
            <button
              onClick={() => setActiveTag(null)}
              className={`rounded-md px-2 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                !activeTag ? "bg-white/[0.08] text-white" : "text-zinc-500 hover:text-zinc-300"
              }`}
            >
              All
            </button>
            {allTags.map((tag) => (
              <button
                key={tag}
                onClick={() => setActiveTag(activeTag === tag ? null : tag)}
                className={`rounded-md px-2 py-1 text-[10px] uppercase tracking-wider transition-colors ${
                  activeTag === tag ? "bg-cyan-500/15 text-cyan-300" : "text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {tag}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/8 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Skill Editor</div>
            <div className="mt-1 text-sm text-zinc-300">{editorTitle}</div>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="inline-flex items-center gap-2 rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-500/16"
          >
            <Plus className="h-3.5 w-3.5" />
            New skill
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Name</span>
            <input
              aria-label="Skill name"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Mode</span>
            <select
              aria-label="Skill mode"
              value={draft.contextMode}
              onChange={(event) => setDraft((current) => ({ ...current, contextMode: event.target.value as "inline" | "fork" }))}
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            >
              <option value="inline">inline</option>
              <option value="fork">fork</option>
            </select>
          </label>
        </div>

        <label className="mt-3 block space-y-1">
          <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Description</span>
          <input
            aria-label="Skill description"
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
          />
        </label>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Allowed tools</span>
            <input
              aria-label="Skill allowed tools"
              value={draft.allowedTools}
              onChange={(event) => setDraft((current) => ({ ...current, allowedTools: event.target.value }))}
              placeholder="read_file, edit_file, run_tests"
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Max iterations</span>
            <input
              aria-label="Skill max iterations"
              value={draft.maxIterations}
              onChange={(event) => setDraft((current) => ({ ...current, maxIterations: event.target.value }))}
              placeholder="optional"
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>
        </div>

        <label className="mt-3 block space-y-1">
          <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Tags</span>
          <input
            aria-label="Skill tags"
            value={draft.tags}
            onChange={(event) => setDraft((current) => ({ ...current, tags: event.target.value }))}
            placeholder="git, review, verification"
            className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
          />
        </label>

        <label className="mt-3 block space-y-1">
          <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">System prompt</span>
          <textarea
            aria-label="Skill system prompt"
            value={draft.systemPrompt}
            onChange={(event) => setDraft((current) => ({ ...current, systemPrompt: event.target.value }))}
            rows={7}
            className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
          />
        </label>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={saveDisabled}
            className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50"
          >
            {editingSkill ? "Save changes" : "Create skill"}
          </button>
          {editingSkill ? (
            <button
              type="button"
              onClick={openCreate}
              className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-xs text-zinc-300 transition hover:bg-white/[0.08]"
            >
              Cancel
            </button>
          ) : null}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs uppercase tracking-[0.2em] text-zinc-500">Built-in Skills</h3>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {builtIn.map((skill) => (
            <SkillCard key={skill.id} skill={skill} />
          ))}
        </div>
      </div>

      <div>
        <h3 className="mb-3 text-xs uppercase tracking-[0.2em] text-zinc-500">Custom Skills</h3>
        {custom.length === 0 ? (
          <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-600">
            No custom skills yet. Create one to add reusable workflows.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {custom.map((skill) => (
              <SkillCard
                key={skill.id}
                skill={skill}
                onEdit={() => openEdit(skill)}
                onDelete={() => deleteMutation.mutate(skill.id)}
              />
            ))}
          </div>
        )}
      </div>

      <div className="rounded-xl border border-white/8 bg-black/20 p-4">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Recent Invocations</div>
        <div className="mt-2 text-xs text-zinc-500">{invocationSummary || "No skill invocations recorded yet."}</div>
        {recentInvocations.length ? (
          <div className="mt-3 space-y-2">
            {recentInvocations.map((item) => (
              <div key={item.id} className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-white">{item.skillName}</div>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{item.status}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">{item.output || item.args || "No output recorded yet."}</div>
              </div>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  );
}

function SkillCard({
  skill,
  onEdit,
  onDelete,
}: {
  skill: SkillRecord;
  onEdit?: () => void;
  onDelete?: () => void;
}) {
  return (
    <div className="flex flex-col gap-2 rounded-xl border border-white/6 bg-black/20 p-4">
      <div className="flex items-start justify-between">
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-medium text-white">{skill.name}</span>
        </div>
        <div className="flex items-center gap-1">
          <span className={`rounded px-1.5 py-0.5 text-[10px] ${skill.contextMode === "inline" ? "bg-cyan-500/10 text-cyan-300" : "bg-violet-500/10 text-violet-300"}`}>
            {skill.contextMode}
          </span>
          {skill.builtIn ? <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] text-zinc-400">built-in</span> : null}
        </div>
      </div>
      <p className="line-clamp-2 text-xs text-zinc-400">{skill.description}</p>
      <div className="mt-auto flex flex-wrap gap-1">
        {skill.tags.map((tag) => (
          <span key={tag} className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-500">
            {tag}
          </span>
        ))}
      </div>
      {!skill.builtIn ? (
        <div className="mt-2 flex justify-end gap-2 border-t border-white/5 pt-2">
          <button type="button" onClick={onEdit} className="inline-flex items-center gap-1 text-xs text-zinc-300 hover:text-white">
            <Pencil className="h-3 w-3" />
            Edit
          </button>
          <button type="button" onClick={onDelete} className="inline-flex items-center gap-1 text-xs text-red-400 hover:text-red-300">
            <Trash2 className="h-3 w-3" />
            Remove
          </button>
        </div>
      ) : null}
    </div>
  );
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
