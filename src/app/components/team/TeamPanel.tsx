import type { TeamPhase } from "../../../../shared/contracts";
import { cn, Panel, PanelHeader } from "../../UI";
import { Users, AlertTriangle } from "lucide-react";
import { useTeamSession, useTeamWorkers, useTeamTasks, useTeamMessages, useTeamStream } from "../../hooks/useTeamMode";
import { PhaseIndicator } from "./PhaseIndicator";
import { WorkerCards } from "./WorkerCards";
import { TaskBoard } from "./TaskBoard";
import { MessageLog } from "./MessageLog";

interface TeamPanelProps {
  sessionId: string;
}

export function TeamPanel({ sessionId }: TeamPanelProps) {
  const sessionQuery = useTeamSession(sessionId);
  const workersQuery = useTeamWorkers(sessionId);
  const tasksQuery = useTeamTasks(sessionId);
  const messagesQuery = useTeamMessages(sessionId, null);
  const { connected } = useTeamStream(sessionId);

  const session = sessionQuery.data?.session ?? null;
  const workers = workersQuery.data?.workers ?? [];
  const tasks = tasksQuery.data?.tasks ?? [];
  const messages = messagesQuery.data?.messages ?? [];

  const isLoading = sessionQuery.isLoading || workersQuery.isLoading || tasksQuery.isLoading;
  const isError = sessionQuery.isError || workersQuery.isError || tasksQuery.isError;

  if (isLoading) {
    return (
      <Panel>
        <PanelHeader title="Team Mode" />
        <div className="px-5 py-8 text-sm text-zinc-500 text-center">Loading team session...</div>
      </Panel>
    );
  }

  if (isError || !session) {
    return (
      <Panel>
        <PanelHeader title="Team Mode" />
        <div className="px-5 py-8 flex items-center justify-center gap-2 text-sm text-rose-400">
          <AlertTriangle className="h-4 w-4" />
          <span>Failed to load team session.</span>
        </div>
      </Panel>
    );
  }

  const phase = (session.phase ?? "team_plan") as TeamPhase;

  return (
    <Panel className="flex flex-col">
      {/* Header */}
      <PanelHeader
        title={
          <div className="flex items-center gap-3">
            <Users className="h-4 w-4 text-zinc-400" />
            <span className="truncate max-w-md">
              Team: &ldquo;{session.objective}&rdquo;
            </span>
          </div>
        }
      >
        <PhaseIndicator phase={phase} />
        <span className="text-xs text-zinc-500">
          Workers: {workers.length}
        </span>
        {!connected && (
          <span className="text-[10px] text-amber-500 uppercase tracking-wider">Disconnected</span>
        )}
      </PanelHeader>

      {/* Worker Cards */}
      <section>
        <div className="px-5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Workers
        </div>
        <WorkerCards workers={workers} />
      </section>

      {/* Divider */}
      <div className="border-t border-white/5" />

      {/* Task Board */}
      <section>
        <div className="px-5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Tasks
        </div>
        <TaskBoard tasks={tasks} />
      </section>

      {/* Divider */}
      <div className="border-t border-white/5" />

      {/* Message Log */}
      <section>
        <div className="px-5 pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-zinc-500">
          Messages
        </div>
        <MessageLog messages={messages} />
      </section>
    </Panel>
  );
}
