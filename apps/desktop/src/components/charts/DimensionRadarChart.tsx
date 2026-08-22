import * as React from "react";
import {
  PolarAngleAxis,
  PolarGrid,
  PolarRadiusAxis,
  Radar,
  RadarChart,
  ResponsiveContainer,
} from "recharts";
import { resolveThemeColor } from "@/utils/chartHelpers";

export type DimensionRadarDatum = {
  label: string;
  score: number;
};

type Props = {
  data: DimensionRadarDatum[];
  height?: number;
};

/** 五维雷达图；仅在有至少 2 个维度时渲染。 */
export const DimensionRadarChart = React.memo(function DimensionRadarChart({
  data,
  height = 280,
}: Props) {
  if (data.length < 2) return null;
  const primary = resolveThemeColor("--chart-1", "#10b981");
  const textColor = resolveThemeColor("--muted-foreground", "#9ca3af");
  const gridColor = resolveThemeColor("--border", "#e5e7eb");

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <RadarChart data={data} outerRadius="72%">
          <PolarGrid stroke={gridColor} />
          <PolarAngleAxis
            dataKey="label"
            tick={{ fill: textColor, fontSize: 12 }}
          />
          <PolarRadiusAxis
            domain={[0, 100]}
            tick={false}
            axisLine={false}
          />
          <Radar
            name="本次得分"
            dataKey="score"
            stroke={primary}
            fill={primary}
            fillOpacity={0.3}
            strokeWidth={2}
          />
        </RadarChart>
      </ResponsiveContainer>
    </div>
  );
});