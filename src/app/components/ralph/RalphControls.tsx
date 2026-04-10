import { Play, Pause, Loader } from "lucide-react";
import { cn, Button, Chip } from "../UI";

interface RalphControlsProps {
  sessionId: string;
  status: string;
  iteration: number;
  maxIterations: number;
  onPause: () => void;
  onResume: () => void;
}

export function RalphControls({
  sessionId: _sessionId,
  status,
  iteration,
  maxIterations,
  onPause,
  onResume,
}: RalphControlsProps) {
  const isRunning = status === "running";
  const isPaused = status === "paused";
  const isTerminal = status === "completed" || status === "failed";

  return (
    <div className="flex items-center gap-3">
      {/* Iteration counter */}
      <Chip variant="subtle">
        Iter {iteration}/{maxIterations}
      </Chip>

      {/* Status chip */}
      <Chip
        variant={
          isRunning
            ? "ok"
            : isPaused
              ? "warn"
              : status === "completed"
                ? "ok"
                : "stop"
        }
      >
        <span className="flex items-center gap-1">
          {isRunning && <Loader className="w-3 h-3 animate-spin" />}
          {status}
        </span>
      </Chip>

      {/* Action buttons */}
      {!isTerminal && (
        <>
          {isRunning && (
            <Button variant="subtle" onClick={onPause}>
              <Pause className="w-3.5 h-3.5" />
              Pause
            </Button>
          )}
          {isPaused && (
            <Button variant="primary" onClick={onResume}>
              <Play className="w-3.5 h-3.5" />
              Resume
            </Button>
          )}
        </>
      )}
    </div>
  );
}
