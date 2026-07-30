import {
  SCORE_DIMENSION_LABELS,
  normalizePracticeMode,
  type IssueCode,
  type PracticeMode,
  type ProfileModeAbility,
  type ProfileTrend,
  type RecurringProfileIssue,
  type ScoreDimension,
  type TrainingSession,
  type UserProfile,
} from "@expr-talk/shared";

const SCORE_KEYS = Object.keys(SCORE_DIMENSION_LABELS) as ScoreDimension[];

function rounded(value: number, digits = 0): number {
  const scale = 10 ** digits;
  return Math.round(value * scale) / scale;
}

function average(values: number[]): number | undefined {
  if (values.length === 0) return undefined;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function issueMode(sessions: TrainingSession[], code: IssueCode): PracticeMode {
  const counts = new Map<PracticeMode, number>();
  for (const session of sessions) {
    if (!session.report?.topIssues.some((issue) => issue.code === code))
      continue;
    const mode = normalizePracticeMode(session.mode);
    counts.set(mode, (counts.get(mode) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? "free";
}

function buildModeAbilities(sessions: TrainingSession[]): ProfileModeAbility[] {
  const modes = new Map<PracticeMode, TrainingSession[]>();
  for (const session of sessions) {
    const mode = normalizePracticeMode(session.mode);
    modes.set(mode, [...(modes.get(mode) ?? []), session]);
  }
  return [...modes.entries()]
    .map(([mode, items]) => {
      const scores: Partial<Record<ScoreDimension, number>> = {};
      for (const key of SCORE_KEYS) {
        const value = average(
          items.flatMap((session) => {
            const score = session.report?.scores[key];
            return typeof score === "number" ? [score] : [];
          }),
        );
        if (value != null) scores[key] = rounded(value);
      }
      return { mode, sessionCount: items.length, scores };
    })
    .filter((item) => Object.keys(item.scores).length > 0)
    .sort((a, b) => b.sessionCount - a.sessionCount);
}

function buildIssues(sessions: TrainingSession[]): RecurringProfileIssue[] {
  const issueMap = new Map<
    IssueCode,
    { title: string; dates: string[]; suggestion?: string }
  >();
  for (const session of sessions) {
    const seen = new Set<IssueCode>();
    for (const issue of session.report?.topIssues ?? []) {
      if (seen.has(issue.code)) continue;
      seen.add(issue.code);
      const current = issueMap.get(issue.code) ?? {
        title: issue.title,
        dates: [],
      };
      current.title = issue.title || current.title;
      current.dates.push(session.startedAt);
      current.suggestion = issue.suggestion || current.suggestion;
      issueMap.set(issue.code, current);
    }
  }
  const midpoint = Math.floor(sessions.length / 2);
  const earlyIds = new Set(sessions.slice(0, midpoint).map((s) => s.id));
  const recentIds = new Set(sessions.slice(midpoint).map((s) => s.id));
  return [...issueMap.entries()]
    .map(([code, item]) => {
      const sessionsWithIssue = sessions.filter((session) =>
        session.report?.topIssues.some((issue) => issue.code === code),
      );
      const earlyCount = sessionsWithIssue.filter((s) =>
        earlyIds.has(s.id),
      ).length;
      const recentCount = sessionsWithIssue.filter((s) =>
        recentIds.has(s.id),
      ).length;
      const earlyRate = midpoint > 0 ? earlyCount / midpoint : 0;
      const recentSize = Math.max(1, sessions.length - midpoint);
      const recentRate = recentCount / recentSize;
      const rateDelta = recentRate - earlyRate;
      return {
        code,
        title: item.title,
        count: item.dates.length,
        sessionRate: rounded((item.dates.length / sessions.length) * 100),
        recentCount,
        trend:
          sessions.length < 6 || Math.abs(rateDelta) < 0.15
            ? "stable"
            : rateDelta < 0
              ? "improving"
              : "worsening",
        lastSeenAt: [...item.dates].sort().slice(-1)[0] ?? "",
        suggestion: item.suggestion,
      } satisfies RecurringProfileIssue;
    })
    .sort(
      (a, b) => b.count - a.count || b.lastSeenAt.localeCompare(a.lastSeenAt),
    );
}

function buildTrends(sessions: TrainingSession[]): ProfileTrend[] {
  if (sessions.length < 6) return [];
  const first = sessions.slice(0, 3);
  const recent = sessions.slice(-3);
  const trends: ProfileTrend[] = [];
  for (const key of SCORE_KEYS) {
    const baseline = average(
      first.flatMap((s) =>
        typeof s.report?.scores[key] === "number"
          ? [s.report.scores[key]!]
          : [],
      ),
    );
    const current = average(
      recent.flatMap((s) =>
        typeof s.report?.scores[key] === "number"
          ? [s.report.scores[key]!]
          : [],
      ),
    );
    if (baseline == null || current == null) continue;
    const delta = current - baseline;
    trends.push({
      key,
      label: SCORE_DIMENSION_LABELS[key],
      baseline: rounded(baseline),
      recent: rounded(current),
      delta: rounded(delta),
      improved: delta > 0,
      lowerIsBetter: false,
    });
  }
  for (const [key, label, field] of [
    ["fillerRate", "每百字填充词", "fillerCount"],
    ["vagueRate", "每百字模糊词", "vagueWordCount"],
  ] as const) {
    const rate = (items: TrainingSession[]) =>
      average(
        items.flatMap((s) =>
          s.metrics && s.metrics.totalChars > 0
            ? [(s.metrics[field] / s.metrics.totalChars) * 100]
            : [],
        ),
      );
    const baseline = rate(first);
    const current = rate(recent);
    if (baseline == null || current == null) continue;
    const delta = current - baseline;
    trends.push({
      key,
      label,
      baseline: rounded(baseline, 1),
      recent: rounded(current, 1),
      delta: rounded(delta, 1),
      improved: delta < 0,
      lowerIsBetter: true,
    });
  }
  return trends
    .sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta))
    .slice(0, 6);
}

export function buildUserProfile(allSessions: TrainingSession[]): UserProfile {
  const sessions = allSessions
    .filter((session) => session.report && session.metrics)
    .sort((a, b) => a.startedAt.localeCompare(b.startedAt));
  const retries = allSessions.filter((session) => session.parentSessionId);
  const retryResults = retries.filter((session) => session.comparison != null);
  const retrySuccesses = retryResults.filter(
    (session) => session.comparison?.improved,
  ).length;
  const modeAbilities = buildModeAbilities(sessions);
  const recurringIssues = buildIssues(sessions);
  const allScores = new Map<ScoreDimension, number[]>();
  for (const mode of modeAbilities) {
    for (const [key, value] of Object.entries(mode.scores)) {
      if (typeof value !== "number") continue;
      const dimension = key as ScoreDimension;
      allScores.set(dimension, [...(allScores.get(dimension) ?? []), value]);
    }
  }
  const strongest = [...allScores.entries()]
    .map(([dimension, values]) => ({ dimension, score: average(values) ?? 0 }))
    .sort((a, b) => b.score - a.score)[0];
  const focusIssue = recurringIssues[0];
  const cutoff = Date.now() - 30 * 24 * 60 * 60 * 1000;
  const activeDays30 = new Set(
    allSessions
      .filter((session) => Date.parse(session.startedAt) >= cutoff)
      .map((session) => session.startedAt.slice(0, 10)),
  ).size;

  return {
    generatedAt: new Date().toISOString(),
    maturity:
      sessions.length < 3
        ? "insufficient"
        : sessions.length < 6
          ? "preliminary"
          : "established",
    sessionCount: allSessions.length,
    reviewedSessionCount: sessions.length,
    retryCount: retries.length,
    retrySuccessRate:
      retryResults.length > 0
        ? rounded((retrySuccesses / retryResults.length) * 100)
        : undefined,
    totalDurationSec: allSessions.reduce(
      (sum, session) =>
        sum + (session.durationSec ?? session.metrics?.durationSec ?? 0),
      0,
    ),
    activeDays30,
    modeAbilities,
    recurringIssues,
    trends: buildTrends(sessions),
    strength: strongest
      ? {
          dimension: strongest.dimension,
          label: SCORE_DIMENSION_LABELS[strongest.dimension],
          score: rounded(strongest.score),
        }
      : undefined,
    focus: focusIssue
      ? {
          code: focusIssue.code,
          title: focusIssue.title,
          suggestion: focusIssue.suggestion,
          recommendedMode: issueMode(sessions, focusIssue.code),
        }
      : undefined,
  };
}
