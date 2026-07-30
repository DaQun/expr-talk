import type {
  AttemptComparison,
  EvaluationDimensionKey,
  MetricSnapshot,
  SessionMetrics,
  StructuredReport,
} from "@expr-talk/shared";

export type CompareInput = {
  parentSessionId: string;
  round: number;
  targetIssue?: string;
  beforeMetrics: SessionMetrics;
  afterMetrics: SessionMetrics;
  beforeReport?: StructuredReport;
  afterReport?: StructuredReport;
  successCriteria?: string[];
};

function snapshot(
  metrics: SessionMetrics,
  report?: StructuredReport,
): MetricSnapshot {
  return {
    fillerCount: metrics.fillerCount,
    hedgeCount: metrics.hedgeCount,
    vagueWordCount: metrics.vagueWordCount,
    densityScore: metrics.densityScore,
    wordsPerMinute: metrics.wordsPerMinute,
    clarity: report?.scores.clarity,
    directness: report?.scores.directness,
    dimensionScores: Object.fromEntries(
      Object.entries(report?.dimensionReviews ?? {}).map(([key, review]) => [
        key,
        review?.score,
      ]),
    ),
    durationSec: metrics.durationSec,
  };
}

/**
 * 对比两轮指标。
 * improved：相对主目标（targetIssue）或综合「坏指标下降 / 好指标上升」。
 */
export function compareAttempts(input: CompareInput): AttemptComparison {
  const before = snapshot(input.beforeMetrics, input.beforeReport);
  const after = snapshot(input.afterMetrics, input.afterReport);

  const fillerDelta = after.fillerCount - before.fillerCount;
  const hedgeDelta = after.hedgeCount - before.hedgeCount;
  const vagueDelta = after.vagueWordCount - before.vagueWordCount;
  const densityDelta = after.densityScore - before.densityScore;
  const wpmDelta =
    after.wordsPerMinute != null && before.wordsPerMinute != null
      ? after.wordsPerMinute - before.wordsPerMinute
      : undefined;
  const clarityDelta =
    after.clarity != null && before.clarity != null
      ? after.clarity - before.clarity
      : undefined;
  const directnessDelta =
    after.directness != null && before.directness != null
      ? after.directness - before.directness
      : undefined;
  const targetDimension = targetDimensionForIssue(input.targetIssue);
  const beforeTargetScore = targetDimension
    ? before.dimensionScores?.[targetDimension]
    : undefined;
  const afterTargetScore = targetDimension
    ? after.dimensionScores?.[targetDimension]
    : undefined;
  const targetDimensionDelta =
    beforeTargetScore != null && afterTargetScore != null
      ? afterTargetScore - beforeTargetScore
      : undefined;

  const notes: string[] = [];
  if (fillerDelta < 0) notes.push(`填充词减少 ${-fillerDelta} 个`);
  else if (fillerDelta > 0) notes.push(`填充词增加 ${fillerDelta} 个`);
  else notes.push("填充词数量持平");

  if (hedgeDelta < 0) notes.push(`犹豫词减少 ${-hedgeDelta} 个`);
  else if (hedgeDelta > 0) notes.push(`犹豫词增加 ${hedgeDelta} 个`);

  if (densityDelta > 0) notes.push(`信息密度 +${densityDelta}`);
  else if (densityDelta < 0) notes.push(`信息密度 ${densityDelta}`);

  if (clarityDelta != null) {
    if (clarityDelta > 0) notes.push(`清晰度 +${clarityDelta}`);
    else if (clarityDelta < 0) notes.push(`清晰度 ${clarityDelta}`);
  }

  const improved = targetDimensionDelta != null
    ? targetDimensionDelta > 0
    : judgeImproved(input.targetIssue, {
    fillerDelta,
    hedgeDelta,
    vagueDelta,
    densityDelta,
    clarityDelta,
    directnessDelta,
      });

  const successCriteriaMet = evaluateCriteria(
    input.successCriteria ?? [],
    after,
    {
      fillerDelta,
      hedgeDelta,
      densityDelta,
    },
  );

  if (improved) notes.unshift("本轮整体有进步");
  else notes.unshift("本轮尚未明显优于上一轮，可再练一次");

  return {
    parentSessionId: input.parentSessionId,
    round: input.round,
    targetIssue: input.targetIssue,
    before,
    after,
    deltas: {
      fillerDelta,
      hedgeDelta,
      vagueDelta,
      densityDelta,
      wpmDelta,
      clarityDelta,
      directnessDelta,
      targetDimension,
      targetDimensionDelta,
    },
    fillerDelta,
    wpmDelta,
    densityDelta,
    improved,
    successCriteriaMet,
    notes,
  };
}

function targetDimensionForIssue(
  issue: string | undefined,
): EvaluationDimensionKey | undefined {
  switch (issue) {
    case "weak_reasoning":
    case "unsupported_claim":
    case "logic_gap":
    case "contradiction":
    case "missing_conclusion":
    case "unclear_structure":
      return "logic";
    case "too_many_fillers":
    case "hedging":
    case "vague_language":
    case "repetition":
    case "low_density":
    case "late_conclusion":
      return "expression";
    case "missing_action":
    case "weak_hook":
      return "scenario_task";
    default:
      return undefined;
  }
}

function judgeImproved(
  targetIssue: string | undefined,
  d: {
    fillerDelta: number;
    hedgeDelta: number;
    vagueDelta: number;
    densityDelta: number;
    clarityDelta?: number;
    directnessDelta?: number;
  },
): boolean {
  switch (targetIssue) {
    case "too_many_fillers":
      return d.fillerDelta < 0;
    case "hedging":
      return d.hedgeDelta < 0 || (d.directnessDelta ?? 0) > 0;
    case "vague_language":
      return d.vagueDelta < 0;
    case "low_density":
      return d.densityDelta > 0;
    case "unclear_structure":
    case "late_conclusion":
      return (d.clarityDelta ?? 0) > 0 || d.densityDelta > 0;
    default: {
      // 综合：坏指标降、好指标升，净分 > 0
      let score = 0;
      if (d.fillerDelta < 0) score += 2;
      if (d.fillerDelta > 0) score -= 2;
      if (d.hedgeDelta < 0) score += 1;
      if (d.hedgeDelta > 0) score -= 1;
      if (d.vagueDelta < 0) score += 1;
      if (d.densityDelta > 0) score += 1;
      if (d.densityDelta < 0) score -= 1;
      if ((d.clarityDelta ?? 0) > 0) score += 1;
      return score > 0;
    }
  }
}

function evaluateCriteria(
  criteria: string[],
  after: MetricSnapshot,
  d: { fillerDelta: number; hedgeDelta: number; densityDelta: number },
): string[] {
  const met: string[] = [];
  for (const c of criteria) {
    const lower = c.toLowerCase();
    if (
      (lower.includes("填充") || lower.includes("filler")) &&
      (d.fillerDelta < 0 || after.fillerCount <= 3)
    ) {
      met.push(c);
      continue;
    }
    if (
      (lower.includes("犹豫") || lower.includes("坚定")) &&
      (d.hedgeDelta < 0 || after.hedgeCount <= 2)
    ) {
      met.push(c);
      continue;
    }
    if (
      (lower.includes("密度") || lower.includes("信息")) &&
      (d.densityDelta > 0 || after.densityScore >= 70)
    ) {
      met.push(c);
      continue;
    }
    if (lower.includes("结论") && after.clarity != null && after.clarity >= 70) {
      met.push(c);
      continue;
    }
  }
  return met;
}
