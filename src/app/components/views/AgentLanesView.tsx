import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Power, Users } from "lucide-react";
import { listAgentLanesV3, reclaimAgentLaneV3, spawnAgentLaneV3 } from "../../lib/apiClient";
import type { AgentLane } from "../../../shared/contracts";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";

const ROLE_COLORS: Record<AgentLane["role"], string> = {
  planner: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  implementer: "bg-green-500/10 text-green-300 border-green-500/20",
  verifier: "bg-purple-500/10 text-purple-300 border-purple-500/20",
  integrator: "bg-orange-500/10 text-orange-300 border-orange-500/20",
  researcher: "bg-cyan-500/10 text-cyan-300 border-cyan-500/20",
};

const STATE_COLORS: Record<AgentLane["state"], string> = {
  running: "bg-emerald-500/10 text-emerald-300 border-emerald-500/20",
  queued: "bg-amber-500/10 text-amber-300 border-amber-500/20",
  blocked: "bg-red-500/10 text-red-300 border-red-500/20",
  stale: "bg-zinc-500/10 text-zinc-400 border-zinc-500/20",
  completed: "bg-blue-500/10 text-blue-300 border-blue-500/20",
  failed: "bg-rose-500/10 text-rose-300 border-rose-500/20",
};

const EMPTY_DRAFT = {
  ticketId: "",
  runId: "",
  role: "implementer" as AgentLane["role"],
  objective: "",
  fileScope: "",
};

export function AgentLanesView() {
  const queryClient = useQueryClient();
  const [showSpawnForm, setShowSpawnForm] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);

  const lanesQuery = useQuery({
    queryKey: ["agentLanes"],
    queryFn: () => listAgentLanesV3(),
    refetchInterval: 5000, // Poll every 5 seconds
  });

  const spawnMutation = useMutation({
    mutationFn: async () => {
      return spawnAgentLaneV3({
        actor: "user",
        ticket_id: draft.ticketId.trim(),
        run_id: draft.runId.trim() || undefined,
        role: draft.role,
        summary: draft.objective.trim() || undefined,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["agentLanes"] });
      setShowSpawnForm(false);
      setDraft(EMPTY_DRAFT);
    },
  });

  const reclaimMutation = useMutation({
    mutationFn: (laneId: string) => reclaimAgentLaneV3({ actor: "user", lane_id: laneId }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["agentLanes"] }),
  });

  const lanes = lanesQuery.data?.items || [];

  if (lanesQuery.isLoading) {
    return <div className="p-4 text-sm text-zinc-500">Loading agent lanes...</div>;
  }

  return (
    <div className="space-y-4">
      <div className="rounded-xl border border-white/8 bg-black/20 p-4">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="text-xs uppercase tracking-[0.2em] text-zinc-500">Agent Lanes</div>
            <div className="mt-1 text-sm text-zinc-300">
              {lanes.length} active {lanes.length === 1 ? "agent" : "agents"}
            </div>
          </div>
          <Button
            type="button"
            onClick={() => setShowSpawnForm(!showSpawnForm)}
            variant="outline"
            size="sm"
            className="gap-2"
          >
            <Plus className="h-3.5 w-3.5" />
            Spawn agent
          </Button>
        </div>

        {showSpawnForm && (
          <div className="mt-4 space-y-3 rounded-lg border border-white/10 bg-[#111113] p-4">
            <div className="text-xs font-medium text-zinc-400">Spawn new agent lane</div>

            <div className="grid gap-3 md:grid-cols-2">
              <label className="space-y-1">
                <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Ticket ID *</span>
                <input
                  aria-label="Ticket ID"
                  value={draft.ticketId}
                  onChange={(e) => setDraft((prev) => ({ ...prev, ticketId: e.target.value }))}
                  placeholder="ticket-123"
                  className="w-full rounded-lg border border-white/10 bg-[#0a0a0c] px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                />
              </label>

              <label className="space-y-1">
                <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Role</span>
                <select
                  aria-label="Agent role"
                  value={draft.role}
                  onChange={(e) => setDraft((prev) => ({ ...prev, role: e.target.value as AgentLane["role"] }))}
                  className="w-full rounded-lg border border-white/10 bg-[#0a0a0c] px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
                >
                  <option value="planner">Planner</option>
                  <option value="implementer">Implementer</option>
                  <option value="verifier">Verifier</option>
                  <option value="integrator">Integrator</option>
                  <option value="researcher">Researcher</option>
                </select>
              </label>
            </div>

            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Run ID (optional)</span>
              <input
                aria-label="Run ID"
                value={draft.runId}
                onChange={(e) => setDraft((prev) => ({ ...prev, runId: e.target.value }))}
                placeholder="run-456"
                className="w-full rounded-lg border border-white/10 bg-[#0a0a0c] px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
              />
            </label>

            <label className="block space-y-1">
              <span className="text-[11px] uppercase tracking-[0.16em] text-zinc-500">Objective / Summary (optional)</span>
              <textarea
                aria-label="Objective"
                value={draft.objective}
                onChange={(e) => setDraft((prev) => ({ ...prev, objective: e.target.value }))}
                rows={3}
                placeholder="Brief description of the agent's task"
                className="w-full rounded-lg border border-white/10 bg-[#0a0a0c] px-3 py-2 text-sm text-white outline-none focus:border-cyan-500/50 focus:ring-2 focus:ring-cyan-500/20"
              />
            </label>

            <div className="flex items-center gap-2">
              <Button
                type="button"
                onClick={() => spawnMutation.mutate()}
                disabled={!draft.ticketId.trim() || spawnMutation.isPending}
                size="sm"
              >
                {spawnMutation.isPending ? "Spawning..." : "Spawn agent"}
              </Button>
              <Button
                type="button"
                onClick={() => {
                  setShowSpawnForm(false);
                  setDraft(EMPTY_DRAFT);
                }}
                variant="outline"
                size="sm"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}
      </div>

      {lanes.length === 0 ? (
        <div className="rounded-xl border border-dashed border-white/10 p-8 text-center">
          <Users className="mx-auto mb-3 h-8 w-8 text-zinc-700" />
          <div className="text-sm text-zinc-400">No active agent lanes</div>
          <div className="mt-1 text-xs text-zinc-600">
            Spawn an agent to work on a task in parallel
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {lanes.map((lane) => (
            <AgentLaneCard
              key={lane.id}
              lane={lane}
              onReclaim={() => reclaimMutation.mutate(lane.id)}
              isReclaiming={reclaimMutation.isPending}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentLaneCard({
  lane,
  onReclaim,
  isReclaiming,
}: {
  lane: AgentLane;
  onReclaim: () => void;
  isReclaiming: boolean;
}) {
  const shortId = lane.id.split("-").slice(0, 2).join("-");
  const leaseExpires = new Date(lane.leaseExpiresAt);
  const now = new Date();
  const isExpiringSoon = leaseExpires.getTime() - now.getTime() < 5 * 60 * 1000; // 5 minutes

  return (
    <div className="rounded-xl border border-white/6 bg-black/20 p-4">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0 flex-1 space-y-2">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="font-mono text-xs text-zinc-500">{shortId}</span>
            <Badge className={ROLE_COLORS[lane.role]}>{lane.role}</Badge>
            <Badge className={STATE_COLORS[lane.state]}>{lane.state}</Badge>
            {isExpiringSoon && lane.state === "running" && (
              <Badge className="bg-amber-500/10 text-amber-300 border-amber-500/20">
                lease expiring soon
              </Badge>
            )}
          </div>

          <div className="space-y-1">
            <div className="text-xs text-zinc-400">
              <span className="text-zinc-500">Ticket:</span> {lane.ticketId}
            </div>
            {lane.runId && (
              <div className="text-xs text-zinc-400">
                <span className="text-zinc-500">Run:</span> {lane.runId}
              </div>
            )}
            {lane.metadata?.summary && (
              <div className="text-sm text-zinc-300 mt-2">
                {String(lane.metadata.summary)}
              </div>
            )}
          </div>

          <div className="flex items-center gap-4 text-[10px] text-zinc-600">
            <div>
              <span className="text-zinc-500">Worktree:</span>{" "}
              {lane.worktreePath.split("/").pop() || lane.worktreePath}
            </div>
            <div>
              <span className="text-zinc-500">Lease:</span>{" "}
              {leaseExpires.toLocaleTimeString()}
            </div>
            {lane.lastHeartbeatAt && (
              <div>
                <span className="text-zinc-500">Last heartbeat:</span>{" "}
                {new Date(lane.lastHeartbeatAt).toLocaleTimeString()}
              </div>
            )}
          </div>
        </div>

        <Button
          type="button"
          onClick={onReclaim}
          disabled={isReclaiming}
          variant="outline"
          size="sm"
          className="gap-1.5 shrink-0"
          aria-label={`Reclaim agent ${shortId}`}
        >
          <Power className="h-3.5 w-3.5" />
          {isReclaiming ? "Stopping..." : "Reclaim"}
        </Button>
      </div>
    </div>
  );
}
