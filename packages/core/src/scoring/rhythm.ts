import type { SessionMetrics } from "@expr-talk/shared";

/** 节奏：语速落在 180–260 字/分更优；长停顿扣分 */
export function scoreRhythm(metrics: SessionMetrics): number {
  let score = 80;
  const wpm = metrics.wordsPerMinute;
  if (wpm != null) {
    if (wpm < 140 || wpm > 300) score -= 25;
    else if (wpm < 180 || wpm > 260) score -= 10;
    else score += 10;
  }
  if (metrics.longPauseCount != null) {
    score -= Math.min(30, metrics.longPauseCount * 5);
  }
  return Math.round(Math.max(0, Math.min(100, score)));
}
