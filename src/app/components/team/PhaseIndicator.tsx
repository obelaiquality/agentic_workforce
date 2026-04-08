import type { TeamPhase } from "../../../../shared/contracts";
import { cn, Chip } from "../../UI";

const PHASE_CONFIG: Record<TeamPhase, { label: string; color: string }> = {
  team_plan: {
    label: "Planning",
    color: "bg-purple-500/10 text-purple-400 border-purple-500/20",
  },
  team_exec: {
    label: "Executing",
    color: "bg-blue-500/10 text-blue-400 border-blue-500/20",
  },
  team_verify: {
    label: "Verifying",
    color: "bg-amber-500/10 text-amber-400 border-amber-500/20",
  },
  team_fix: {
    label: "Fixing",
    color: "bg-rose-500/10 text-rose-400 border-rose-500/20",
  },
  team_complete: {
    label: "Complete",
    color: "bg-emerald-500/10 text-emerald-400 border-emerald-500/20",
  },
};

interface PhaseIndicatorProps {
  phase: TeamPhase;
}

export function PhaseIndicator({ phase }: PhaseIndicatorProps) {
  const config = PHASE_CONFIG[phase] ?? PHASE_CONFIG.team_plan;

  return (
    <Chip className={cn("uppercase tracking-wider", config.color)}>
      {config.label}
    </Chip>
  );
}
