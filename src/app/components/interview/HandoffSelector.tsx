import { Zap, Brain, ArrowRight } from "lucide-react";
import { cn, Button } from "../UI";

const handoffOptions = [
  {
    mode: "ralph" as const,
    icon: Brain,
    title: "Ralph Mode",
    description:
      "Solo deep-work agent. Ralph takes the crystallized spec and autonomously implements it with iterative self-verification loops.",
    color: "text-purple-400",
    borderColor: "border-purple-500/20 hover:border-purple-500/40",
    bgColor: "bg-purple-500/5 hover:bg-purple-500/10",
  },
  {
    mode: "team" as const,
    icon: ArrowRight,
    title: "Team Mode",
    description:
      "Multi-agent collaboration. Workers split the spec into parallel subtasks, coordinate through a shared merge layer, then verify together.",
    color: "text-emerald-400",
    borderColor: "border-emerald-500/20 hover:border-emerald-500/40",
    bgColor: "bg-emerald-500/5 hover:bg-emerald-500/10",
  },
  {
    mode: "autopilot" as const,
    icon: Zap,
    title: "Autopilot",
    description:
      "Automatic selection. The system chooses Ralph or Team mode based on the complexity and parallelism detected in the spec.",
    color: "text-amber-400",
    borderColor: "border-amber-500/20 hover:border-amber-500/40",
    bgColor: "bg-amber-500/5 hover:bg-amber-500/10",
  },
];

export function HandoffSelector({
  onHandoff,
  specContent,
}: {
  onHandoff: (mode: "ralph" | "team" | "autopilot") => void;
  specContent: string;
}) {
  const truncatedSpec =
    specContent.length > 400
      ? specContent.slice(0, 400) + "..."
      : specContent;

  return (
    <div className="space-y-4">
      {/* Spec preview */}
      <div className="rounded-lg border border-white/10 bg-zinc-950/50 p-4">
        <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500 mb-2">
          Crystallized Spec
        </div>
        <p className="text-xs text-zinc-400 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto scrollbar-thin scrollbar-thumb-zinc-700">
          {truncatedSpec}
        </p>
      </div>

      {/* Handoff options */}
      <div className="text-[10px] uppercase tracking-[0.2em] text-zinc-500">
        Choose Execution Mode
      </div>
      <div className="grid gap-3">
        {handoffOptions.map(({ mode, icon: Icon, title, description, color, borderColor, bgColor }) => (
          <button
            key={mode}
            onClick={() => onHandoff(mode)}
            className={cn(
              "w-full text-left rounded-lg border p-4 transition-colors",
              borderColor,
              bgColor,
            )}
          >
            <div className="flex items-center gap-3">
              <div className={cn("shrink-0", color)}>
                <Icon className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <div className="text-sm font-medium text-zinc-200">
                  {title}
                </div>
                <p className="mt-1 text-xs text-zinc-400 leading-relaxed">
                  {description}
                </p>
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
