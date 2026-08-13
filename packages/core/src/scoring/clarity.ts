import {
  REVIEW_METRIC_THRESHOLDS,
  type SessionMetrics,
} from "@expr-talk/shared";

/** 清晰度：低填充 + 低模糊 + 合理句长 → 高分 (0-100) */
export function scoreClarity(metrics: SessionMetrics): number {
  const fillerPenalty = Math.min(40, metrics.fillerCount * 4);
  const vaguePenalty = Math.min(25, metrics.vagueWordCount * 5);
  const lengthPenalty =
    metrics.avgSentenceLength > REVIEW_METRIC_THRESHOLDS.avgSentenceLength
      ? Math.min(
          20,
          (metrics.avgSentenceLength -
            REVIEW_METRIC_THRESHOLDS.avgSentenceLength) *
            0.5,
        )
      : 0;
  return Math.round(Math.max(0, 100 - fillerPenalty - vaguePenalty - lengthPenalty));
}
