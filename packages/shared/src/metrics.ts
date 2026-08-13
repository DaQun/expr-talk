/** 会话级确定性指标；schemaVersion 随字段演进递增 */
export type SessionMetrics = {
  schemaVersion: number;
  totalChars: number;
  totalWords: number;
  durationSec?: number;
  wordsPerMinute?: number;
  fillerCount: number;
  hedgeCount: number;
  vagueWordCount: number;
  repetitionRate: number;
  avgSentenceLength: number;
  longPauseCount?: number;
  densityScore: number;
};

export const METRICS_SCHEMA_VERSION = 1;

/** 复盘页与规则评分共用的经验阈值，避免不同入口给出冲突结论。 */
export const REVIEW_METRIC_THRESHOLDS = {
  minCharsForRateJudgement: 80,
  fillerRatePerHundred: 3,
  hedgeRatePerHundred: 2,
  vagueRatePerHundred: 2,
  repetitionRate: 0.12,
  avgSentenceLength: 40,
  densityScore: 70,
  longPauseCount: 3,
} as const;

export function emptySessionMetrics(): SessionMetrics {
  return {
    schemaVersion: METRICS_SCHEMA_VERSION,
    totalChars: 0,
    totalWords: 0,
    fillerCount: 0,
    hedgeCount: 0,
    vagueWordCount: 0,
    repetitionRate: 0,
    avgSentenceLength: 0,
    densityScore: 0,
  };
}
