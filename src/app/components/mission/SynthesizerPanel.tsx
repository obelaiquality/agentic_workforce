import { AlertTriangle, Sparkles, WandSparkles } from "lucide-react";
import { Chip, Panel, PanelHeader } from "../UI";
import type { ContextPack, RoutingDecision } from "../../../shared/contracts";
import { executionModeLabel, modelRoleLabel } from "../../lib/missionLabels";

export function SynthesizerPanel({
  route,
  contextPack,
  blockedByApprovals,
  onApplyRecommendation,
}: {
  route: RoutingDecision | null;
  contextPack: ContextPack | null;
  blockedByApprovals: boolean;
  onApplyRecommendation: () => void;
}) {
  const confidence = route ? Math.max(0.25, Math.min(0.97, 0.45 + route.decompositionScore * 0.4)) : 0;

  return (
    <Panel>
      <PanelHeader title="Synthesizer">
        <Chip variant={blockedByApprovals ? "warn" : route ? "ok" : "subtle"} className="text-[10px]">
          {blockedByApprovals ? "approval gate" : route ? "ready" : "idle"}
        </Chip>
      </PanelHeader>
      <div className="p-4 space-y-4">
        {blockedByApprovals ? (
          <div className="rounded-lg border border-amber-500/20 bg-amber-500/8 p-3 text-xs text-amber-100 flex gap-2">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0 text-amber-400" />
            <div>
              <div className="font-medium">Approval required</div>
              <div className="text-amber-200/80 mt-1">Resolve the pending approval before promoting the next change.</div>
            </div>
          </div>
        ) : null}

        <div>
          <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Route</div>
          <div className="mt-1 text-sm font-medium text-white">
            {route ? `${executionModeLabel(route.executionMode)} via ${modelRoleLabel(route.modelRole)}` : "Review a route to see the recommended lane."}
          </div>
          <p className="mt-2 text-xs text-zinc-400">
            {route?.rationale?.[0] || "The overseer will compact the context pack first, then choose the safest execution path for the current objective."}
          </p>
        </div>

        <div className="grid grid-cols-2 gap-2 text-xs">
          <div className="rounded-lg border border-white/5 bg-zinc-950/50 p-3">
            <div className="text-zinc-500">Context Pack</div>
            <div className="mt-1 text-white font-medium">{contextPack ? `${contextPack.files.length} files / ${contextPack.tests.length} tests` : "Not built yet"}</div>
          </div>
          <div className="rounded-lg border border-white/5 bg-zinc-950/50 p-3">
            <div className="text-zinc-500">Confidence</div>
            <div className="mt-1 text-white font-medium">{route ? `${Math.round(confidence * 100)}%` : "—"}</div>
          </div>
        </div>

        {contextPack?.why?.length ? (
          <div className="space-y-2">
            <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">Why this context</div>
            {contextPack.why.slice(0, 3).map((reason) => (
              <div key={reason} className="rounded-lg border border-white/5 bg-white/[0.02] px-3 py-2 text-xs text-zinc-400 flex items-start gap-2">
                <Sparkles className="h-3.5 w-3.5 mt-0.5 text-purple-400 shrink-0" />
                <span>{reason}</span>
              </div>
            ))}
          </div>
        ) : null}

        <button
          onClick={onApplyRecommendation}
          disabled={!route}
          className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-purple-600 px-4 py-2 text-sm font-medium text-white hover:bg-purple-500 disabled:cursor-not-allowed disabled:opacity-50"
        >
          <WandSparkles className="h-4 w-4" />
          Apply Recommendation
        </button>
      </div>
    </Panel>
  );
}
