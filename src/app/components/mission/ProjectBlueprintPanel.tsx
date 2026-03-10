import { useEffect, useMemo, useState } from "react";
import { ClipboardCheck, RefreshCw, ScrollText, ShieldCheck, TestTube2 } from "lucide-react";
import { Chip, Panel, PanelHeader } from "../UI";
import type { ProjectBlueprint } from "../../../shared/contracts";

export function ProjectBlueprintPanel({
  blueprint,
  compact = false,
  isActing = false,
  onUpdate,
  onRegenerate,
  onOpenDetails,
}: {
  blueprint: ProjectBlueprint | null;
  compact?: boolean;
  isActing?: boolean;
  onUpdate?: (patch: Partial<ProjectBlueprint>) => void;
  onRegenerate?: () => void;
  onOpenDetails?: () => void;
}) {
  const [productIntent, setProductIntent] = useState(blueprint?.charter.productIntent || "");
  const [successCriteria, setSuccessCriteria] = useState((blueprint?.charter.successCriteria || []).join("\n"));

  useEffect(() => {
    setProductIntent(blueprint?.charter.productIntent || "");
    setSuccessCriteria((blueprint?.charter.successCriteria || []).join("\n"));
  }, [blueprint]);

  const summary = useMemo(() => {
    if (!blueprint) return null;
    return {
      testing: blueprint.testingPolicy.requiredForBehaviorChange ? "Tests required on behavior changes" : "Tests optional by default",
      docs: blueprint.documentationPolicy.updateUserFacingDocs ? "Docs update expected" : "Docs update optional",
      execution: blueprint.executionPolicy.allowParallelExecution ? "Parallel execution allowed" : "Single-lane preferred",
      confidence: blueprint.confidence || null,
    };
  }, [blueprint]);

  const canSave = Boolean(blueprint && onUpdate);

  return (
    <Panel>
      <PanelHeader title="Project Blueprint">
        <div className="flex items-center gap-2">
          <Chip variant={blueprint ? "ok" : "warn"} className="text-[10px]">
            {blueprint ? `v${blueprint.version}` : "draft pending"}
          </Chip>
          {blueprint?.sourceMode === "repo_plus_override" ? <Chip variant="subtle" className="text-[10px]">customized</Chip> : null}
          {summary?.confidence ? (
            <Chip variant="subtle" className="text-[10px]">{`${summary.confidence} confidence`}</Chip>
          ) : null}
        </div>
      </PanelHeader>

      <div className="p-4 space-y-4">
        {!blueprint ? (
          <div className="rounded-xl border border-dashed border-white/10 px-4 py-6 text-sm text-zinc-500">
            Connect a repo to generate a project blueprint from its guidance, scripts, and docs.
          </div>
        ) : (
          <>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
              <SummaryTile icon={<TestTube2 className="h-4 w-4 text-cyan-300" />} title="Tests" body={summary?.testing || "—"} />
              <SummaryTile icon={<ClipboardCheck className="h-4 w-4 text-purple-400" />} title="Docs" body={summary?.docs || "—"} />
              <SummaryTile icon={<ShieldCheck className="h-4 w-4 text-emerald-400" />} title="Execution" body={summary?.execution || "—"} />
            </div>

            <div className="rounded-xl border border-white/10 bg-white/[0.02] p-4">
              <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.22em] text-zinc-500">
                <ScrollText className="h-3.5 w-3.5 text-cyan-300" />
                Project charter
              </div>
              <div className="mt-2 text-sm text-white">{blueprint.charter.productIntent}</div>
              <div className="mt-3 flex flex-wrap gap-2">
                {blueprint.charter.successCriteria.slice(0, compact ? 3 : 5).map((item) => (
                  <span key={item} className="rounded-full border border-white/10 bg-black/20 px-3 py-1 text-xs text-zinc-400">
                    {item}
                  </span>
                ))}
              </div>
            </div>

            {!compact ? (
              <>
                <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1.2fr_0.8fr]">
                  <div className="space-y-3">
                    <label className="block space-y-1">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Product intent</div>
                      <textarea
                        value={productIntent}
                        onChange={(event) => setProductIntent(event.target.value)}
                        className="min-h-[96px] w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-sm text-zinc-100"
                      />
                    </label>

                    <label className="block space-y-1">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Success criteria</div>
                      <textarea
                        value={successCriteria}
                        onChange={(event) => setSuccessCriteria(event.target.value)}
                        className="min-h-[108px] w-full rounded-xl border border-white/10 bg-zinc-950 px-3 py-3 text-sm text-zinc-100"
                      />
                    </label>
                  </div>

                  <div className="space-y-3 rounded-xl border border-white/10 bg-zinc-950/40 p-4">
                    <ToggleRow
                      label="Require tests for behavior changes"
                      checked={blueprint.testingPolicy.requiredForBehaviorChange}
                      onChange={(checked) => onUpdate?.({ testingPolicy: { requiredForBehaviorChange: checked } as ProjectBlueprint["testingPolicy"] })}
                    />
                    <ToggleRow
                      label="Expect user-facing docs updates"
                      checked={blueprint.documentationPolicy.updateUserFacingDocs}
                      onChange={(checked) => onUpdate?.({ documentationPolicy: { updateUserFacingDocs: checked } as ProjectBlueprint["documentationPolicy"] })}
                    />
                    <ToggleRow
                      label="Allow parallel execution"
                      checked={blueprint.executionPolicy.allowParallelExecution}
                      onChange={(checked) => onUpdate?.({ executionPolicy: { allowParallelExecution: checked } as ProjectBlueprint["executionPolicy"] })}
                    />
                    <div className="space-y-1">
                      <div className="text-[11px] uppercase tracking-[0.18em] text-zinc-500">Escalation policy</div>
                      <select
                        value={blueprint.providerPolicy.escalationPolicy}
                        onChange={(event) =>
                          onUpdate?.({
                            providerPolicy: {
                              escalationPolicy: event.target.value as ProjectBlueprint["providerPolicy"]["escalationPolicy"],
                            } as ProjectBlueprint["providerPolicy"],
                          })
                        }
                        className="w-full rounded-lg border border-white/10 bg-zinc-950 px-3 py-2 text-xs text-zinc-200"
                      >
                        <option value="manual">Manual</option>
                        <option value="high_risk_only">High risk only</option>
                        <option value="auto">Auto</option>
                      </select>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.015] px-4 py-3 text-xs text-zinc-500">
                <div>
                  Extracted from {blueprint.extractedFrom.length} repo source{blueprint.extractedFrom.length === 1 ? "" : "s"}.
                </div>
                <div className="text-zinc-600">
                  {blueprint.extractedFrom
                    .slice(0, 3)
                    .map((item) => item.split("/").slice(-2).join("/"))
                    .join(" · ")}
                </div>
                <div className="flex gap-2">
                    {onRegenerate ? (
                      <button
                        onClick={onRegenerate}
                        disabled={isActing}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-200 hover:bg-white/[0.08] disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isActing ? "animate-spin" : ""}`} />
                        Refresh from repo
                      </button>
                    ) : null}
                    <button
                      onClick={() => {
                        if (!canSave) return;
                        onUpdate?.({
                          charter: {
                            ...blueprint.charter,
                            productIntent: productIntent.trim(),
                            successCriteria: successCriteria
                              .split(/\n+/)
                              .map((item) => item.trim())
                              .filter(Boolean),
                          },
                        });
                      }}
                      disabled={!canSave || isActing}
                      className="rounded-lg bg-cyan-600 px-4 py-2 text-xs font-medium text-white hover:bg-cyan-500 disabled:opacity-50"
                    >
                      Save blueprint
                    </button>
                  </div>
                </div>
              </>
            ) : (
              <div className="space-y-3">
                {onUpdate ? (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                    <CompactToggle
                      label="Tests required"
                      checked={blueprint.testingPolicy.requiredForBehaviorChange}
                      onChange={(checked) => onUpdate({ testingPolicy: { requiredForBehaviorChange: checked } as ProjectBlueprint["testingPolicy"] })}
                    />
                    <CompactToggle
                      label="Docs expected"
                      checked={blueprint.documentationPolicy.updateUserFacingDocs}
                      onChange={(checked) => onUpdate({ documentationPolicy: { updateUserFacingDocs: checked } as ProjectBlueprint["documentationPolicy"] })}
                    />
                    <div className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-zinc-950/40 px-3 py-2">
                      <span className="text-[11px] text-zinc-400">Escalation</span>
                      <select
                        value={blueprint.providerPolicy.escalationPolicy}
                        onChange={(event) =>
                          onUpdate({
                            providerPolicy: {
                              escalationPolicy: event.target.value as ProjectBlueprint["providerPolicy"]["escalationPolicy"],
                            } as ProjectBlueprint["providerPolicy"],
                          })
                        }
                        className="rounded border border-white/10 bg-zinc-950 px-1.5 py-0.5 text-[11px] text-zinc-200"
                      >
                        <option value="manual">Manual</option>
                        <option value="high_risk_only">High risk</option>
                        <option value="auto">Auto</option>
                      </select>
                    </div>
                  </div>
                ) : null}
                <div className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.015] px-4 py-3 text-xs text-zinc-500">
                  <div className="space-y-1">
                    <div>{blueprint.extractedFrom.length} guidance source{blueprint.extractedFrom.length === 1 ? "" : "s"} informing route, tests, docs, and approvals.</div>
                    <div className="text-zinc-600">
                      {blueprint.extractedFrom
                        .slice(0, 2)
                        .map((item) => item.split("/").slice(-2).join("/"))
                        .join(" · ")}
                    </div>
                  </div>
                  <div className="flex gap-2">
                    {onRegenerate ? (
                      <button
                        onClick={onRegenerate}
                        disabled={isActing}
                        className="inline-flex items-center gap-2 rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-xs text-zinc-200 hover:bg-white/[0.08] disabled:opacity-50"
                      >
                        <RefreshCw className={`h-3.5 w-3.5 ${isActing ? "animate-spin" : ""}`} />
                        Refresh
                      </button>
                    ) : null}
                    {onOpenDetails ? (
                      <button
                        onClick={onOpenDetails}
                        className="rounded-lg bg-cyan-600 px-3 py-2 text-xs font-medium text-white hover:bg-cyan-500"
                      >
                        Refine
                      </button>
                    ) : null}
                  </div>
                </div>
              </div>
            )}
          </>
        )}
      </div>
    </Panel>
  );
}

function SummaryTile({ icon, title, body }: { icon: React.ReactNode; title: string; body: string }) {
  return (
    <div className="rounded-xl border border-white/10 bg-zinc-950/40 p-4">
      <div className="flex items-center gap-2 text-sm font-medium text-white">
        {icon}
        {title}
      </div>
      <div className="mt-2 text-xs leading-5 text-zinc-400">{body}</div>
    </div>
  );
}

function ToggleRow({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-3 text-sm text-zinc-300">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
    </label>
  );
}

function CompactToggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex items-center justify-between gap-2 rounded-lg border border-white/10 bg-zinc-950/40 px-3 py-2 text-[11px] text-zinc-400 cursor-pointer">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} className="accent-cyan-500" />
    </label>
  );
}
