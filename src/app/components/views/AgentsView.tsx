import { AgentWorker } from "../../data/mockData";
import { Panel, PanelHeader, Chip } from "../UI";
import { Activity, Cpu, Zap, Clock, CheckCircle2, XCircle, Pause, AlertTriangle } from "lucide-react";
import { formatDistanceToNow } from "date-fns";

const STATUS_CONFIG = {
  active: { label: "Active", color: "text-emerald-400", bg: "bg-emerald-500/10", border: "border-emerald-500/20", dot: "bg-emerald-500", glow: "shadow-[0_0_8px_rgba(16,185,129,0.6)]" },
  idle: { label: "Idle", color: "text-zinc-400", bg: "bg-zinc-800/50", border: "border-zinc-700", dot: "bg-zinc-500", glow: "" },
  error: { label: "Error", color: "text-rose-400", bg: "bg-rose-500/10", border: "border-rose-500/20", dot: "bg-rose-500", glow: "shadow-[0_0_8px_rgba(244,63,94,0.6)]" },
  cooldown: { label: "Cooldown", color: "text-amber-400", bg: "bg-amber-500/10", border: "border-amber-500/20", dot: "bg-amber-500", glow: "" },
};

export function AgentsView({ agents }: { agents: AgentWorker[] }) {
  const activeCount = agents.filter(a => a.status === "active").length;
  const errorCount = agents.filter(a => a.status === "error").length;
  const totalTokens = agents.reduce((s, a) => s + a.tokensUsed, 0);

  return (
    <div className="space-y-4">
      {/* Summary Bar */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { label: "Total Workers", value: agents.length, color: "text-zinc-200" },
          { label: "Active", value: activeCount, color: "text-emerald-400" },
          { label: "Errors", value: errorCount, color: errorCount > 0 ? "text-rose-400" : "text-zinc-400" },
          { label: "Total Tokens", value: `${(totalTokens / 1000).toFixed(1)}k`, color: "text-purple-400" },
        ].map(s => (
          <div key={s.label} className="bg-[#121214] border border-white/8 rounded-lg p-3 text-center">
            <div className="text-[10px] text-zinc-500 uppercase tracking-wide mb-1">{s.label}</div>
            <div className={`text-xl font-mono font-medium ${s.color}`}>{s.value}</div>
          </div>
        ))}
      </div>

      {/* Agent Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
        {agents.map(agent => {
          const cfg = STATUS_CONFIG[agent.status];
          const tokenPct = Math.min(100, Math.round((agent.tokensUsed / agent.tokensLimit) * 100));
          return (
            <div
              key={agent.id}
              className={`bg-[#121214] border rounded-xl p-4 flex flex-col gap-3 ${cfg.border}`}
            >
              {/* Header */}
              <div className="flex items-start justify-between">
                <div className="flex items-center gap-2">
                  <div className={`w-2.5 h-2.5 rounded-full ${cfg.dot} ${cfg.glow} ${agent.status === "active" ? "animate-pulse" : ""}`} />
                  <div>
                    <div className="text-sm font-semibold text-zinc-100">Worker-{agent.workerId}</div>
                    <div className="text-[10px] font-mono text-zinc-500">{agent.model}</div>
                  </div>
                </div>
                <span className={`text-[10px] font-medium px-2 py-0.5 rounded-full border ${cfg.bg} ${cfg.color} ${cfg.border}`}>
                  {cfg.label}
                </span>
              </div>

              {/* Current Task */}
              <div className="bg-black/30 rounded-md p-2.5 border border-white/5 min-h-[48px]">
                {agent.currentTask ? (
                  <>
                    <div className="text-[9px] font-mono text-purple-400 mb-0.5">{agent.currentTask}</div>
                    <div className="text-xs text-zinc-300 truncate">{agent.taskTitle}</div>
                  </>
                ) : (
                  <div className="text-xs text-zinc-600 flex items-center gap-1.5 h-full">
                    <Pause className="w-3 h-3" /> Awaiting task assignment
                  </div>
                )}
              </div>

              {/* Token Bar */}
              <div>
                <div className="flex justify-between text-[10px] font-mono mb-1.5">
                  <span className="text-zinc-500">Token Budget</span>
                  <span className={tokenPct > 80 ? "text-amber-400" : "text-zinc-400"}>
                    {(agent.tokensUsed / 1000).toFixed(1)}k / {(agent.tokensLimit / 1000).toFixed(0)}k
                  </span>
                </div>
                <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all duration-500 ${
                      tokenPct > 80 ? "bg-amber-500" : tokenPct > 60 ? "bg-purple-500" : "bg-purple-600"
                    }`}
                    style={{ width: `${tokenPct}%` }}
                  />
                </div>
              </div>

              {/* Stats Row */}
              <div className="grid grid-cols-3 gap-2 text-center">
                {[
                  { icon: <CheckCircle2 className="w-3 h-3 text-emerald-500" />, value: agent.completedTasks, label: "Done" },
                  { icon: <XCircle className="w-3 h-3 text-rose-500" />, value: agent.failedTasks, label: "Failed" },
                  { icon: <Zap className="w-3 h-3 text-cyan-500" />, value: `${agent.avgResponseTime}s`, label: "Avg RT" },
                ].map((s, i) => (
                  <div key={i} className="bg-zinc-900/60 rounded-md p-2">
                    <div className="flex justify-center mb-0.5">{s.icon}</div>
                    <div className="text-xs font-mono font-medium text-zinc-200">{s.value}</div>
                    <div className="text-[9px] text-zinc-600">{s.label}</div>
                  </div>
                ))}
              </div>

              {/* Capabilities & Uptime */}
              <div className="flex items-center justify-between pt-1 border-t border-white/5">
                <div className="flex gap-1 flex-wrap">
                  {agent.capabilities.map(c => (
                    <span key={c} className="text-[9px] px-1.5 py-0.5 rounded bg-purple-500/10 text-purple-400 border border-purple-500/20 font-mono">
                      {c}
                    </span>
                  ))}
                </div>
                <div className="flex items-center gap-1 text-[10px] text-zinc-600 font-mono shrink-0">
                  <Clock className="w-3 h-3" />
                  {agent.uptime}
                </div>
              </div>

              {/* Last Heartbeat */}
              <div className="text-[9px] text-zinc-600 font-mono flex items-center gap-1">
                <Activity className="w-3 h-3" />
                Heartbeat: {formatDistanceToNow(new Date(agent.lastHeartbeat), { addSuffix: true })}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
