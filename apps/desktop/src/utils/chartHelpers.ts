import type { ScoreDimension, TrainingSession } from "@showtalk/shared";

/** 折线图单个数据点；overall/pace 用 0-100 与字分，fillerRate 为每百字次数 */
export type TrendPoint = {
  id?: string;
  round: number;
  overall?: number;
  fillerRate?: number;
  pace?: number;
};

export type ChartLine = {
  dataKey: string;
  name: string;
  color: string;
  yAxisId?: "left" | "right";
};

const colorCache = new Map<string, string>();

/** 读取 CSS 变量（oklch 原值）作为图表颜色；失败时回落默认色。 */
export function resolveThemeColor(cssVar: string, fallback: string): string {
  const cached = colorCache.get(cssVar);
  if (cached) return cached;
  let value = "";
  try {
    value = getComputedStyle(document.documentElement)
      .getPropertyValue(cssVar)
      .trim();
  } catch {
    // 非浏览器环境
  }
  const resolved = value || fallback;
  colorCache.set(cssVar, resolved);
  return resolved;
}

/** 综合分：对 report.scores 中所有数值取平均（与复盘页五维口径近似）。 */
export function calculateOverallScore(
  scores: Partial<Record<ScoreDimension, number>> | undefined,
): number | undefined {
  if (!scores) return undefined;
  const values = Object.values(scores).filter(
    (v): v is number => typeof v === "number",
  );
  if (values.length === 0) return undefined;
  return Math.round(values.reduce((sum, v) => sum + v, 0) / values.length);
}

/**
 * 从历史会话提取趋势数据：按时间从旧到新排序，逐次计算综合分、
 * 填充词率（次/百字）与语速。只保留有报告且有指标数据的会话。
 */
export function buildTrendData(
  sessions: TrainingSession[],
  opts?: { limit?: number },
): TrendPoint[] {
  const limit = opts?.limit ?? 10;
  const sorted = sessions
    .filter((s) => s.report && s.metrics)
    .slice()
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
    .slice(-limit);
  return sorted.map((s, idx) => {
    const chars = Math.max(1, s.metrics!.totalChars);
    const fillerRate = (s.metrics!.fillerCount / chars) * 100;
    const point: TrendPoint = {
      id: s.id,
      round: idx + 1,
      overall: calculateOverallScore(s.report!.scores),
      fillerRate: Number(fillerRate.toFixed(1)),
    };
    if (typeof s.metrics!.wordsPerMinute === "number") {
      point.pace = s.metrics!.wordsPerMinute;
    }
    return point;
  });
}

/**
 * 是否创历史新高：当前综合分 ≥ 所有历史趋势点的综合分，且至少有一次历史记录。
 */
export function checkHistoricalBest(
  currentOverall: number | undefined,
  historyPoints: TrendPoint[],
): boolean {
  if (currentOverall == null) return false;
  const prior = historyPoints.filter((p) => p.overall != null);
  if (prior.length === 0) return false;
  return currentOverall >= Math.max(...prior.map((p) => p.overall!));
}

/** 百分比变化：before → after 的相对变化，before 为 0 时返回 +∞。 */
export function formatPercentageChange(before: number, after: number): string {
  if (before === 0) return "+∞";
  const change = ((after - before) / before) * 100;
  const sign = change > 0 ? "+" : "";
  return `${sign}${Math.round(change)}%`;
}