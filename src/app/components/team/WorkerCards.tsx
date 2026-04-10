import { cn, Chip } from "../UI";
import { Heart } from "lucide-react";

interface WorkerDto {
  id: string;
  workerId: string;
  role: string;
  status: string;
  currentTaskId: string | null;
  lastHeartbeatAt: string;
}

interface WorkerCardsProps {
  workers: WorkerDto[];
}

const STATUS_COLORS: Record<string, { dot: string; variant: "ok" | "stop" | "warn" | "subtle" }> = {
  executing: { dot: "bg-emerald-400", variant: "ok" },
  claimed: { dot: "bg-emerald-400", variant: "ok" },
  idle: { dot: "bg-amber-400", variant: "warn" },
  failed: { dot: "bg-rose-400", variant: "stop" },
  completed: { dot: "bg-zinc-500", variant: "subtle" },
};

function timeAgo(isoDate: string): string {
  const diff = Math.max(0, Math.floor((Date.now() - new Date(isoDate).getTime()) / 1000));
  if (diff < 60) return `${diff}s ago`;
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  return `${Math.floor(diff / 3600)}h ago`;
}

export function WorkerCards({ workers }: WorkerCardsProps) {
  if (workers.length === 0) {
    return (
      <div className="px-5 py-4 text-sm text-zinc-500 italic">
        No workers active yet.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 px-5 py-4">
      {workers.map((worker) => {
        const statusConfig = STATUS_COLORS[worker.status] ?? STATUS_COLORS.idle;

        return (
          <div
            key={worker.id}
            className={cn(
              "rounded-lg border border-white/10 bg-zinc-900/60 p-3 flex flex-col gap-2",
              worker.status === "failed" && "border-rose-500/30",
            )}
          >
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className={cn("h-2 w-2 rounded-full", statusConfig.dot)} />
                <span className="text-sm font-medium text-zinc-200 truncate">
                  {worker.workerId}
                </span>
              </div>
              <Chip variant={statusConfig.variant}>
                {worker.status}
              </Chip>
            </div>

            <div className="flex items-center gap-2">
              <Chip variant="subtle">{worker.role}</Chip>
            </div>

            {worker.currentTaskId && (
              <div className="text-xs text-zinc-400 truncate">
                Task: <span className="text-zinc-300">{worker.currentTaskId}</span>
              </div>
            )}

            <div className="flex items-center gap-1 text-xs text-zinc-500">
              <Heart className="h-3 w-3" />
              <span>{timeAgo(worker.lastHeartbeatAt)}</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
