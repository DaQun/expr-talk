import type {
  AttemptComparison,
  EvaluationDimensionKey,
  IssueCode,
  MetricSnapshot,
  SessionMetrics,
  StructuredReport,
} from "@expr-talk/shared";
import { normalizeIssueCode } from "@expr-talk/shared";

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
  const rate = (count: number) =>
    metrics.totalChars > 0
      ? Math.round((count / metrics.totalChars) * 10_000) / 100
      : undefined;
  return {
    totalChars: metrics.totalChars,
    fillerCount: metrics.fillerCount,
    fillerRate: rate(metrics.fillerCount),
    hedgeCount: metrics.hedgeCount,
    hedgeRate: rate(metrics.hedgeCount),
    vagueWordCount: metrics.vagueWordCount,
    vagueRate: rate(metrics.vagueWordCount),
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
  const fillerRateDelta = optionalDelta(before.fillerRate, after.fillerRate);
  const hedgeRateDelta = optionalDelta(before.hedgeRate, after.hedgeRate);
  const vagueRateDelta = optionalDelta(before.vagueRate, after.vagueRate);
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
  const normalizedTargetIssue = normalizeIssueCode(input.targetIssue);
  const targetDimension = targetDimensionForIssue(normalizedTargetIssue);
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
  if (fillerRateDelta != null && before.fillerRate != null && after.fillerRate != null) {
    notes.push(
      `每百字填充词 ${formatRate(before.fillerRate)} → ${formatRate(after.fillerRate)}`,
    );
  }

  if (hedgeRateDelta != null && before.hedgeRate != null && after.hedgeRate != null) {
    notes.push(
      `每百字犹豫词 ${formatRate(before.hedgeRate)} → ${formatRate(after.hedgeRate)}`,
    );
  }

  if (densityDelta > 0) notes.push(`信息密度 +${densityDelta}`);
  else if (densityDelta < 0) notes.push(`信息密度 ${densityDelta}`);

  if (clarityDelta != null) {
    if (clarityDelta > 0) notes.push(`清晰度 +${clarityDelta}`);
    else if (clarityDelta < 0) notes.push(`清晰度 ${clarityDelta}`);
  }

  const targetMetricOutcome = judgeTargetMetric(normalizedTargetIssue, {
    fillerRateDelta,
    hedgeRateDelta,
    vagueRateDelta,
    densityDelta,
  });
  const outcome =
    targetMetricOutcome ??
    (targetDimensionDelta != null
      ? compareWithThreshold(targetDimensionDelta, 3)
      : judgeOverall({
          fillerRateDelta,
          hedgeRateDelta,
          vagueRateDelta,
          densityDelta,
          clarityDelta,
          directnessDelta,
        }));
  const improved = outcome.improved;

  const successCriteriaMet = evaluateCriteria(
    input.successCriteria ?? [],
    after,
    {
      fillerDelta,
      hedgeDelta,
      densityDelta,
    },
  );

  notes.unshift(
    outcome.conclusive
      ? improved
        ? "本轮围绕目标有进步"
        : "本轮围绕目标尚未明显提升"
      : "本轮指标有升有降，暂时无法判断是否进步",
  );

  return {
    parentSessionId: input.parentSessionId,
    round: input.round,
    targetIssue: normalizedTargetIssue ?? input.targetIssue,
    before,
    after,
    deltas: {
      fillerDelta,
      fillerRateDelta,
      hedgeDelta,
      hedgeRateDelta,
      vagueDelta,
      vagueRateDelta,
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
    conclusive: outcome.conclusive,
    successCriteriaMet,
    notes,
  };
}

function targetDimensionForIssue(
  issue: IssueCode | undefined,
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
    case "long_sentence":
      return "expression";
    case "missing_action":
    case "weak_hook":
    case "task_deviation":
    case "insufficient_duration":
    case "missing_example":
    case "audience_mismatch":
      return "scenario_task";
    case "missing_thesis":
      return "logic";
    case "missing_definition":
      return "content";
    case "weak_response":
      return "scenario_task";
    default:
      return undefined;
  }
}

type ComparisonOutcome = { improved: boolean; conclusive: boolean };

function optionalDelta(
  before: number | undefined,
  after: number | undefined,
): number | undefined {
  return before != null && after != null
    ? Math.round((after - before) * 100) / 100
    : undefined;
}

function formatRate(value: number): string {
  return value.toFixed(1);
}

function compareWithThreshold(delta: number, threshold: number): ComparisonOutcome {
  if (delta >= threshold) return { improved: true, conclusive: true };
  if (delta <= -threshold) return { improved: false, conclusive: true };
  return { improved: false, conclusive: false };
}

function judgeTargetMetric(
  targetIssue: IssueCode | undefined,
  d: {
    fillerRateDelta?: number;
    hedgeRateDelta?: number;
    vagueRateDelta?: number;
    densityDelta: number;
  },
): ComparisonOutcome | undefined {
  switch (targetIssue) {
    case "too_many_fillers":
      return d.fillerRateDelta == null
        ? { improved: false, conclusive: false }
        : compareWithThreshold(-d.fillerRateDelta, 0.2);
    case "hedging":
      return d.hedgeRateDelta == null
        ? { improved: false, conclusive: false }
        : compareWithThreshold(-d.hedgeRateDelta, 0.2);
    case "vague_language":
      return d.vagueRateDelta == null
        ? { improved: false, conclusive: false }
        : compareWithThreshold(-d.vagueRateDelta, 0.2);
    case "low_density":
      return compareWithThreshold(d.densityDelta, 2);
    default:
      return undefined;
  }
}

function judgeOverall(d: {
  fillerRateDelta?: number;
  hedgeRateDelta?: number;
  vagueRateDelta?: number;
  densityDelta: number;
  clarityDelta?: number;
  directnessDelta?: number;
}): ComparisonOutcome {
  const votes: number[] = [];
  for (const delta of [d.fillerRateDelta, d.hedgeRateDelta, d.vagueRateDelta]) {
    if (delta == null || Math.abs(delta) < 0.2) continue;
    votes.push(delta < 0 ? 1 : -1);
  }
  for (const delta of [d.densityDelta, d.clarityDelta, d.directnessDelta]) {
    if (delta == null || Math.abs(delta) < 3) continue;
    votes.push(delta > 0 ? 1 : -1);
  }
  if (votes.length === 0 || (votes.some((vote) => vote > 0) && votes.some((vote) => vote < 0))) {
    return { improved: false, conclusive: false };
  }
  return { improved: votes[0] > 0, conclusive: true };
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
