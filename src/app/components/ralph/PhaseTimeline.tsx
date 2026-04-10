import type { RalphPhase } from "../../../shared/contracts";
import { cn } from "../UI";

const PHASE_ORDER: RalphPhase[] = [
  "intake",
  "execute",
  "verify",
  "architect_review",
  "deslop",
  "regression",
  "complete",
];

const PHASE_LABELS: Record<RalphPhase, string> = {
  intake: "Intake",
  execute: "Execute",
  verify: "Verify",
  architect_review: "Review",
  deslop: "Deslop",
  regression: "Regression",
  complete: "Complete",
};

interface PhaseTimelineProps {
  currentPhase: RalphPhase;
  completedPhases: RalphPhase[];
}

export function PhaseTimeline({ currentPhase, completedPhases }: PhaseTimelineProps) {
  return (
    <div className="flex items-center gap-0 px-5 py-4 overflow-x-auto">
      {PHASE_ORDER.map((phase, idx) => {
        const isCompleted = completedPhases.includes(phase);
        const isCurrent = phase === currentPhase;
        const isPending = !isCompleted && !isCurrent;

        return (
          <div key={phase} className="flex items-center">
            {/* Step */}
            <div className="flex flex-col items-center gap-1.5 min-w-[72px]">
              <div
                className={cn(
                  "w-5 h-5 rounded-full border-2 flex items-center justify-center transition-colors",
                  isCompleted && "bg-emerald-500 border-emerald-500",
                  isCurrent && "border-purple-500 bg-purple-500/20",
                  isPending && "border-zinc-600 bg-transparent",
                )}
              >
                {isCompleted && (
                  <svg
                    className="w-3 h-3 text-white"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                    strokeWidth={3}
                  >
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {isCurrent && (
                  <div className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
                )}
              </div>
              <span
                className={cn(
                  "text-[11px] font-medium leading-none whitespace-nowrap",
                  isCompleted && "text-emerald-400",
                  isCurrent && "text-purple-400",
                  isPending && "text-zinc-500",
                )}
              >
                {PHASE_LABELS[phase]}
              </span>
            </div>

            {/* Connector line */}
            {idx < PHASE_ORDER.length - 1 && (
              <div
                className={cn(
                  "h-px w-6 mt-[-18px]",
                  isCompleted ? "bg-emerald-500/60" : "bg-zinc-700",
                )}
              />
            )}
          </div>
        );
      })}
    </div>
  );
}
