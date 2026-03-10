"use client";

import { Bot, Siren, WandSparkles } from "lucide-react";
import type { MissionSynthesizer, MissionRecommendation } from "@/types/mission-control";

interface SynthesizerPanelProps {
  synthesizer: MissionSynthesizer;
  isActing: boolean;
  onApplyRecommendation: (recommendation: MissionRecommendation) => Promise<boolean>;
}

function statusClass(status: MissionSynthesizer["status"]): string {
  if (status === "critical") {
    return "mc2-chip mc2-chip-stop";
  }
  if (status === "watch") {
    return "mc2-chip mc2-chip-warn";
  }
  return "mc2-chip mc2-chip-ok";
}

export function SynthesizerPanel({ synthesizer, isActing, onApplyRecommendation }: SynthesizerPanelProps) {
  return (
    <section className="mc2-panel" data-testid="mc2-synthesizer-panel">
      <div className="mc2-panel-head">
        <h2>Synthesizer</h2>
        <span className={statusClass(synthesizer.status)}>
          <Bot className="h-3.5 w-3.5" /> {synthesizer.status}
        </span>
      </div>

      {synthesizer.intervention_required ? (
        <div className="mc2-interrupt" data-testid="mc2-interrupt-banner">
          <Siren className="h-4 w-4" />
          <div>
            <p className="mc2-interrupt-title">Intervention required</p>
            <p className="mc2-muted">{synthesizer.reason}</p>
          </div>
        </div>
      ) : null}

      <p className="mc2-synth-summary">{synthesizer.summary}</p>

      {synthesizer.repeated_failure ? (
        <p className="mc2-muted">
          repeated failure: {synthesizer.repeated_failure.task_id} / {synthesizer.repeated_failure.failure_code} ({synthesizer.repeated_failure.count})
        </p>
      ) : null}

      <div className="mc2-reco-list" data-testid="mc2-recommendation-list">
        {synthesizer.recommendations.length === 0 ? <p className="mc2-muted">No recommendations right now.</p> : null}
        {synthesizer.recommendations.map((recommendation) => (
          <article key={recommendation.id} className="mc2-reco-item">
            <p className="mc2-reco-title">
              <WandSparkles className="h-4 w-4" /> {recommendation.label}
            </p>
            <p className="mc2-muted">{recommendation.instruction}</p>
            <div className="mc2-reco-meta">
              <span className="mc2-chip mc2-chip-subtle">{recommendation.priority}</span>
              <span className="mc2-chip mc2-chip-subtle">{recommendation.scope}</span>
            </div>
            <button
              type="button"
              className="mc2-btn mc2-btn-subtle"
              disabled={isActing || !recommendation.task_id}
              onClick={() => void onApplyRecommendation(recommendation)}
            >
              Apply Recommendation
            </button>
          </article>
        ))}
      </div>
    </section>
  );
}
