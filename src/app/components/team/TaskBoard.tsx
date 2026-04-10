import { cn, Chip } from "../UI";
import { Clock, Layers } from "lucide-react";

interface TaskDto {
  id: string;
  name: string;
  description: string;
  assignedTo: string | null;
  priority: number;
  status: string;
  leaseExpires: string | null;
  result: string | null;
}

interface TaskBoardProps {
  tasks: TaskDto[];
}

function leaseRemaining(leaseExpires: string | null): string | null {
  if (!leaseExpires) return null;
  const remaining = Math.max(0, Math.floor((new Date(leaseExpires).getTime() - Date.now()) / 1000));
  if (remaining <= 0) return "expired";
  if (remaining < 60) return `${remaining}s`;
  return `${Math.floor(remaining / 60)}m ${remaining % 60}s`;
}

function priorityVariant(priority: number): "stop" | "warn" | "subtle" {
  if (priority >= 8) return "stop";
  if (priority >= 5) return "warn";
  return "subtle";
}

function TaskCard({ task }: { task: TaskDto }) {
  const lease = leaseRemaining(task.leaseExpires);

  return (
    <div className="rounded-lg border border-white/10 bg-zinc-900/60 p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium text-zinc-200 truncate">{task.name}</span>
        <Chip variant={priorityVariant(task.priority)}>P{task.priority}</Chip>
      </div>

      {task.description && (
        <p className="text-xs text-zinc-400 line-clamp-2">{task.description}</p>
      )}

      {task.assignedTo && (
        <div className="text-xs text-zinc-400">
          Assigned: <span className="text-zinc-300">{task.assignedTo}</span>
        </div>
      )}

      {lease && (
        <div className="flex items-center gap-1 text-xs text-zinc-500">
          <Clock className="h-3 w-3" />
          <span className={cn(lease === "expired" && "text-rose-400")}>
            {lease === "expired" ? "Lease expired" : `Lease: ${lease}`}
          </span>
        </div>
      )}

      {task.result && (
        <p className="text-xs text-zinc-500 line-clamp-2 italic">{task.result}</p>
      )}
    </div>
  );
}

const COLUMNS = [
  { key: "pending", label: "Pending", statuses: ["pending", "blocked"] },
  { key: "in_progress", label: "In Progress", statuses: ["claimed", "executing"] },
  { key: "completed", label: "Completed", statuses: ["completed", "failed"] },
] as const;

export function TaskBoard({ tasks }: TaskBoardProps) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4 px-5 py-4">
      {COLUMNS.map((col) => {
        const columnTasks = tasks.filter((t) => col.statuses.includes(t.status));

        return (
          <div key={col.key} className="flex flex-col gap-2">
            <div className="flex items-center gap-2 pb-1 border-b border-white/5">
              <Layers className="h-3.5 w-3.5 text-zinc-500" />
              <span className="text-xs font-semibold uppercase tracking-wider text-zinc-400">
                {col.label}
              </span>
              <span className="text-xs text-zinc-600">{columnTasks.length}</span>
            </div>

            {columnTasks.length === 0 ? (
              <div className="text-xs text-zinc-600 italic py-2">No tasks</div>
            ) : (
              <div className="flex flex-col gap-2">
                {columnTasks.map((task) => (
                  <TaskCard key={task.id} task={task} />
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
