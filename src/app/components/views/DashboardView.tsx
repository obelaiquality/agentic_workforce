import { useMemo } from "react";
import {
  Activity,
  AlertTriangle,
  CheckCircle2,
  Circle,
  Clock,
  Gauge,
  Layers,
  Radio,
  Shield,
  Wifi,
  WifiOff,
  Zap,
} from "lucide-react";
import { cn } from "../UI";
import { useMissionControlLiveData } from "../../hooks/useMissionControlLiveData";

type MissionData = ReturnType<typeof useMissionControlLiveData>;

interface DashboardViewProps {
  mission: MissionData;
}

export function DashboardView({ mission }: DashboardViewProps) {
  const {
    agenticRun,
    liveState,
    selectedRepo,
    runPhase,
    pendingApprovals,
    workflowCards,
  } = mission;

  const recentActivity = useMemo(() => {
    if (!agenticRun) return [];

    const items: Array<{
      id: string;
      timestamp: string;
      type: "tool_call" | "compaction" | "escalation" | "error" | "event";
      description: string;
    }> = [];

    for (const tc of agenticRun.toolCalls.slice(-10)) {
      items.push({
        id: `tc-${tc.id}`,
        timestamp: tc.timestamp,
        type: "tool_call",
        description: `${tc.name} (${tc.durationMs}ms)`,
      });
    }

    for (const ce of agenticRun.compactionEvents) {
      const savings = ce.tokensBefore - ce.tokensAfter;
      items.push({
        id: `compact-${ce.iteration}-${ce.timestamp}`,
        timestamp: ce.timestamp,
        type: "compaction",
        description: `Stage ${ce.stage} compacted ${savings.toLocaleString()} tokens`,
      });
    }

    for (const esc of agenticRun.escalations) {
      items.push({
        id: `esc-${esc.iteration}-${esc.timestamp}`,
        timestamp: esc.timestamp,
        type: "escalation",
        description: `${esc.fromRole} -> ${esc.toRole}${esc.reason ? `: ${esc.reason}` : ""}`,
      });
    }

    for (const evt of agenticRun.recentEvents) {
      if (evt.type === "error") {
        items.push({
          id: evt.id,
          timestamp: evt.createdAt,
          type: "error",
          description: String((evt.payload as Record<string, unknown>).message || evt.type),
        });
      }
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items.slice(0, 10);
  }, [agenticRun]);

  const workflowCounts = useMemo(() => {
    const counts = { backlog: 0, in_progress: 0, needs_review: 0, completed: 0 };
    for (const card of workflowCards) {
      if (card.status in counts) {
        counts[card.status]++;
      }
    }
    return counts;
  }, [workflowCards]);

  const runStatus = agenticRun?.status ?? "idle";
  const systemStatus =
    liveState === "live"
      ? "live"
      : liveState === "degraded"
        ? "degraded"
        : "offline";

  const elapsedTime = useMemo(() => {
    if (!agenticRun || !agenticRun.budget.tokenTimeline.length) return null;
    const first = agenticRun.budget.tokenTimeline[0];
    const last = agenticRun.budget.tokenTimeline[agenticRun.budget.tokenTimeline.length - 1];
    const ms = new Date(last.timestamp).getTime() - new Date(first.timestamp).getTime();
    if (ms < 1000) return `${ms}ms`;
    if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
    return `${(ms / 60_000).toFixed(1)}m`;
  }, [agenticRun]);

  const tokenPercentage =
    agenticRun?.budget.tokensConsumed != null && agenticRun?.budget.maxTokens
      ? (agenticRun.budget.tokensConsumed / agenticRun.budget.maxTokens) * 100
      : null;

  return (
    <div data-testid="dashboard-view" className="space-y-6">
      {/* System Status Strip */}
      <div
        data-testid="system-status-strip"
        className="flex items-center gap-4 rounded-xl border border-white/6 bg-black/20 px-4 py-3"
      >
        <SystemStatusIndicator status={systemStatus} />
        <div className="h-5 w-px bg-white/10" />
        <div className="flex items-center gap-2 min-w-0">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Project</span>
          <span className="text-sm text-zinc-200 truncate">
            {selectedRepo?.displayName || "No project"}
          </span>
        </div>
        <div className="h-5 w-px bg-white/10" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Role</span>
          <span className="text-sm text-zinc-200 font-mono">
            {agenticRun?.latestRole || "none"}
          </span>
        </div>
        <div className="h-5 w-px bg-white/10" />
        <div className="flex items-center gap-2">
          <span className="text-xs text-zinc-500 uppercase tracking-wider">Run</span>
          <RunStatusChip status={runStatus} />
        </div>
      </div>

      {/* Active Run Panel */}
      {agenticRun && agenticRun.status !== "idle" && (
        <div
          data-testid="active-run-panel"
          className="rounded-xl border border-white/6 bg-black/20 p-4 space-y-4"
        >
          <div className="flex items-center gap-2">
            <Activity className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-medium text-zinc-200">Active Run</span>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            {/* Iteration counter */}
            <div className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
              <div className="text-xs text-zinc-500">Iterations</div>
              <div className="mt-1 text-base text-zinc-200">
                {agenticRun.budget.iterationsConsumed ?? agenticRun.iterationCount}
                {agenticRun.budget.maxIterations != null && (
                  <span className="text-xs text-zinc-500 ml-1">
                    / {agenticRun.budget.maxIterations}
                  </span>
                )}
              </div>
            </div>

            {/* Token consumption */}
            <div className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
              <div className="text-xs text-zinc-500">Tokens</div>
              <div className="mt-1 text-base text-zinc-200">
                {agenticRun.budget.tokensConsumed != null
                  ? agenticRun.budget.tokensConsumed.toLocaleString()
                  : "--"}
                {agenticRun.budget.maxTokens != null && (
                  <span className="text-xs text-zinc-500 ml-1">
                    / {agenticRun.budget.maxTokens.toLocaleString()}
                  </span>
                )}
              </div>
              {tokenPercentage != null && (
                <div className="mt-1.5 h-1 bg-white/5 rounded-full overflow-hidden">
                  <div
                    data-testid="token-bar"
                    className={cn(
                      "h-full rounded-full transition-all",
                      tokenPercentage >= 90
                        ? "bg-red-500"
                        : tokenPercentage >= 70
                          ? "bg-amber-500"
                          : "bg-emerald-500",
                    )}
                    style={{ width: `${Math.min(tokenPercentage, 100)}%` }}
                  />
                </div>
              )}
            </div>

            {/* Cost */}
            <div className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
              <div className="text-xs text-zinc-500">Cost</div>
              <div className="mt-1 text-base text-zinc-200">
                {agenticRun.budget.costUsdConsumed != null
                  ? `$${agenticRun.budget.costUsdConsumed.toFixed(4)}`
                  : "--"}
              </div>
            </div>

            {/* Elapsed time */}
            <div className="rounded-lg border border-white/6 bg-black/10 px-3 py-2">
              <div className="text-xs text-zinc-500">Elapsed</div>
              <div className="mt-1 text-base text-zinc-200 flex items-center gap-1.5">
                <Clock className="h-3.5 w-3.5 text-zinc-500" />
                {elapsedTime ?? "--"}
              </div>
            </div>
          </div>

          {/* Current phase */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 uppercase tracking-wider">Phase</span>
            <span
              className={cn(
                "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono tracking-wide",
                agenticRun.phase === "executing"
                  ? "bg-amber-500/10 text-amber-300 border-amber-500/20"
                  : agenticRun.phase === "planning"
                    ? "bg-cyan-500/10 text-cyan-300 border-cyan-500/20"
                    : agenticRun.phase === "completed"
                      ? "bg-emerald-500/10 text-emerald-300 border-emerald-500/20"
                      : "bg-violet-500/10 text-violet-300 border-violet-500/20",
              )}
            >
              {agenticRun.phase}
            </span>
          </div>
        </div>
      )}

      {/* Metrics Grid */}
      <div data-testid="metrics-grid" className="grid grid-cols-4 gap-3">
        <MetricCard
          icon={Zap}
          label="Tool Calls"
          value={agenticRun?.toolCallCount ?? 0}
        />
        <MetricCard
          icon={Shield}
          label="Pending Approvals"
          value={pendingApprovals.length}
          variant={pendingApprovals.length > 0 ? "warn" : "default"}
        />
        <MetricCard
          icon={Layers}
          label="Escalations"
          value={agenticRun?.escalationCount ?? 0}
        />
        <MetricCard
          icon={AlertTriangle}
          label="Doom Loops"
          value={agenticRun?.doomLoopCount ?? 0}
          variant={(agenticRun?.doomLoopCount ?? 0) > 0 ? "warn" : "default"}
        />
      </div>

      {/* Recent Activity Feed */}
      <div data-testid="activity-feed" className="rounded-xl border border-white/6 bg-black/20 overflow-hidden">
        <div className="px-4 py-3 border-b border-white/6 bg-white/[0.02]">
          <div className="flex items-center gap-2">
            <Radio className="h-4 w-4 text-cyan-400" />
            <span className="text-sm font-medium text-zinc-200">Recent Activity</span>
            {recentActivity.length > 0 && (
              <span className="text-xs text-zinc-500 font-mono">{recentActivity.length}</span>
            )}
          </div>
        </div>
        {recentActivity.length === 0 ? (
          <div className="px-4 py-8 text-center text-sm text-zinc-500">
            No recent activity. Start an agentic run to see events here.
          </div>
        ) : (
          <div className="max-h-64 overflow-y-auto custom-scrollbar">
            {recentActivity.map((item) => (
              <ActivityItem key={item.id} item={item} />
            ))}
          </div>
        )}
      </div>

      {/* Workflow Summary */}
      <div data-testid="workflow-summary" className="rounded-xl border border-white/6 bg-black/20 px-4 py-3">
        <div className="flex items-center gap-2 mb-3">
          <Gauge className="h-4 w-4 text-cyan-400" />
          <span className="text-sm font-medium text-zinc-200">Workflow Summary</span>
        </div>
        <div className="flex items-center gap-6">
          <WorkflowLaneCount label="Backlog" count={workflowCounts.backlog} color="zinc" />
          <WorkflowLaneCount label="In Progress" count={workflowCounts.in_progress} color="amber" />
          <WorkflowLaneCount label="Needs Review" count={workflowCounts.needs_review} color="violet" />
          <WorkflowLaneCount label="Completed" count={workflowCounts.completed} color="emerald" />
        </div>
      </div>
    </div>
  );
}

// -- Sub-components --

function SystemStatusIndicator({ status }: { status: "live" | "degraded" | "offline" }) {
  const config = {
    live: {
      icon: Wifi,
      label: "Live",
      dotClass: "bg-emerald-400",
      textClass: "text-emerald-300",
      borderClass: "border-emerald-500/20",
      bgClass: "bg-emerald-500/10",
    },
    degraded: {
      icon: AlertTriangle,
      label: "Degraded",
      dotClass: "bg-amber-400",
      textClass: "text-amber-300",
      borderClass: "border-amber-500/20",
      bgClass: "bg-amber-500/10",
    },
    offline: {
      icon: WifiOff,
      label: "Offline",
      dotClass: "bg-red-400",
      textClass: "text-red-300",
      borderClass: "border-red-500/20",
      bgClass: "bg-red-500/10",
    },
  };

  const c = config[status];
  const Icon = c.icon;

  return (
    <div
      data-testid="system-status-indicator"
      className={cn(
        "inline-flex items-center gap-2 rounded-full border px-2.5 py-1",
        c.borderClass,
        c.bgClass,
      )}
    >
      <span className={cn("h-2 w-2 rounded-full animate-pulse", c.dotClass)} />
      <Icon className={cn("h-3.5 w-3.5", c.textClass)} />
      <span className={cn("text-xs font-medium", c.textClass)}>{c.label}</span>
    </div>
  );
}

function RunStatusChip({ status }: { status: string }) {
  const variants: Record<string, { bg: string; text: string; border: string }> = {
    idle: { bg: "bg-zinc-500/10", text: "text-zinc-400", border: "border-zinc-500/20" },
    running: { bg: "bg-amber-500/10", text: "text-amber-300", border: "border-amber-500/20" },
    completed: { bg: "bg-emerald-500/10", text: "text-emerald-300", border: "border-emerald-500/20" },
    aborted: { bg: "bg-red-500/10", text: "text-red-300", border: "border-red-500/20" },
    failed: { bg: "bg-red-500/10", text: "text-red-300", border: "border-red-500/20" },
  };

  const v = variants[status] || variants.idle;

  return (
    <span
      className={cn(
        "inline-flex items-center px-2 py-0.5 rounded text-xs font-medium border font-mono tracking-wide uppercase",
        v.bg,
        v.text,
        v.border,
      )}
    >
      {status}
    </span>
  );
}

function MetricCard({
  icon: Icon,
  label,
  value,
  variant = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  variant?: "default" | "warn";
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon
          className={cn(
            "h-4 w-4",
            variant === "warn" ? "text-amber-400" : "text-cyan-400",
          )}
        />
        <span className="text-[10px] text-zinc-500 uppercase tracking-[0.2em]">{label}</span>
      </div>
      <div
        className={cn(
          "mt-1.5 text-xl font-semibold",
          variant === "warn" ? "text-amber-300" : "text-white",
        )}
      >
        {value.toLocaleString()}
      </div>
    </div>
  );
}

const EVENT_TYPE_STYLES: Record<string, { dot: string; text: string }> = {
  tool_call: { dot: "bg-cyan-400", text: "text-cyan-400" },
  compaction: { dot: "bg-amber-400", text: "text-amber-400" },
  escalation: { dot: "bg-violet-400", text: "text-violet-400" },
  error: { dot: "bg-red-400", text: "text-red-400" },
  event: { dot: "bg-zinc-400", text: "text-zinc-400" },
};

function ActivityItem({
  item,
}: {
  item: {
    id: string;
    timestamp: string;
    type: "tool_call" | "compaction" | "escalation" | "error" | "event";
    description: string;
  };
}) {
  const style = EVENT_TYPE_STYLES[item.type] || EVENT_TYPE_STYLES.event;

  return (
    <div
      data-testid="activity-item"
      className="flex items-start gap-3 px-4 py-2.5 border-b border-white/[0.03] last:border-b-0 hover:bg-white/[0.02] transition-colors"
    >
      <span className={cn("mt-1.5 h-2 w-2 rounded-full shrink-0", style.dot)} />
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className={cn("text-xs font-medium uppercase tracking-wider", style.text)}>
            {item.type.replace("_", " ")}
          </span>
          <span className="text-[10px] text-zinc-600 font-mono">
            {formatTimestamp(item.timestamp)}
          </span>
        </div>
        <div className="text-sm text-zinc-300 mt-0.5 truncate">{item.description}</div>
      </div>
    </div>
  );
}

function WorkflowLaneCount({
  label,
  count,
  color,
}: {
  label: string;
  count: number;
  color: "zinc" | "amber" | "violet" | "emerald";
}) {
  const dotColors = {
    zinc: "bg-zinc-400",
    amber: "bg-amber-400",
    violet: "bg-violet-400",
    emerald: "bg-emerald-400",
  };

  return (
    <div className="flex items-center gap-2">
      <span className={cn("h-2.5 w-2.5 rounded-full", dotColors[color])} />
      <span className="text-xs text-zinc-500">{label}</span>
      <span className="text-sm font-semibold text-zinc-200">{count}</span>
    </div>
  );
}

function formatTimestamp(iso: string): string {
  try {
    return new Date(iso).toLocaleTimeString([], {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return iso;
  }
}
