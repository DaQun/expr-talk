import * as React from "react";
import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  resolveThemeColor,
  type ChartLine,
  type TrendPoint,
} from "@/utils/chartHelpers";

type Props = {
  data: TrendPoint[];
  lines: ChartLine[];
  height?: number;
};

function ChartTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number | string; color?: string }>;
  label?: number | string;
}) {
  if (!active || !payload || payload.length === 0) return null;
  return (
    <div className="bg-popover text-popover-foreground rounded-lg border border-border px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">第 {label} 次</div>
      {payload.map((entry, index) => (
        <div key={index} className="flex items-center gap-2">
          <span
            className="size-2 rounded-full"
            style={{ backgroundColor: entry.color }}
          />
          <span className="text-muted-foreground">{entry.name}</span>
          <span className="ml-auto font-semibold tabular-nums">
            {typeof entry.value === "number"
              ? Number.isInteger(entry.value)
                ? entry.value
                : entry.value.toFixed(1)
              : entry.value}
          </span>
        </div>
      ))}
    </div>
  );
}

export const TrendLineChart = React.memo(function TrendLineChart({
  data,
  lines,
  height = 200,
}: Props) {
  if (data.length === 0) return null;
  const hasRightAxis = lines.some((line) => line.yAxisId === "right");
  const textColor = resolveThemeColor("--muted-foreground", "#9ca3af");
  const gridColor = resolveThemeColor("--border", "#e5e7eb");

  return (
    <div style={{ width: "100%", height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -8 }}>
          <CartesianGrid strokeDasharray="3 3" stroke={gridColor} />
          <XAxis
            dataKey="round"
            tick={{ fill: textColor, fontSize: 11 }}
            tickLine={false}
            label={{
              value: "练习次数",
              position: "insideBottom",
              offset: -2,
              fill: textColor,
              fontSize: 11,
            }}
          />
          <YAxis
            yAxisId="left"
            domain={[0, 100]}
            tick={{ fill: textColor, fontSize: 11 }}
            tickLine={false}
            axisLine={false}
            width={32}
          />
          {hasRightAxis && (
            <YAxis
              yAxisId="right"
              orientation="right"
              domain={[0, "auto"]}
              tick={{ fill: textColor, fontSize: 11 }}
              tickLine={false}
              axisLine={false}
              width={36}
            />
          )}
          <Tooltip
            content={<ChartTooltip />}
            cursor={{ stroke: gridColor, strokeDasharray: "3 3" }}
          />
          <Legend wrapperStyle={{ fontSize: 12 }} />
          {lines.map((line) => {
            const stroke =
              line.color.startsWith("--")
                ? resolveThemeColor(line.color, "#22c55e")
                : line.color;
            return (
              <Line
                key={line.dataKey}
                type="monotone"
                yAxisId={line.yAxisId ?? "left"}
                dataKey={line.dataKey}
                name={line.name}
                stroke={stroke}
                strokeWidth={2}
                dot={{ fill: stroke, r: 3.5, strokeWidth: 0 }}
                activeDot={{ r: 5.5 }}
                connectNulls
              />
            );
          })}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
});