import {
  AreaChart, Area, BarChart, Bar,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend,
  ResponsiveContainer,
} from "recharts";
import { TelemetryDataPoint, TaskCompletionPoint, AgentWorker } from "../../data/mockData";
import { Activity, Zap, Clock, TrendingUp } from "lucide-react";

const CHART_STYLE = {
  background: "transparent",
  border: "none",
};

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="bg-[#1a1a1d] border border-white/10 rounded-lg p-2.5 shadow-xl text-xs font-mono">
      <div className="text-zinc-400 mb-1.5">{label}</div>
      {payload.map((entry: any) => (
        <div key={entry.name} className="flex justify-between gap-4" style={{ color: entry.color }}>
          <span>{entry.name}</span>
          <span>{typeof entry.value === "number" ? entry.value.toLocaleString() : entry.value}</span>
        </div>
      ))}
    </div>
  );
}

export function TelemetryView({
  tokenData,
  taskData,
  agents,
}: {
  tokenData: TelemetryDataPoint[];
  taskData: TaskCompletionPoint[];
  agents: AgentWorker[];
}) {
  const totalTokens = tokenData.reduce((s, d) => s + d.total, 0);
  const totalCompleted = taskData.reduce((s, d) => s + d.completed, 0);
  const totalFailed = taskData.reduce((s, d) => s + d.failed, 0);
  const successRate = totalCompleted > 0 ? Math.round((totalCompleted / (totalCompleted + totalFailed)) * 100) : 0;
  const avgResponse = (agents.reduce((s, a) => s + a.avgResponseTime, 0) / agents.length).toFixed(1);

  return (
    <div className="space-y-4">
      {/* KPI Row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {[
          { icon: <Zap className="w-4 h-4 text-purple-400" />, label: "Total Tokens", value: `${(totalTokens / 1000).toFixed(0)}k`, sub: "this session" },
          { icon: <Activity className="w-4 h-4 text-emerald-400" />, label: "Tasks Done", value: totalCompleted, sub: `${totalFailed} failed` },
          { icon: <TrendingUp className="w-4 h-4 text-cyan-400" />, label: "Success Rate", value: `${successRate}%`, sub: "task completion" },
          { icon: <Clock className="w-4 h-4 text-amber-400" />, label: "Avg Response", value: `${avgResponse}s`, sub: "across workers" },
        ].map((kpi, i) => (
          <div key={i} className="bg-[#121214] border border-white/8 rounded-xl p-4">
            <div className="flex items-center gap-2 mb-2">
              {kpi.icon}
              <span className="text-[10px] text-zinc-500 uppercase tracking-wide">{kpi.label}</span>
            </div>
            <div className="text-2xl font-mono font-medium text-zinc-100">{kpi.value}</div>
            <div className="text-[10px] text-zinc-600 mt-0.5">{kpi.sub}</div>
          </div>
        ))}
      </div>

      {/* Token Usage Chart */}
      <div className="bg-[#121214] border border-white/8 rounded-xl p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-zinc-200">Token Consumption Over Time</h3>
          <div className="flex items-center gap-3 text-[10px] font-mono">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-purple-500 inline-block" /> W1</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-cyan-500 inline-block" /> W2</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-emerald-500 inline-block" /> W3</span>
          </div>
        </div>
        <ResponsiveContainer width="100%" height={200}>
          <AreaChart data={tokenData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
            <defs>
              <linearGradient id="gW1" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#a855f7" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#a855f7" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gW2" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#06b6d4" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#06b6d4" stopOpacity={0} />
              </linearGradient>
              <linearGradient id="gW3" x1="0" y1="0" x2="0" y2="1">
                <stop offset="5%" stopColor="#10b981" stopOpacity={0.3} />
                <stop offset="95%" stopColor="#10b981" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
            <XAxis dataKey="time" tick={{ fill: "#52525b", fontSize: 9 }} axisLine={false} tickLine={false} interval={3} />
            <YAxis tick={{ fill: "#52525b", fontSize: 9 }} axisLine={false} tickLine={false} />
            <Tooltip content={<CustomTooltip />} />
            <Area type="monotone" dataKey="w1" name="Worker 1" stroke="#a855f7" strokeWidth={1.5} fill="url(#gW1)" dot={false} />
            <Area type="monotone" dataKey="w2" name="Worker 2" stroke="#06b6d4" strokeWidth={1.5} fill="url(#gW2)" dot={false} />
            <Area type="monotone" dataKey="w3" name="Worker 3" stroke="#10b981" strokeWidth={1.5} fill="url(#gW3)" dot={false} />
          </AreaChart>
        </ResponsiveContainer>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {/* Task Throughput */}
        <div className="bg-[#121214] border border-white/8 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-zinc-200 mb-4">Task Throughput</h3>
          <ResponsiveContainer width="100%" height={180}>
            <BarChart data={taskData} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.04)" />
              <XAxis dataKey="hour" tick={{ fill: "#52525b", fontSize: 9 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#52525b", fontSize: 9 }} axisLine={false} tickLine={false} />
              <Tooltip content={<CustomTooltip />} />
              <Bar dataKey="completed" name="Completed" fill="#10b981" radius={[3, 3, 0, 0]} maxBarSize={24} opacity={0.85} />
              <Bar dataKey="failed" name="Failed" fill="#f43f5e" radius={[3, 3, 0, 0]} maxBarSize={24} opacity={0.85} />
            </BarChart>
          </ResponsiveContainer>
        </div>

        {/* Worker Performance Table */}
        <div className="bg-[#121214] border border-white/8 rounded-xl p-4">
          <h3 className="text-sm font-semibold text-zinc-200 mb-4">Worker Performance</h3>
          <div className="space-y-3">
            {agents.map(agent => {
              const tokenPct = Math.min(100, Math.round((agent.tokensUsed / agent.tokensLimit) * 100));
              const successRate = agent.completedTasks > 0
                ? Math.round((agent.completedTasks / (agent.completedTasks + agent.failedTasks)) * 100)
                : 0;
              return (
                <div key={agent.id} className="flex items-center gap-3">
                  <div className="text-xs font-mono text-zinc-400 w-18 shrink-0">W-{agent.workerId}</div>
                  <div className="flex-1 space-y-1">
                    <div className="flex justify-between text-[9px] text-zinc-600 mb-0.5">
                      <span>Token: {tokenPct}%</span>
                      <span>Success: {successRate}%</span>
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-purple-500 transition-all"
                        style={{ width: `${tokenPct}%` }}
                      />
                    </div>
                    <div className="h-1.5 rounded-full bg-zinc-800 overflow-hidden">
                      <div
                        className="h-full rounded-full bg-emerald-500 transition-all"
                        style={{ width: `${successRate}%` }}
                      />
                    </div>
                  </div>
                  <div className="text-[10px] font-mono text-zinc-500 shrink-0 text-right">
                    <div className="text-zinc-300">{agent.avgResponseTime}s</div>
                    <div>avg rt</div>
                  </div>
                </div>
              );
            })}
          </div>

          <div className="mt-4 pt-3 border-t border-white/5 grid grid-cols-2 gap-2 text-[10px]">
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-1.5 rounded-sm bg-purple-500 inline-block" />
              <span className="text-zinc-500">Token budget used</span>
            </div>
            <div className="flex items-center gap-1.5">
              <span className="w-2 h-1.5 rounded-sm bg-emerald-500 inline-block" />
              <span className="text-zinc-500">Task success rate</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
