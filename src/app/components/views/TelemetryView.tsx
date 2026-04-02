import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Activity,
  Clock,
  AlertCircle,
  BarChart3,
  RefreshCw,
} from "lucide-react";
import { getTelemetrySpans, type TelemetrySpanSummary } from "../../lib/apiClient";
import { cn } from "../UI";

export function TelemetryView() {
  const [filter, setFilter] = useState<{ name: string; status: string }>({ name: "", status: "" });

  const spansQuery = useQuery({
    queryKey: ["telemetry-spans", filter.name, filter.status],
    queryFn: () =>
      getTelemetrySpans({
        name: filter.name || undefined,
        status: filter.status || undefined,
      }),
    refetchInterval: 5000,
  });

  const spans = spansQuery.data?.spans ?? [];
  const totalSpans = spans.reduce((sum, s) => sum + s.count, 0);
  const totalErrors = spans.reduce((sum, s) => sum + s.errorCount, 0);
  const avgDuration = spans.length > 0
    ? spans.reduce((sum, s) => sum + s.avgDurationMs * s.count, 0) / totalSpans
    : 0;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">Telemetry</h2>
          <p className="text-sm text-zinc-500 mt-0.5">Real-time span and metric insights from the agentic runtime</p>
        </div>
        <button
          onClick={() => spansQuery.refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs text-zinc-400 hover:text-white border border-white/10 rounded-lg hover:bg-white/5 transition-colors"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", spansQuery.isFetching && "animate-spin")} />
          Refresh
        </button>
      </div>

      {/* Summary Cards */}
      <div className="grid grid-cols-4 gap-3">
        <SummaryCard icon={BarChart3} label="Total Spans" value={totalSpans} />
        <SummaryCard icon={Activity} label="Span Types" value={spans.length} />
        <SummaryCard
          icon={Clock}
          label="Avg Duration"
          value={avgDuration > 0 ? `${avgDuration.toFixed(0)}ms` : "—"}
        />
        <SummaryCard
          icon={AlertCircle}
          label="Errors"
          value={totalErrors}
          variant={totalErrors > 0 ? "warn" : "default"}
        />
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Filter by span name..."
          value={filter.name}
          onChange={(e) => setFilter((prev) => ({ ...prev, name: e.target.value }))}
          className="flex-1 px-3 py-1.5 text-sm text-zinc-200 bg-black/20 border border-white/10 rounded-lg placeholder:text-zinc-600 focus:outline-none focus:border-white/20"
        />
        <select
          value={filter.status}
          onChange={(e) => setFilter((prev) => ({ ...prev, status: e.target.value }))}
          className="px-3 py-1.5 text-sm text-zinc-200 bg-black/20 border border-white/10 rounded-lg focus:outline-none focus:border-white/20"
        >
          <option value="">All statuses</option>
          <option value="ok">OK</option>
          <option value="error">Error</option>
        </select>
      </div>

      {/* Span Table */}
      {spans.length === 0 ? (
        <div className="text-center py-12 text-zinc-500 text-sm">
          {spansQuery.isLoading ? "Loading telemetry data..." : "No spans recorded yet. Start an agentic run to generate telemetry."}
        </div>
      ) : (
        <div className="rounded-xl border border-white/6 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-white/6 bg-white/[0.02]">
                <th className="text-left px-4 py-2.5 text-xs text-zinc-500 font-medium uppercase tracking-wider">Span Name</th>
                <th className="text-right px-4 py-2.5 text-xs text-zinc-500 font-medium uppercase tracking-wider">Count</th>
                <th className="text-right px-4 py-2.5 text-xs text-zinc-500 font-medium uppercase tracking-wider">Avg Duration</th>
                <th className="text-right px-4 py-2.5 text-xs text-zinc-500 font-medium uppercase tracking-wider">Errors</th>
                <th className="text-right px-4 py-2.5 text-xs text-zinc-500 font-medium uppercase tracking-wider">Error Rate</th>
              </tr>
            </thead>
            <tbody>
              {spans.map((span) => (
                <SpanRow key={span.name} span={span} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function SummaryCard({
  icon: Icon,
  label,
  value,
  variant = "default",
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string | number;
  variant?: "default" | "warn";
}) {
  return (
    <div className="rounded-xl border border-white/6 bg-black/20 px-4 py-3">
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4", variant === "warn" ? "text-amber-400" : "text-cyan-400")} />
        <span className="text-xs text-zinc-500 uppercase tracking-wider">{label}</span>
      </div>
      <div className={cn("mt-1.5 text-xl font-semibold", variant === "warn" ? "text-amber-300" : "text-white")}>
        {typeof value === "number" ? value.toLocaleString() : value}
      </div>
    </div>
  );
}

function SpanRow({ span }: { span: TelemetrySpanSummary }) {
  const errorRate = span.count > 0 ? (span.errorCount / span.count) * 100 : 0;
  const hasErrors = span.errorCount > 0;

  return (
    <tr className="border-b border-white/[0.03] hover:bg-white/[0.02] transition-colors">
      <td className="px-4 py-2.5">
        <span className="font-mono text-zinc-200">{span.name}</span>
      </td>
      <td className="px-4 py-2.5 text-right text-zinc-400 font-mono">
        {span.count.toLocaleString()}
      </td>
      <td className="px-4 py-2.5 text-right text-zinc-400 font-mono">
        {span.avgDurationMs.toFixed(1)}ms
      </td>
      <td className="px-4 py-2.5 text-right font-mono">
        <span className={hasErrors ? "text-red-400" : "text-zinc-600"}>
          {span.errorCount}
        </span>
      </td>
      <td className="px-4 py-2.5 text-right">
        <span
          className={cn(
            "inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium font-mono",
            errorRate === 0
              ? "bg-emerald-500/10 text-emerald-400"
              : errorRate < 10
              ? "bg-amber-500/10 text-amber-400"
              : "bg-red-500/10 text-red-400"
          )}
        >
          {errorRate.toFixed(1)}%
        </span>
      </td>
    </tr>
  );
}
