import { cn } from "./utils";

type ProcessingKind =
  | "thinking"
  | "processing"
  | "verifying"
  | "routing"
  | "telemetry"
  | "repo"
  | "blueprint"
  | "context"
  | "board"
  | "provider"
  | "worker"
  | "mutation";
type ProcessingSize = "xs" | "sm" | "md";
type ProcessingTone = "subtle" | "accent";

const ASSET_BY_KIND: Record<ProcessingKind, string> = {
  thinking: "/assets/neural-matrix.svg",
  processing: "/assets/helix-progress.svg",
  verifying: "/assets/verification-shield.svg",
  routing: "/assets/quantum-rail.svg",
  telemetry: "/assets/telemetry-wave.svg",
  repo: "/assets/repo-gateway.svg",
  blueprint: "/assets/structural-blueprint.svg",
  context: "/assets/hypercube.svg",
  board: "/assets/autonomous-kanban.svg",
  provider: "/assets/provider-switchboard.svg",
  worker: "/assets/worker-cluster.svg",
  mutation: "/assets/mutation-forge.svg",
};

const SIZE_CLASS: Record<ProcessingSize, string> = {
  xs: "h-3.5 w-3.5",
  sm: "h-4 w-4",
  md: "h-5 w-5",
};

export function ProcessingIndicator({
  kind,
  active = false,
  size = "sm",
  tone = "subtle",
  className,
  alt,
}: {
  kind: ProcessingKind;
  active?: boolean;
  size?: ProcessingSize;
  tone?: ProcessingTone;
  className?: string;
  alt?: string;
}) {
  const assetSrc = ASSET_BY_KIND[kind] ?? ASSET_BY_KIND.processing;
  return (
    <span
      className={cn(
        "inline-flex shrink-0 items-center justify-center rounded-full p-0.5",
        tone === "accent" ? "border border-white/10 bg-white/[0.04]" : "border border-white/6 bg-white/[0.02]",
        active ? "shadow-[0_0_10px_rgba(34,211,238,0.10)]" : "opacity-70",
        className
      )}
      aria-hidden={alt ? undefined : true}
    >
      <img
        src={assetSrc}
        alt={alt || ""}
        className={cn(
          SIZE_CLASS[size],
          tone === "subtle" ? "opacity-65 saturate-[0.82]" : "opacity-90",
          active ? "motion-safe:animate-[pulse_2.8s_ease-in-out_infinite]" : ""
        )}
      />
    </span>
  );
}
