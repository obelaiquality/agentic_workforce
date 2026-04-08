import {
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
  ResponsiveContainer,
} from "recharts";
import type { InterviewDimensions } from "../../../shared/contracts";

function dimensionsToArray(dimensions: InterviewDimensions) {
  const entries: Array<{ dimension: string; value: number; fullMark: 1 }> = [];
  for (const [key, val] of Object.entries(dimensions)) {
    if (typeof val === "number") {
      entries.push({
        dimension: key.charAt(0).toUpperCase() + key.slice(1),
        value: val,
        fullMark: 1,
      });
    }
  }
  return entries;
}

export function DimensionRadar({
  dimensions,
}: {
  dimensions: InterviewDimensions;
}) {
  const data = dimensionsToArray(dimensions);

  if (data.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-zinc-500">
        No dimensions yet
      </div>
    );
  }

  return (
    <ResponsiveContainer width="100%" height="100%">
      <RadarChart data={data} cx="50%" cy="50%" outerRadius="70%">
        <PolarGrid stroke="#27272a" />
        <PolarAngleAxis
          dataKey="dimension"
          tick={{ fontSize: 10, fill: "#a1a1aa" }}
        />
        <PolarRadiusAxis
          domain={[0, 1]}
          tick={{ fontSize: 9, fill: "#52525b" }}
          axisLine={false}
          tickCount={5}
        />
        <Radar
          name="Score"
          dataKey="value"
          stroke="#8b5cf6"
          fill="#8b5cf6"
          fillOpacity={0.2}
          strokeWidth={2}
          dot={{ r: 3, fill: "#a78bfa", strokeWidth: 0 }}
        />
      </RadarChart>
    </ResponsiveContainer>
  );
}
