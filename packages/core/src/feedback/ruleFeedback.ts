import {
  DEFAULT_MODE_RUBRICS,
  MODE_ISSUE_PRIORITY,
  MODE_PRACTICE_HINTS,
  normalizePracticeMode,
  PRACTICE_MODE_LABELS,
  REPORT_SCHEMA_VERSION,
  SCORE_DIMENSION_LABELS,
  type PracticeMode,
  type ScoreDimension,
  type ScoreRubric,
  type SessionMetrics,
  type StructuredReport,
  type SentenceFeedbackItem,
  type TrainingGoal,
  type TranscriptSegment,
} from "@expr-talk/shared";
import { detectIssues } from "./issueDetector";
import { scoreClarity } from "../scoring/clarity";
import { scoreDirectness } from "../scoring/directness";
import { scoreRhythm } from "../scoring/rhythm";
import { scoreStructureHeuristic } from "../scoring/structure";
import { buildNextPractice } from "../coaching/engine";
import { DEFAULT_ZH_LEXICON } from "../metrics/compute";
import { countLexiconHits } from "../metrics/count";
import { segmentsToUtterances } from "../transcript/segment";

/** LLM 不可用时的确定性降级报告 */
export function buildRuleBasedReport(input: {
  transcript: string;
  metrics: SessionMetrics;
  utteranceCount?: number;
  sessionId?: string;
  segments?: TranscriptSegment[];
  mode?: PracticeMode;
  goal?: TrainingGoal | string;
  topic?: string;
  rubric?: ScoreRubric;
}): StructuredReport {
  const { metrics, transcript } = input;
  const mode: PracticeMode = normalizePracticeMode(input.mode);
  const rubric = input.rubric ?? DEFAULT_MODE_RUBRICS[mode];
  const rawIssues = detectIssues(metrics);
  const topIssues = prioritizeIssuesForMode(rawIssues, mode);
  const nextPractice = buildNextPractice(
    topIssues,
    input.topic?.trim() || transcript,
    mode,
  );
  const sentenceFeedback = buildSentenceFeedback(
    input.sessionId ?? "session",
    transcript,
    input.segments,
  );

  const scores = {
    clarity: scoreClarity(metrics),
    directness: scoreDirectness(metrics),
    density: metrics.densityScore,
    rhythm: scoreRhythm(metrics),
    structure: scoreStructureHeuristic({
      utteranceCount: input.utteranceCount ?? 1,
      repetitionRate: metrics.repetitionRate,
    }),
    // 规则层近似：说服力/可执行 ≈ 直接度与密度的折中（供 rubric 加权）
    persuasiveness: Math.round(
      (scoreDirectness(metrics) * 0.55 + metrics.densityScore * 0.45),
    ),
    actionability: Math.round(
      (scoreDirectness(metrics) * 0.5 +
        scoreStructureHeuristic({
          utteranceCount: input.utteranceCount ?? 1,
          repetitionRate: metrics.repetitionRate,
        }) *
          0.5),
    ),
    hook: scoreHookHeuristic(transcript),
    memorability: Math.round(
      (metrics.densityScore * 0.6 + scoreRhythm(metrics) * 0.4),
    ),
  };

  const focusDims = topRubricDimensions(rubric, 3);
  const focusLabel = focusDims
    .map(([k]) => SCORE_DIMENSION_LABELS[k] ?? k)
    .join("、");

  const summaryParts: string[] = [];
  summaryParts.push(
    `【${PRACTICE_MODE_LABELS[mode]}】本模式更看重：${focusLabel || "清晰与结构"}。`,
  );
  if (topIssues.length === 0) {
    summaryParts.push("未发现明显规则层问题，可在本模式侧重维度上再拉高表现。");
  } else {
    summaryParts.push(
      `针对本模式，优先改进：${topIssues.map((i) => i.title).join("、")}。`,
    );
  }
  if (metrics.wordsPerMinute != null) {
    summaryParts.push(`语速约 ${metrics.wordsPerMinute} 字/分钟。`);
  }
  if (metrics.fillerCount > 0) {
    summaryParts.push(`填充词 ${metrics.fillerCount} 次。`);
  }
  summaryParts.push(MODE_PRACTICE_HINTS[mode]);

  // 简单改写示例：针对含填充词的句子
  const rewriteExamples = sentenceFeedback
    .filter((s) => s.issues.includes("too_many_fillers"))
    .slice(0, 2)
    .map((s) => ({
      original: s.original,
      rewritten: stripFillers(s.original),
      focus: modeRewriteFocus(mode),
    }));

  // 报告 scores 以 rubric 维度为主，便于复盘页体现模式差异
  const reportScores: StructuredReport["scores"] = {};
  for (const key of Object.keys(rubric) as ScoreDimension[]) {
    const v = scores[key as keyof typeof scores];
    if (typeof v === "number") {
      reportScores[key] = v;
    }
  }
  // 保证至少有基础分
  if (Object.keys(reportScores).length === 0) {
    reportScores.clarity = scores.clarity;
    reportScores.structure = scores.structure;
    reportScores.directness = scores.directness;
    reportScores.density = scores.density;
  }

  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    summary: summaryParts.join(" "),
    scores: reportScores,
    topIssues,
    sentenceFeedback,
    rewriteExamples,
    nextPractice,
    source: "rule",
  };
}

function prioritizeIssuesForMode<T extends { code: string; severity: string }>(
  issues: T[],
  mode: PracticeMode,
): T[] {
  const pri = MODE_ISSUE_PRIORITY[mode] ?? {};
  const severityRank = (s: string) =>
    s === "high" ? 0 : s === "medium" ? 1 : 2;
  return [...issues].sort((a, b) => {
    const pa = pri[a.code] ?? 50;
    const pb = pri[b.code] ?? 50;
    if (pa !== pb) return pa - pb;
    return severityRank(a.severity) - severityRank(b.severity);
  });
}

function topRubricDimensions(
  rubric: ScoreRubric,
  n: number,
): Array<[ScoreDimension, number]> {
  return (Object.entries(rubric) as Array<[ScoreDimension, number]>)
    .filter(([, w]) => typeof w === "number" && w > 0)
    .sort((a, b) => b[1] - a[1])
    .slice(0, n);
}

/** 粗略「钩子」：开头是否短而有力 */
function scoreHookHeuristic(transcript: string): number {
  const text = transcript.trim();
  if (!text) return 40;
  const first =
    text.split(/[。！？\n]/).map((s) => s.trim()).find(Boolean) ?? text;
  const len = first.length;
  // 8–28 字较像短视频钩子；过长扣分
  if (len >= 8 && len <= 28) return 82;
  if (len < 8) return 68;
  if (len <= 40) return 70;
  return 55;
}

function modeRewriteFocus(mode: PracticeMode): string {
  switch (mode) {
    case "short_video":
      return "更短、更密，保留钩子感";
    case "debate":
      return "立场更硬，论据更干净";
    case "feynman":
      return "少术语，把因果和例子讲明白";
    case "free":
    default:
      return "减少填充词，结构更清楚";
  }
}

function buildSentenceFeedback(
  sessionId: string,
  transcript: string,
  segments?: TranscriptSegment[],
): SentenceFeedbackItem[] {
  const segs =
    segments && segments.length > 0
      ? segments
      : [
          {
            id: "seg_all",
            text: transcript,
            isFinal: true,
          } satisfies TranscriptSegment,
        ];
  const utterances = segmentsToUtterances(sessionId, segs);
  const items: SentenceFeedbackItem[] = [];

  for (const u of utterances) {
    const fillers = countLexiconHits(u.text, DEFAULT_ZH_LEXICON.fillers);
    const hedges = countLexiconHits(u.text, DEFAULT_ZH_LEXICON.hedges);
    const vague = countLexiconHits(u.text, DEFAULT_ZH_LEXICON.vague);
    const issues: SentenceFeedbackItem["issues"] = [];
    const comments: string[] = [];

    if (fillers.count >= 2) {
      issues.push("too_many_fillers");
      comments.push(
        `填充词：${fillers.matches.map((m) => m.term).join("、") || "多处"}`,
      );
    }
    if (hedges.count >= 2) {
      issues.push("hedging");
      comments.push("犹豫词偏多，可换成明确判断");
    }
    if (vague.count >= 2) {
      issues.push("vague_language");
      comments.push("表述偏模糊，建议用具体对象/数字");
    }

    if (issues.length > 0) {
      items.push({
        utteranceId: u.id,
        original: u.text,
        issues,
        comment: comments.join("；"),
      });
    }
  }

  return items.slice(0, 8);
}

function stripFillers(text: string): string {
  let out = text;
  const sorted = [...DEFAULT_ZH_LEXICON.fillers].sort(
    (a, b) => b.length - a.length,
  );
  for (const term of sorted) {
    out = out.split(term).join("");
  }
  return out.replace(/\s{2,}/g, " ").replace(/，{2,}/g, "，").trim() || text;
}
