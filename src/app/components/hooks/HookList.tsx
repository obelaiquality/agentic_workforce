import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Play, ToggleLeft, ToggleRight, Trash2, Zap } from "lucide-react";
import {
  createHook,
  deleteHook,
  listHookExecutions,
  listHooks,
  testHook,
  updateHook,
} from "../../lib/apiClient";
import type { HookEventType, HookRecord, HookType } from "../../../shared/contracts";

const EVENT_TYPES: HookEventType[] = [
  "SessionStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "PostToolUseFailure",
  "PermissionRequest",
  "PreCompact",
  "PostCompact",
  "Notification",
];

const EMPTY_DRAFT = {
  name: "",
  description: "",
  enabled: true,
  eventType: "PreToolUse" as HookEventType,
  hookType: "Prompt" as HookType,
  command: "",
  promptTemplate: "",
  agentObjective: "",
  allowedTools: "",
  canOverride: false,
  continueOnError: true,
  timeoutMs: "30000",
  projectId: "",
};

export function HookList() {
  const queryClient = useQueryClient();
  const [editingHook, setEditingHook] = useState<HookRecord | null>(null);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [testResult, setTestResult] = useState<{ hookId: string; output: string } | null>(null);

  const hooksQuery = useQuery({
    queryKey: ["hooks"],
    queryFn: () => listHooks(),
  });
  const logsQuery = useQuery({
    queryKey: ["hooks", "executions"],
    queryFn: () => listHookExecutions({ limit: 12 }),
  });

  const saveMutation = useMutation({
    mutationFn: async () => {
      const payload = {
        name: draft.name.trim(),
        description: draft.description.trim(),
        enabled: draft.enabled,
        eventType: draft.eventType,
        hookType: draft.hookType,
        command: draft.command.trim() || null,
        promptTemplate: draft.promptTemplate.trim() || null,
        agentObjective: draft.agentObjective.trim() || null,
        allowedTools: splitCsv(draft.allowedTools),
        canOverride: draft.canOverride,
        continueOnError: draft.continueOnError,
        timeoutMs: Number(draft.timeoutMs) || 30000,
        projectId: draft.projectId.trim() || null,
      };
      return editingHook ? updateHook(editingHook.id, payload) : createHook(payload);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["hooks"] });
      setEditingHook(null);
      setDraft(EMPTY_DRAFT);
    },
  });

  const toggleMutation = useMutation({
    mutationFn: ({ id, enabled }: { id: string; enabled: boolean }) => updateHook(id, { enabled }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hooks"] }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => deleteHook(id),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["hooks"] }),
  });

  const testMutation = useMutation({
    mutationFn: (id: string) => testHook(id, { tool_name: "bash", params: { command: "echo test" } }),
    onSuccess: (data, hookId) => {
      setTestResult({
        hookId,
        output: data.output.success ? data.output.systemMessage || "Hook executed successfully" : `Error: ${data.output.error}`,
      });
      queryClient.invalidateQueries({ queryKey: ["hooks", "executions"] });
    },
  });

  const hooks = hooksQuery.data?.items || [];
  const logs = logsQuery.data?.items || [];

  const openCreate = () => {
    setEditingHook(null);
    setDraft(EMPTY_DRAFT);
  };

  const openEdit = (hook: HookRecord) => {
    setEditingHook(hook);
    setDraft({
      name: hook.name,
      description: hook.description,
      enabled: hook.enabled,
      eventType: hook.eventType,
      hookType: hook.hookType,
      command: hook.command || "",
      promptTemplate: hook.promptTemplate || "",
      agentObjective: hook.agentObjective || "",
      allowedTools: hook.allowedTools.join(", "),
      canOverride: hook.canOverride,
      continueOnError: hook.continueOnError,
      timeoutMs: String(hook.timeoutMs),
      projectId: hook.projectId || "",
    });
  };

  if (hooksQuery.isLoading) {
    return <div className="p-4 text-sm text-zinc-500">Loading hooks...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/8 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Hook Editor</div>
            <div className="mt-1 text-sm text-zinc-300">{editingHook ? `Edit ${editingHook.name}` : "Create Hook"}</div>
          </div>
          <button
            type="button"
            onClick={openCreate}
            className="rounded-lg border border-cyan-500/20 bg-cyan-500/10 px-3 py-1.5 text-xs text-cyan-100 transition hover:bg-cyan-500/16"
          >
            New hook
          </button>
        </div>

        <div className="mt-4 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Name</span>
            <input
              aria-label="Hook name"
              value={draft.name}
              onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Event</span>
            <select
              aria-label="Hook event"
              value={draft.eventType}
              onChange={(event) => setDraft((current) => ({ ...current, eventType: event.target.value as HookEventType }))}
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            >
              {EVENT_TYPES.map((eventType) => (
                <option key={eventType} value={eventType}>
                  {eventType}
                </option>
              ))}
            </select>
          </label>
        </div>

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Hook type</span>
            <select
              aria-label="Hook type"
              value={draft.hookType}
              onChange={(event) => setDraft((current) => ({ ...current, hookType: event.target.value as HookType }))}
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            >
              <option value="Prompt">Prompt</option>
              <option value="Command">Command</option>
              <option value="Agent">Agent</option>
            </select>
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Project scope</span>
            <input
              aria-label="Hook project scope"
              value={draft.projectId}
              onChange={(event) => setDraft((current) => ({ ...current, projectId: event.target.value }))}
              placeholder="optional project id"
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>
        </div>

        <label className="mt-3 block space-y-1">
          <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Description</span>
          <input
            aria-label="Hook description"
            value={draft.description}
            onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))}
            className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
          />
        </label>

        {draft.hookType === "Command" ? (
          <label className="mt-3 block space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Command</span>
            <input
              aria-label="Hook command"
              value={draft.command}
              onChange={(event) => setDraft((current) => ({ ...current, command: event.target.value }))}
              placeholder={"echo '{\"continue\": true}'"}
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>
        ) : null}
        {draft.hookType === "Prompt" ? (
          <label className="mt-3 block space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Prompt template</span>
            <textarea
              aria-label="Hook prompt template"
              value={draft.promptTemplate}
              onChange={(event) => setDraft((current) => ({ ...current, promptTemplate: event.target.value }))}
              rows={5}
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>
        ) : null}
        {draft.hookType === "Agent" ? (
          <label className="mt-3 block space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Agent objective</span>
            <textarea
              aria-label="Hook agent objective"
              value={draft.agentObjective}
              onChange={(event) => setDraft((current) => ({ ...current, agentObjective: event.target.value }))}
              rows={5}
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>
        ) : null}

        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Allowed tools</span>
            <input
              aria-label="Hook allowed tools"
              value={draft.allowedTools}
              onChange={(event) => setDraft((current) => ({ ...current, allowedTools: event.target.value }))}
              placeholder="bash, read_file"
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>
          <label className="space-y-1">
            <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Timeout ms</span>
            <input
              aria-label="Hook timeout"
              value={draft.timeoutMs}
              onChange={(event) => setDraft((current) => ({ ...current, timeoutMs: event.target.value }))}
              className="w-full rounded-lg border border-white/10 bg-[#111113] px-3 py-2 text-sm text-white outline-none"
            />
          </label>
        </div>

        <div className="mt-3 flex flex-wrap gap-4 text-xs text-zinc-300">
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.enabled}
              onChange={(event) => setDraft((current) => ({ ...current, enabled: event.target.checked }))}
            />
            Enabled
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.canOverride}
              onChange={(event) => setDraft((current) => ({ ...current, canOverride: event.target.checked }))}
            />
            Can override
          </label>
          <label className="inline-flex items-center gap-2">
            <input
              type="checkbox"
              checked={draft.continueOnError}
              onChange={(event) => setDraft((current) => ({ ...current, continueOnError: event.target.checked }))}
            />
            Continue on error
          </label>
        </div>

        <div className="mt-3 flex items-center gap-2">
          <button
            type="button"
            onClick={() => saveMutation.mutate()}
            disabled={!draft.name.trim() || saveMutation.isPending}
            className="rounded-lg bg-cyan-600 px-3 py-1.5 text-xs font-medium text-white transition hover:bg-cyan-500 disabled:opacity-50"
          >
            {editingHook ? "Save hook" : "Create hook"}
          </button>
          {editingHook ? (
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

      {hooks.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-6 text-center text-sm text-zinc-600">
          <Zap className="mx-auto mb-2 h-5 w-5 text-zinc-700" />
          No hooks configured. Hooks let you define persistent automation behaviors.
        </div>
      ) : (
        <div className="space-y-2">
          {hooks.map((hook) => (
            <div key={hook.id} className="rounded-xl border border-white/6 bg-black/20 p-3">
              <div className="flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <Zap className={`h-3.5 w-3.5 ${hook.enabled ? "text-amber-400" : "text-zinc-600"}`} />
                    <span className="truncate text-sm font-medium text-white">{hook.name}</span>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">{hook.eventType}</span>
                    <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-400">{hook.hookType}</span>
                  </div>
                  {hook.description ? <p className="mt-1 text-xs text-zinc-500">{hook.description}</p> : null}
                  {testResult?.hookId === hook.id ? (
                    <div className="mt-2 rounded-lg border border-white/5 bg-black/30 p-2 font-mono text-xs text-zinc-300">
                      {testResult.output}
                    </div>
                  ) : null}
                </div>
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => testMutation.mutate(hook.id)}
                    aria-label={`Test hook ${hook.name}`}
                    className="inline-flex items-center gap-1 text-xs text-cyan-400 hover:text-cyan-300"
                  >
                    <Play className="h-3 w-3" />
                    Test
                  </button>
                  <button type="button" onClick={() => openEdit(hook)} aria-label={`Edit hook ${hook.name}`} className="text-zinc-400 hover:text-white">
                    <Pencil className="h-3.5 w-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => toggleMutation.mutate({ id: hook.id, enabled: !hook.enabled })}
                    aria-label={`${hook.enabled ? "Disable" : "Enable"} hook ${hook.name}`}
                    className="text-zinc-400 hover:text-white"
                  >
                    {hook.enabled ? <ToggleRight className="h-5 w-5 text-emerald-400" /> : <ToggleLeft className="h-5 w-5" />}
                  </button>
                  <button type="button" onClick={() => deleteMutation.mutate(hook.id)} aria-label={`Delete hook ${hook.name}`} className="text-zinc-500 hover:text-red-400">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      <div className="rounded-xl border border-white/8 bg-black/20 p-4">
        <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Execution Log</div>
        {logs.length ? (
          <div className="mt-3 space-y-2">
            {logs.map((log) => (
              <div key={log.id} className="rounded-lg border border-white/6 bg-white/[0.02] px-3 py-2">
                <div className="flex items-center justify-between gap-3">
                  <div className="text-sm text-white">{log.hookName}</div>
                  <span className="text-[10px] uppercase tracking-[0.16em] text-zinc-500">{log.eventType}</span>
                </div>
                <div className="mt-1 text-xs text-zinc-500">{log.output || log.error || "No message recorded."}</div>
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-2 text-xs text-zinc-500">No hook executions recorded yet.</div>
        )}
      </div>
    </div>
  );
}

function splitCsv(value: string) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);
}
