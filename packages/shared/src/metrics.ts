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
