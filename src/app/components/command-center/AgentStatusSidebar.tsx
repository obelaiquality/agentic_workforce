import { formatDistanceToNow } from "date-fns";
import {
  Bot,
  MessageSquareText,
} from "lucide-react";
import type { MissionData } from "./types";
import { Chip, Panel, PanelHeader } from "../UI";

export interface AgentStatusSidebarProps {
  mission: MissionData;
  onOpenSettings: () => void;
}

export function AgentStatusSidebar({
  mission,
  onOpenSettings,
}: AgentStatusSidebarProps) {
  const channels = mission.experimentalAutonomy?.channels ?? [];
  const subagents = mission.experimentalAutonomy?.subagents ?? [];
  const hasActivity = channels.length > 0 || subagents.length > 0;

  return (
    <Panel className="border-white/8 bg-[#101114]">
      <PanelHeader title="Channels and Subagents">
        <div className="flex items-center gap-2">
          <Chip variant={hasActivity ? "warn" : "subtle"} className="text-[10px]">
            {hasActivity ? "experimental activity" : "experimental idle"}
          </Chip>
          <button
            type="button"
            onClick={onOpenSettings}
            className="rounded-lg border border-white/10 bg-white/[0.03] px-3 py-1.5 text-[10px] uppercase tracking-[0.14em] text-zinc-300 transition hover:bg-white/[0.08]"
          >
            Configure
          </button>
        </div>
      </PanelHeader>
      <div className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className="space-y-2 rounded-2xl border border-white/8 bg-black/20 p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            <MessageSquareText className="h-3.5 w-3.5" />
            Inbound Channels
          </div>
          {channels.slice(0, 4).map((event) => (
            <div key={event.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-white">{event.source}</div>
                <Chip variant={event.trustLevel === "trusted" ? "ok" : "warn"} className="text-[10px]">
                  {event.trustLevel}
                </Chip>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {event.senderId} · {formatDistanceToNow(new Date(event.createdAt), { addSuffix: true })}
              </div>
              <div className="mt-2 line-clamp-2 text-sm text-zinc-300">{event.content}</div>
            </div>
          ))}
          {!channels.length ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-4 text-sm text-zinc-500">
              No inbound channel activity yet. Enable webhook, Telegram, or CI monitoring in Advanced settings to start feeding live mission events.
            </div>
          ) : null}
        </div>

        <div className="space-y-2 rounded-2xl border border-white/8 bg-black/20 p-4">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-zinc-500">
            <Bot className="h-3.5 w-3.5" />
            Planned Subagents
          </div>
          {subagents.slice(0, 6).map((activity) => (
            <div key={activity.id} className="rounded-xl border border-white/10 bg-white/[0.02] px-3 py-2.5">
              <div className="flex items-center justify-between gap-3">
                <div className="text-sm text-white">{activity.role.replace(/_/g, " ")}</div>
                <Chip variant={activity.status === "completed" ? "ok" : activity.status === "failed" ? "stop" : "subtle"} className="text-[10px]">
                  {activity.status}
                </Chip>
              </div>
              <div className="mt-1 text-xs text-zinc-500">
                {formatDistanceToNow(new Date(activity.createdAt), { addSuffix: true })}
              </div>
              <div className="mt-2 text-sm text-zinc-300">{activity.summary}</div>
            </div>
          ))}
          {!subagents.length ? (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3 py-4 text-sm text-zinc-500">
              No subagent plans recorded yet. Experimental autonomy stays ticket-scoped and read-only by default.
            </div>
          ) : null}
        </div>
      </div>
    </Panel>
  );
}
