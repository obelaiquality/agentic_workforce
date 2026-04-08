import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
} from "recharts";

export function AmbiguityChart({
  scores,
  threshold,
}: {
  scores: Array<{ round: number; overall: number }>;
  threshold: number;
}) {
  if (scores.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-zinc-500">
        No scores yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <AreaChart data={scores} margin={{ top: 8, right: 12, bottom: 4, left: -12 }}>
        <defs>
          <linearGradient id="ambiguityFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#8b5cf6" stopOpacity={0.3} />
            <stop offset="100%" stopColor="#8b5cf6" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <XAxis
          dataKey="round"
          tick={{ fontSize: 10, fill: "#71717a" }}
          axisLine={{ stroke: "#27272a" }}
          tickLine={false}
          label={{ value: "Round", position: "insideBottomRight", offset: -4, fontSize: 10, fill: "#52525b" }}
        />
        <YAxis
          domain={[0, 1]}
          tick={{ fontSize: 10, fill: "#71717a" }}
          axisLine={{ stroke: "#27272a" }}
          tickLine={false}
          tickFormatter={(v: number) => `${Math.round(v * 100)}%`}
        />
        <Tooltip
          contentStyle={{
            backgroundColor: "#18181b",
            border: "1px solid rgba(255,255,255,0.1)",
            borderRadius: 8,
            fontSize: 12,
          }}
          labelFormatter={(label: number) => `Round ${label}`}
          formatter={(value: number) => [`${Math.round(value * 100)}%`, "Ambiguity"]}
        />
        <ReferenceLine
          y={threshold}
          stroke="#ef4444"
          strokeDasharray="6 3"
          strokeOpacity={0.6}
          label={{
            value: "Threshold",
            position: "right",
            fontSize: 10,
            fill: "#ef4444",
          }}
        />
        <Area
          type="monotone"
          dataKey="overall"
          stroke="#8b5cf6"
          strokeWidth={2}
          fill="url(#ambiguityFill)"
          dot={{ r: 3, fill: "#8b5cf6", strokeWidth: 0 }}
          activeDot={{ r: 5, fill: "#a78bfa", strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}
