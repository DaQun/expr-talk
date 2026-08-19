import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import {
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  CircleAlert,
  Info,
  LoaderCircle,
  Sparkles,
  XCircle,
} from "lucide-react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  ISSUE_CODE_LABELS,
  PRACTICE_MODE_LABELS,
  REVIEW_METRIC_THRESHOLDS,
  freeTopicRequiresThesis,
  normalizeIssueCode,
  normalizePracticeMode,
  feynmanScenarioSummary,
  taskChecksFromFeynmanCheckpoints,
  type AttemptComparison,
  type DimensionReview,
  type EvaluationDimensionKey,
  type IssueCode,
  type ScoreDimension,
} from "@showtalk/shared";
import { useSessionStore } from "@/state/sessionStore";
import { ComparisonCard } from "@/components/ComparisonCard";
import { ConversationTimeline } from "@/components/ConversationTimeline";
import {
  buildEmptyTranscriptGuidance,
  GuidancePanel,
} from "@/components/GuidancePanel";
import { audioApi } from "@/ipc/audio";
import { api } from "@/ipc/client";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { Progress } from "@/components/ui/progress";
import { cn } from "@/lib/utils";
import { useElapsedSeconds } from "@/hooks/useElapsedSeconds";

const DIMENSION_LABELS: Record<EvaluationDimensionKey, string> = {
  content: "内容质量",
  logic: "逻辑结构",
  expression: "表达质量",
  voice: "语音表现",
  scenario_task: "场景任务",
};

const DIMENSION_ORDER = Object.keys(
  DIMENSION_LABELS,
) as EvaluationDimensionKey[];

const SOURCE_LABELS: Record<DimensionReview["source"], string> = {
  llm: "大模型判断",
  objective: "历史报告标签",
  mixed: "大模型判断（参考本地指标）",
};

function issueLabel(code: string): string {
  const normalized = normalizeIssueCode(code);
  return normalized ? ISSUE_CODE_LABELS[normalized] : code;
}

type TranscriptSegment = { text: string; mark: number };

function highlightTranscript(
  text: string,
  originals: string[],
): TranscriptSegment[] {
  const matches: Array<{ start: number; end: number; mark: number }> = [];
  originals.forEach((original, mark) => {
    const needle = original.trim();
    if (needle.length < 4) return;
    let fromIndex = 0;
    while (fromIndex < text.length) {
      const start = text.indexOf(needle, fromIndex);
      if (start < 0) break;
      const end = start + needle.length;
      if (!matches.some((m) => start < m.end && end > m.start)) {
        matches.push({ start, end, mark });
      }
      fromIndex = end;
    }
  });
  matches.sort((a, b) => a.start - b.start);
  const segments: TranscriptSegment[] = [];
  let cursor = 0;
  for (const m of matches) {
    if (m.start > cursor) {
      segments.push({ text: text.slice(cursor, m.start), mark: -1 });
    }
    segments.push({ text: text.slice(m.start, m.end), mark: m.mark });
    cursor = m.end;
  }
  if (cursor < text.length) segments.push({ text: text.slice(cursor), mark: -1 });
  if (segments.length === 0) segments.push({ text, mark: -1 });
  return segments;
}

type ComparisonHighlight = {
  label: string;
  before: number;
  after: number;
  delta: number;
  good: boolean | null;
};

function buildComparisonHighlights(
  cmp: AttemptComparison,
  paceRange: [number, number],
): ComparisonHighlight[] {
  const items: ComparisonHighlight[] = [];
  const target = cmp.deltas.targetDimension;
  if (target && cmp.deltas.targetDimensionDelta != null) {
    const delta = cmp.deltas.targetDimensionDelta;
    const before = cmp.before.dimensionScores?.[target];
    const after = cmp.after.dimensionScores?.[target];
    if (before != null && after != null) {
      items.push({
        label: DIMENSION_LABELS[target],
        before,
        after,
        delta,
        good: delta === 0 ? null : delta > 0,
      });
    }
  }
  const usesFillerRate = cmp.deltas.fillerRateDelta != null;
  items.push({
    label: usesFillerRate ? "填充词/百字" : "填充词",
    before: usesFillerRate
      ? (cmp.before.fillerRate ?? cmp.before.fillerCount)
      : cmp.before.fillerCount,
    after: usesFillerRate
      ? (cmp.after.fillerRate ?? cmp.after.fillerCount)
      : cmp.after.fillerCount,
    delta: cmp.deltas.fillerRateDelta ?? cmp.deltas.fillerDelta,
    good:
      (cmp.deltas.fillerRateDelta ?? cmp.deltas.fillerDelta) === 0
        ? null
        : (cmp.deltas.fillerRateDelta ?? cmp.deltas.fillerDelta) < 0,
  });
  if (
    cmp.deltas.wpmDelta != null &&
    cmp.before.wordsPerMinute != null &&
    cmp.after.wordsPerMinute != null
  ) {
    const [min, max] = paceRange;
    const distance = (value: number) =>
      value < min ? min - value : value > max ? value - max : 0;
    const before = distance(cmp.before.wordsPerMinute);
    const after = distance(cmp.after.wordsPerMinute);
    items.push({
      label: "语速（字/分）",
      before: cmp.before.wordsPerMinute,
      after: cmp.after.wordsPerMinute,
      delta: cmp.deltas.wpmDelta,
      good: before === after ? null : after < before,
    });
  }
  return items.slice(0, 3);
}

function formatComparisonNumber(value: number): string {
  return Number.isInteger(value) ? String(value) : value.toFixed(1);
}

function averageScores(
  scores: Map<ScoreDimension, number>,
  keys: ScoreDimension[],
): number | undefined {
  const values = keys
    .map((key) => scores.get(key))
    .filter((value): value is number => typeof value === "number");
  if (values.length === 0) return undefined;
  return Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
}

type SignalStatus =
  | "正常"
  | "已记录"
  | "偏低"
  | "偏高"
  | "偏多"
  | "样本不足"
  | "未评估";

type ObjectiveSignal = {
  id: string;
  label: string;
  value: string;
  status: SignalStatus;
  detail: string;
};

const PACE_RANGES: Record<string, [number, number]> = {
  free: [160, 240],
  short_video: [200, 280],
  debate: [180, 260],
  feynman: [150, 230],
};

function rangeStatus(
  value: number | undefined,
  [min, max]: [number, number],
): SignalStatus {
  if (value == null) return "未评估";
  if (value < min) return "偏低";
  if (value > max) return "偏高";
  return "正常";
}

export function ReviewPage() {
  const { sessionId } = useParams();
  const {
    current,
    report,
    comparison,
    loadSession,
    analyzing,
    error,
    lastWavUrl,
    lastAudioPath,
    analyzeNote,
    modelStatus,
    refreshModelStatus,
    reanalyzeSession,
  } = useSessionStore();

  const [showDetails, setShowDetails] = useState(false);
  const [showAllEvidence, setShowAllEvidence] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [showAudio, setShowAudio] = useState(false);
  const [showAllSignals, setShowAllSignals] = useState(false);
  const [showSecondaryIssues, setShowSecondaryIssues] = useState(false);
  const [showComparisonDetail, setShowComparisonDetail] = useState(false);
  const [showLogicReview, setShowLogicReview] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [openDimension, setOpenDimension] = useState<
    EvaluationDimensionKey | null | undefined
  >(undefined);
  const analyzeElapsed = useElapsedSeconds(analyzing);

  useEffect(() => {
    if (sessionId && current?.id !== sessionId) void loadSession(sessionId);
  }, [sessionId, current?.id, loadSession]);

  useEffect(() => {
    void refreshModelStatus();
  }, [refreshModelStatus]);

  useEffect(() => {
    setOpenDimension(undefined);
    setShowAllEvidence(false);
    setShowAllSignals(false);
    setShowSecondaryIssues(false);
    setShowComparisonDetail(false);
    setShowLogicReview(false);
    setShowDetails(false);
    setShowTranscript(false);
    setShowAudio(false);
  }, [current?.id]);

  const profileQuery = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
    enabled: Boolean(current && report),
  });

  const hasTranscript = Boolean(current?.finalTranscript?.trim());
  const diskAudioPath = lastAudioPath || current?.audioFile || null;
  const playableAudioUrl =
    lastWavUrl ||
    (diskAudioPath && audioApi.isTauri()
      ? convertFileSrc(diskAudioPath)
      : null);
  const hasConversationTimeline = Boolean(
    current?.debate && current.debate.turns.length > 0,
  );
  const turnAudio = (current?.debate?.turns ?? [])
    .filter((turn) => turn.role === "user" && Boolean(turn.audioFile))
    .map((turn) => ({
      id: turn.id,
      label: `第 ${turn.round} 轮${current?.mode === "feynman" ? "讲解" : "我方发言"}`,
      path: turn.audioFile!,
      durationSec: turn.durationSec,
      url: audioApi.isTauri() ? convertFileSrc(turn.audioFile!) : null,
    }));
  /** 分轮录音已在时间线播放时，原始材料不再重复列录音 */
  const audioCoveredByTimeline =
    hasConversationTimeline && turnAudio.length > 0;
  const audioMaterials =
    audioCoveredByTimeline
      ? []
      : turnAudio.length > 0
        ? turnAudio
        : playableAudioUrl
          ? [
              {
                id: "legacy-audio",
                label: current?.debate ? "最后一轮录音" : "本次录音",
                path: diskAudioPath,
                url: playableAudioUrl,
                durationSec: current?.durationSec,
              },
            ]
          : [];
  const hasAudio =
    audioMaterials.length > 0 ||
    turnAudio.length > 0 ||
    Boolean(playableAudioUrl);
  const canReanalyze = hasTranscript || hasAudio;
  const next = report?.nextPractice;
  const targetIssueCode = normalizeIssueCode(next?.targetIssue);
  const focusIssue = report?.topIssues.find(
    (issue) => normalizeIssueCode(issue.code) === targetIssueCode,
  ) ?? report?.topIssues[0];
  const cmp = comparison ?? current?.comparison ?? null;
  const currentPaceRange =
    PACE_RANGES[normalizePracticeMode(current?.mode)] ?? PACE_RANGES.free;
  const nextStepTitle = hasTranscript
    ? (focusIssue?.title ??
      (next ? issueLabel(next.targetIssue) : "整体较稳，保持节奏"))
    : "缺少逐字稿";
  const nextStepSuggestion = hasTranscript
    ? (next?.instruction?.trim() ||
      focusIssue?.suggestion?.trim() ||
      report?.summary ||
      "")
    : "先解决录音或识别问题，生成逐字稿后才能给出可复练目标。";
  const recurringIssue = targetIssueCode
    ? profileQuery.data?.recurringIssues.find(
        (issue) => issue.code === targetIssueCode,
      )
    : undefined;
  const reviewedSessionCount = profileQuery.data?.reviewedSessionCount;
  const comparisonHighlights = cmp
    ? buildComparisonHighlights(cmp, currentPaceRange)
    : [];

  function scrollToEvidence(index: number) {
    if (index >= 3) setShowAllEvidence(true);
    window.requestAnimationFrame(() => {
      document
        .getElementById(`evidence-item-${index}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    });
  }

  const emptyGuidance = useMemo(
    () =>
      buildEmptyTranscriptGuidance({
        hasAudio,
        modelReady: modelStatus ? modelStatus.ready : null,
      }),
    [hasAudio, modelStatus],
  );

  if (analyzing && !current) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="复盘" description="正在加载报告…" />
        <Skeleton className="h-36 w-full" />
        <Skeleton className="h-20 w-full" />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="复盘"
          description="一次练习后的主改进点、关键数字与复练入口。"
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/15 text-primary border-primary/20 grid size-13 place-items-center rounded-2xl border">
              <Sparkles className="size-5" />
            </div>
            <h2 className="text-lg font-semibold">还没有可展示的报告</h2>
            <p className="text-muted-foreground max-w-md text-sm">
              先去练习页完成一次录音；复盘报告仅由大模型生成。
            </p>
            <div className="mt-1 flex flex-wrap justify-center gap-2">
              <Button asChild>
                <Link to="/practice">去练习</Link>
              </Button>
              <Button variant="ghost" asChild>
                <Link to="/history">看历史</Link>
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (analyzing && !report) {
    const waitingForLlm = Boolean(
      analyzeNote &&
        /大模型|接收评审内容|等待生成内容|整理复盘报告/.test(analyzeNote),
    );
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="复盘" description={current.topic} />
        <Card>
          <CardContent
            className="flex flex-col items-center gap-3 py-12 text-center"
            role="status"
            aria-live="polite"
          >
            <LoaderCircle className="text-primary size-7 animate-spin" />
            <h2 className="text-lg font-semibold">
              {analyzeNote || "正在准备复盘报告…"}
            </h2>
            <p className="text-muted-foreground m-0 text-sm">
              已等待 {analyzeElapsed} 秒
            </p>
            <p className="text-muted-foreground m-0 max-w-md text-xs leading-relaxed">
              {waitingForLlm && analyzeElapsed >= 30
                ? "模型仍在生成完整报告，请继续等待；模型请求超过 2 分钟才会停止。"
                : waitingForLlm
                  ? "报告包含多维评分与改写建议，通常需要一些时间。"
                  : "正在整理录音和逐字稿，完成后会自动生成报告。"}
            </p>
          </CardContent>
        </Card>
      </div>
    );
  }

  // 有练习素材但无大模型报告（缺稿 / 未配置 / 调用失败）
  if (!report) {
    const materialOk = Boolean(
      current.finalTranscript?.trim() ||
      hasAudio,
    );
    const errText = error ?? "";
    const needLlmConfig =
      /API Key|未启用大模型|未配置.*Key|未知大模型 Provider/i.test(errText);
    const needTranscript = /逐字稿|转写结果为空|语音识别/i.test(errText);
    const llmCallFailed = /大模型评审失败|LLM HTTP|超时|等待超过/i.test(errText);

    const title = needTranscript
      ? "还没有逐字稿，无法评审"
      : needLlmConfig
        ? "大模型尚未就绪"
        : llmCallFailed
          ? "大模型评审失败"
          : "尚未生成复盘报告";

    const detail = needTranscript
      ? "你的 API Key 配置不是问题。当前缺少可送审的文字：实时字幕为空，且自动转写未成功。若有录音，请点「从录音重转写并评审」。"
      : needLlmConfig
        ? "请到设置中确认当前 Provider 已填写 API Key。"
        : llmCallFailed
          ? "Key 可能已配置，但调用大模型时出错。请查看下方错误详情，或检查模型名 / 网络后重试。"
          : "复盘报告仅由大模型生成。请根据下方原因处理后重新评审。";

    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="复盘" description={current.topic} />
        {error && (
          <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border px-3.5 py-3 text-sm">
            <div className="font-medium">失败原因</div>
            <p className="mt-1 mb-0 whitespace-pre-wrap">{error}</p>
          </div>
        )}
        <Card>
          <CardContent className="flex flex-col gap-3 py-8">
            <h2 className="text-lg font-semibold tracking-tight">{title}</h2>
            <p className="text-muted-foreground m-0 text-sm leading-relaxed">
              {detail}
            </p>
            {current.finalTranscript?.trim() && (
              <p className="text-muted-foreground m-0 text-xs">
                已有逐字稿 {current.finalTranscript.trim().length}{" "}
                字，可直接重新评审。
              </p>
            )}
            <div className="flex flex-wrap gap-2 pt-1">
              {needTranscript && hasAudio && audioApi.isTauri() && (
                <Button
                  disabled={analyzing}
                  onClick={() => void reanalyzeSession({ retranscribe: true })}
                >
                  {analyzing ? "转写评审中…" : "从录音重转写并评审"}
                </Button>
              )}
              {!needTranscript && materialOk && (
                <Button
                  disabled={analyzing}
                  onClick={() => void reanalyzeSession()}
                >
                  {analyzing ? "评审中…" : "重新评审"}
                </Button>
              )}
              {hasAudio && audioApi.isTauri() && !needTranscript && (
                <Button
                  variant="outline"
                  disabled={analyzing}
                  onClick={() => void reanalyzeSession({ retranscribe: true })}
                >
                  从录音重转写并评审
                </Button>
              )}
              {needLlmConfig && (
                <Button variant="secondary" asChild>
                  <Link to="/settings">去配置大模型</Link>
                </Button>
              )}
              {llmCallFailed && (
                <Button variant="secondary" asChild>
                  <Link to="/settings">检查模型设置</Link>
                </Button>
              )}
              <Button variant="ghost" asChild>
                <Link to="/practice">回练习</Link>
              </Button>
            </div>
            {analyzeNote && (
              <p className="text-muted-foreground m-0 text-sm">{analyzeNote}</p>
            )}
          </CardContent>
        </Card>
        {current.finalTranscript?.trim() && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">当前逐字稿</CardTitle>
            </CardHeader>
            <CardContent>
              <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
                {current.finalTranscript}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    );
  }

  const metrics = current.metrics;
  const normalizedMode = normalizePracticeMode(current.mode);
  const narrativeFree =
    normalizedMode === "free" && !freeTopicRequiresThesis(current.topic);
  const feynmanCheckpoints = current.debate?.feynman?.checkpoints ?? [];
  const feynmanAligned =
    normalizedMode === "feynman" && feynmanCheckpoints.length > 0
      ? feynmanScenarioSummary(feynmanCheckpoints)
      : null;
  const alignedTaskChecks = feynmanAligned
    ? taskChecksFromFeynmanCheckpoints(feynmanCheckpoints)
    : undefined;
  const scoreMap = new Map(
    Object.entries(report.scores).filter(
      (entry): entry is [ScoreDimension, number] => typeof entry[1] === "number",
    ),
  );
  /** 旧报告无五维时，用细分分聚合兜底；新报告以 dimensionReviews 为准。 */
  const fallbackDimensionScores: Partial<Record<EvaluationDimensionKey, number>> = {
    content: averageScores(scoreMap, ["density", "memorability"]),
    logic: averageScores(scoreMap, ["logic", "structure", "persuasiveness"]),
    expression: averageScores(scoreMap, ["clarity", "directness", "rhythm"]),
    scenario_task: averageScores(scoreMap, ["hook", "actionability", "persuasiveness"]),
  };
  const dimensionItems = DIMENSION_ORDER.flatMap((key) => {
    const review =
      key === "scenario_task" && feynmanAligned
        ? {
            score: feynmanAligned.score,
            verdict: feynmanAligned.verdict,
            evidence: feynmanAligned.evidence,
            source: "mixed" as const,
          }
        : report.dimensionReviews?.[key];
    const fallbackScore = fallbackDimensionScores[key];
    // 无声学数据时不展示「语音表现」，避免假维度占位
    if (key === "voice" && !review) return [];
    // 有题目清单时，即使缺分也保留「场景任务」维，方便展开 checklist
    const keepForTasks =
      key === "scenario_task" &&
      ((alignedTaskChecks ?? report.taskChecks)?.length ?? 0) > 0;
    if (!review && fallbackScore == null && !keepForTasks) return [];
    return [{
      key,
      label: DIMENSION_LABELS[key],
      score: review?.score ?? fallbackScore,
      verdict: review?.verdict ??
          (fallbackScore != null
            ? "该项来自旧版报告的相关细分分数。"
            : keepForTasks
              ? "题目要求完成情况见下方清单。"
              : "当前报告未提供此项判断。"),
      evidence: review?.evidence,
      source: review?.source ?? ("llm" as const),
      legacy: !review && fallbackScore != null,
    }];
  });
  const scoredDimensions = dimensionItems.filter(
    (item): item is typeof item & { score: number } => item.score != null,
  );
  const overallScore =
    scoredDimensions.length > 0
      ? Math.round(
          scoredDimensions.reduce((sum, item) => sum + item.score, 0) /
            scoredDimensions.length,
        )
      : undefined;
  const weakestDimension = scoredDimensions
    .slice()
    .sort((a, b) => a.score - b.score)[0];
  const lowestDimensionKey = weakestDimension?.key;
  const effectiveOpenDimension =
    openDimension === undefined ? lowestDimensionKey : openDimension;
  const totalChars = metrics?.totalChars ?? 0;
  const chars = Math.max(1, totalChars);
  const perHundredChars = (count: number) => ((count / chars) * 100).toFixed(1);
  const modePaceRange = currentPaceRange;
  const fillerRate = metrics ? (metrics.fillerCount / chars) * 100 : undefined;
  const hedgeRate = metrics ? (metrics.hedgeCount / chars) * 100 : undefined;
  const vagueRate = metrics ? (metrics.vagueWordCount / chars) * 100 : undefined;
  const repetitionPercent = metrics ? metrics.repetitionRate * 100 : undefined;
  const sampleSufficient =
    totalChars >= REVIEW_METRIC_THRESHOLDS.minCharsForRateJudgement;
  const rateStatus = (
    value: number | undefined,
    threshold: number,
  ): SignalStatus => {
    if (value == null) return "未评估";
    if (!sampleSufficient) return "样本不足";
    return value > threshold ? "偏多" : "正常";
  };
  const debateUserTurns = current.debate?.turns.filter(
    (turn) => turn.role === "user",
  );
  const hasMeasuredDuration = current.debate
    ? Boolean(
        debateUserTurns?.length &&
          debateUserTurns.every(
            (turn) =>
              turn.source === "audio" &&
              typeof turn.durationSec === "number" &&
              turn.durationSec > 0,
          ),
      )
    : current.inputSource === "audio"
      ? true
      : current.inputSource === "paste" || current.inputSource === "mixed"
        ? false
        : !(
            !current.audioFile &&
            (metrics?.durationSec ?? current.durationSec ?? 0) <= 2
          );
  const measuredDurationSec = hasMeasuredDuration
    ? metrics?.durationSec
    : undefined;
  const measuredWordsPerMinute = hasMeasuredDuration
    ? metrics?.wordsPerMinute
    : undefined;
  const allObjectiveSignals: ObjectiveSignal[] = metrics
    ? [
        {
          id: "duration",
          label: "时长",
          value: measuredDurationSec
            ? `${Math.round(measuredDurationSec)} 秒`
            : "未记录",
          status: measuredDurationSec ? "已记录" as const : "未评估" as const,
          detail: measuredDurationSec
            ? "是否达标见题目清单"
            : "粘贴文本无法推断口述时长",
        },
        {
          id: "pace",
          label: "语速",
          value: measuredWordsPerMinute
            ? `${measuredWordsPerMinute} 字/分`
            : "缺少时长",
          status: rangeStatus(measuredWordsPerMinute, modePaceRange),
          detail: `本模式参考 ${modePaceRange[0]}-${modePaceRange[1]}`,
        },
        {
          id: "fillers",
          label: "填充词",
          value: `${perHundredChars(metrics.fillerCount)} 次/百字`,
          status: rateStatus(
            fillerRate,
            REVIEW_METRIC_THRESHOLDS.fillerRatePerHundred,
          ),
          detail: sampleSufficient
            ? `共 ${metrics.fillerCount} 次，经验参考 <=${REVIEW_METRIC_THRESHOLDS.fillerRatePerHundred.toFixed(1)}`
            : `共 ${metrics.fillerCount} 次；少于 ${REVIEW_METRIC_THRESHOLDS.minCharsForRateJudgement} 字暂不判断高低`,
        },
        {
          id: "hedges",
          label: "犹豫词",
          value: `${perHundredChars(metrics.hedgeCount)} 次/百字`,
          status: rateStatus(
            hedgeRate,
            REVIEW_METRIC_THRESHOLDS.hedgeRatePerHundred,
          ),
          detail: sampleSufficient
            ? `共 ${metrics.hedgeCount} 次，经验参考 <=${REVIEW_METRIC_THRESHOLDS.hedgeRatePerHundred.toFixed(1)}`
            : `共 ${metrics.hedgeCount} 次；样本较短`,
        },
        {
          id: "vague",
          label: "模糊词",
          value: `${perHundredChars(metrics.vagueWordCount)} 次/百字`,
          status: rateStatus(
            vagueRate,
            REVIEW_METRIC_THRESHOLDS.vagueRatePerHundred,
          ),
          detail: sampleSufficient
            ? `共 ${metrics.vagueWordCount} 次，经验参考 <=${REVIEW_METRIC_THRESHOLDS.vagueRatePerHundred.toFixed(1)}`
            : `共 ${metrics.vagueWordCount} 次；样本较短`,
        },
        {
          id: "repetition",
          label: "重复率",
          value: `${repetitionPercent?.toFixed(1)}%`,
          status: rateStatus(
            metrics.repetitionRate,
            REVIEW_METRIC_THRESHOLDS.repetitionRate,
          ),
          detail: sampleSufficient
            ? `经验参考 <=${(REVIEW_METRIC_THRESHOLDS.repetitionRate * 100).toFixed(1)}%`
            : "样本较短，重复比例波动较大",
        },
        {
          id: "sentence-length",
          label: "平均句长",
          value: `${metrics.avgSentenceLength} 字`,
          status: !sampleSufficient
            ? "样本不足"
            : metrics.avgSentenceLength >
                REVIEW_METRIC_THRESHOLDS.avgSentenceLength
              ? "偏高"
              : "正常",
          detail: "按句末标点和字幕句段统计",
        },
        {
          id: "density",
          label: "本地密度分",
          value: `${metrics.densityScore}`,
          status: !sampleSufficient
            ? "样本不足"
            : metrics.densityScore < REVIEW_METRIC_THRESHOLDS.densityScore
              ? "偏低"
              : "正常",
          detail: "根据填充、犹豫和模糊表达粗估",
        },
        ...(metrics.longPauseCount != null
          ? [{
              id: "pauses",
              label: "长停顿",
              value: `${metrics.longPauseCount} 次`,
              status: metrics.longPauseCount >=
                  REVIEW_METRIC_THRESHOLDS.longPauseCount
                ? "偏多" as const
                : "正常" as const,
              detail: `经验参考 <${REVIEW_METRIC_THRESHOLDS.longPauseCount} 次`,
            }]
          : []),
      ]
    : [];
  const signalPriorityByIssue: Partial<Record<IssueCode, string[]>> = {
    too_many_fillers: ["fillers", "pace", "pauses"],
    hedging: ["hedges", "vague", "density"],
    vague_language: ["vague", "density", "sentence-length"],
    repetition: ["repetition", "sentence-length", "density"],
    low_density: ["density", "vague", "repetition"],
    long_pause: ["pauses", "pace", "duration"],
    long_sentence: ["sentence-length", "pace", "density"],
    insufficient_duration: ["duration", "pace", "density"],
  };
  const preferredSignalIds = targetIssueCode
    ? signalPriorityByIssue[targetIssueCode]
    : undefined;
  const orderedObjectiveSignals = preferredSignalIds
    ? [
        ...preferredSignalIds.flatMap((id) => {
          const signal = allObjectiveSignals.find((item) => item.id === id);
          return signal ? [signal] : [];
        }),
        ...allObjectiveSignals.filter(
          (item) => !preferredSignalIds.includes(item.id),
        ),
      ]
    : allObjectiveSignals;
  /** 成绩条只放语速 + 填充词；其余口语指标默认折叠。 */
  const HEADLINE_SIGNAL_IDS = ["pace", "fillers"] as const;
  const headlineSignals = HEADLINE_SIGNAL_IDS.flatMap((id) => {
    const signal = orderedObjectiveSignals.find((item) => item.id === id);
    return signal ? [signal] : [];
  });
  const extraSignals = orderedObjectiveSignals.filter(
    (item) => !HEADLINE_SIGNAL_IDS.includes(item.id as (typeof HEADLINE_SIGNAL_IDS)[number]),
  );
  const visibleExtraSignals = showAllSignals ? extraSignals : [];
  const usedRewriteIndexes = new Set<number>();
  const evidenceItems = report.sentenceFeedback.map((feedback) => {
    const original = feedback.original.trim();
    const rewriteIndex = report.rewriteExamples.findIndex((example, index) => {
      if (usedRewriteIndexes.has(index)) return false;
      const rewriteOriginal = example.original.trim();
      return (
        rewriteOriginal === original ||
        rewriteOriginal.includes(original) ||
        original.includes(rewriteOriginal)
      );
    });
    const rewrite =
      rewriteIndex >= 0 ? report.rewriteExamples[rewriteIndex] : undefined;
    if (rewriteIndex >= 0) usedRewriteIndexes.add(rewriteIndex);
    return {
      original: feedback.original,
      problem: feedback.comment,
      issues: feedback.issues,
      rewritten: rewrite?.rewritten,
      focus: rewrite?.focus,
    };
  });
  report.rewriteExamples.forEach((rewrite, index) => {
    if (!usedRewriteIndexes.has(index)) {
      evidenceItems.push({
        original: rewrite.original,
        problem: rewrite.focus,
        issues: [],
        rewritten: rewrite.rewritten,
        focus: rewrite.focus,
      });
    }
  });
  const visibleEvidence = showAllEvidence
    ? evidenceItems
    : evidenceItems.slice(0, 3);
  const transcriptText = current.finalTranscript ?? "";
  const transcriptSegments =
    showTranscript && transcriptText.trim()
      ? highlightTranscript(
          transcriptText,
          evidenceItems.map((item) => item.original),
        )
      : null;
  const taskChecks = alignedTaskChecks ?? report.taskChecks ?? [];
  const metTaskCount = taskChecks.filter(
    (check) => check.status === "met",
  ).length;
  const sampleSummary = measuredDurationSec
    ? `${totalChars} 字 / ${Math.round(measuredDurationSec)} 秒`
    : `${totalChars} 字`;
  const secondaryIssues = report.topIssues.slice(1);
  const signalStatusVariant = (status: SignalStatus) =>
    status === "正常"
      ? ("success" as const)
      : status === "未评估" ||
          status === "已记录" ||
          status === "样本不足"
        ? ("secondary" as const)
        : ("warning" as const);

  return (
    <div>
      <PageHeader
        title="复盘"
        description={current.topic}
        action={
          canReanalyze ? (
            <Button
              variant="ghost"
              size="sm"
              disabled={analyzing}
              onClick={() => void reanalyzeSession()}
            >
              {analyzing ? "评审中…" : "重新评审"}
            </Button>
          ) : undefined
        }
      />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge variant="secondary">
            {PRACTICE_MODE_LABELS[normalizedMode]}
          </Badge>
          <Badge>
            {report.source === "llm" ? "大模型报告" : "历史规则报告"}
          </Badge>
          {current.round != null && current.round > 1 && (
            <Badge variant="warning">第 {current.round} 轮</Badge>
          )}
          {analyzeNote && (
            <span className="text-muted-foreground text-sm">{analyzeNote}</span>
          )}
        </div>

        {cmp && comparisonHighlights.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2 rounded-lg border border-border bg-card px-3.5 py-2.5 text-sm">
            <Badge
              variant={
                cmp.conclusive === false
                  ? "secondary"
                  : cmp.improved
                    ? "success"
                    : "warning"
              }
            >
              {cmp.conclusive === false
                ? "结果不确定"
                : cmp.improved
                  ? "本轮有进步"
                  : "未明显提升"}
            </Badge>
            <span className="text-muted-foreground text-xs">
              对比第 {cmp.round - 1} 轮
            </span>
            {comparisonHighlights.map((highlight) => (
              <span
                key={highlight.label}
                className="flex items-center gap-1.5 text-xs"
              >
                <span className="text-muted-foreground">
                  {highlight.label}
                </span>
                <span className="tabular-nums">
                  {formatComparisonNumber(highlight.before)} →{" "}
                  <strong>{formatComparisonNumber(highlight.after)}</strong>
                </span>
                <strong
                  className={cn(
                    "tabular-nums text-[0.7rem]",
                    highlight.good === true && "text-success",
                    highlight.good === false && "text-destructive",
                  )}
                >
                  ({highlight.delta > 0 ? "+" : ""}
                  {formatComparisonNumber(highlight.delta)})
                </strong>
              </span>
            ))}
            <button
              type="button"
              className="text-primary ml-auto text-xs hover:underline"
              onClick={() => {
                setShowComparisonDetail(true);
                window.requestAnimationFrame(() => {
                  document
                    .getElementById("comparison-detail")
                    ?.scrollIntoView({ behavior: "smooth", block: "start" });
                });
              }}
            >
              查看对比详情
            </button>
          </div>
        )}

        {report.analysisCoverage?.strategy === "sampled" && (
          <Alert>
            <AlertTitle>本次报告使用长文本抽样</AlertTitle>
            <AlertDescription>
              {report.analysisCoverage.note} 已分析约 {report.analysisCoverage.analyzedChars} / {report.analysisCoverage.originalChars} 字。
            </AlertDescription>
          </Alert>
        )}

        {!hasTranscript && (
          <GuidancePanel title="本轮无法完成诊断" items={emptyGuidance} />
        )}

        {/* ① 下一步：唯一行动区 */}
        <Card className="surface-hero border-primary/25">
          <CardHeader className="pb-2">
            <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              下一步 · 只改这一点
            </div>
            <CardTitle className="text-lg">{nextStepTitle}</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.65fr)]">
            <div className="flex flex-col gap-3">
              {hasTranscript && focusIssue?.evidence && (
                <div className="border-primary/20 bg-background/70 rounded-lg border px-3.5 py-3 text-sm">
                  <span className="text-muted-foreground">判断依据：</span>
                  {focusIssue.evidence}
                </div>
              )}
              <p className="m-0 text-sm leading-relaxed">
                {nextStepSuggestion}
              </p>
              {recurringIssue && recurringIssue.count >= 2 && (
                <p className="border-warning/30 bg-warning/5 m-0 rounded-lg border px-3.5 py-2.5 text-xs leading-relaxed">
                  这个问题已累计出现 {recurringIssue.count} 次
                  {typeof reviewedSessionCount === "number" &&
                  reviewedSessionCount > 0
                    ? `（占有效练习 ${recurringIssue.sessionRate}%）`
                    : ""}
                  {recurringIssue.trend === "worsening"
                    ? "，且近期仍在增加——值得优先解决。"
                    : recurringIssue.trend === "improving"
                      ? "，但正在改善，继续保持。"
                      : "，值得优先解决。"}
                </p>
              )}
              {secondaryIssues.length > 0 && (
                <div>
                  <button
                    type="button"
                    className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-xs"
                    onClick={() => setShowSecondaryIssues((v) => !v)}
                    aria-expanded={showSecondaryIssues}
                  >
                    另有 {secondaryIssues.length} 个次要问题
                    {showSecondaryIssues ? (
                      <ChevronUp className="size-3.5" />
                    ) : (
                      <ChevronDown className="size-3.5" />
                    )}
                  </button>
                  {showSecondaryIssues && (
                    <div className="mt-2 flex flex-col gap-2">
                      {secondaryIssues.map((issue) => (
                        <div
                          key={`${issue.code}-${issue.title}`}
                          className="bg-muted/25 rounded-lg border border-border px-3 py-2.5 text-sm"
                        >
                          <div className="flex items-start justify-between gap-2">
                            <strong className="font-medium">{issue.title}</strong>
                            <Badge
                              variant={
                                issue.severity === "high"
                                  ? "destructive"
                                  : issue.severity === "medium"
                                    ? "warning"
                                    : "secondary"
                              }
                            >
                              {issue.severity === "high"
                                ? "高"
                                : issue.severity === "medium"
                                  ? "中"
                                  : "低"}
                            </Badge>
                          </div>
                          {issue.suggestion && (
                            <p className="text-muted-foreground mt-1 mb-0 text-xs leading-relaxed">
                              {issue.suggestion}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )}
            </div>
            <div className="flex flex-col gap-3">
              {hasTranscript && next && (
                <div className="bg-background/70 rounded-lg border border-border px-3.5 py-3 text-sm">
                  <span className="text-muted-foreground">复练题目：</span>
                  {next.retryPrompt}
                </div>
              )}
              {hasTranscript && next && next.successCriteria.length > 0 && (
                <div>
                  <div className="text-muted-foreground text-xs font-medium">
                    达标标准
                  </div>
                  <ul className="mt-2 mb-0 list-disc space-y-1.5 pl-5 text-sm">
                    {next.successCriteria.slice(0, 3).map((criterion) => (
                      <li key={criterion}>{criterion}</li>
                    ))}
                  </ul>
                </div>
              )}
              <Button asChild className="mt-auto w-fit">
                <Link to={hasTranscript ? `/retry/${current.id}` : "/practice"}>
                  {hasTranscript ? "开始同题复练" : "回练习页补救"}
                </Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {/* ② 成绩条：综合分 + 精简本地指标，单一口径 */}
        <Card>
          <CardHeader className="pb-2">
            <CardTitle className="text-lg">成绩</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
              {report.summary}
            </p>
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-[repeat(auto-fit,minmax(120px,1fr))]">
              <div className="min-w-0 bg-card px-3 py-2.5">
                <div className="text-muted-foreground truncate text-xs">
                  综合分
                </div>
                <div className="mt-0.5 text-lg font-semibold tabular-nums">
                  {overallScore ?? "--"}
                </div>
                {weakestDimension && (
                  <div className="text-muted-foreground mt-0.5 truncate text-[0.7rem]">
                    最弱 · {weakestDimension.label} {weakestDimension.score}
                  </div>
                )}
              </div>
              {taskChecks.length > 0 && (
                <button
                  type="button"
                  className="min-w-0 bg-card px-3 py-2.5 text-left hover:bg-muted/40"
                  onClick={() => {
                    setOpenDimension("scenario_task");
                    window.requestAnimationFrame(() => {
                      document
                        .getElementById("dimension-detail")
                        ?.scrollIntoView({ behavior: "smooth", block: "start" });
                    });
                  }}
                  title="查看题目清单"
                >
                  <div className="text-muted-foreground truncate text-xs">
                    任务完成
                  </div>
                  <div className="mt-0.5 text-lg font-semibold tabular-nums">
                    {metTaskCount}/{taskChecks.length}
                  </div>
                  <div className="text-primary mt-0.5 text-[0.7rem]">
                    查看清单
                  </div>
                </button>
              )}
              {headlineSignals.map((signal) => (
                <div key={signal.id} className="min-w-0 bg-card px-3 py-2.5">
                  <div className="text-muted-foreground truncate text-xs">
                    {signal.label}
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-baseline gap-1.5">
                    <span className="text-base font-semibold tabular-nums">
                      {signal.value}
                    </span>
                    <Badge variant={signalStatusVariant(signal.status)}>
                      {signal.status}
                    </Badge>
                  </div>
                </div>
              ))}
              {metrics && (
                <div className="min-w-0 bg-card px-3 py-2.5">
                  <div className="text-muted-foreground truncate text-xs">
                    样本
                  </div>
                  <div className="mt-0.5 text-base font-semibold tabular-nums">
                    {sampleSummary}
                  </div>
                  {!sampleSufficient && (
                    <div className="text-warning-foreground mt-0.5 text-[0.7rem]">
                      较短，比例仅供参考
                    </div>
                  )}
                </div>
              )}
            </div>
            {extraSignals.length > 0 && (
              <div>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-0"
                  onClick={() => setShowAllSignals((value) => !value)}
                >
                  {showAllSignals
                    ? "收起更多口语指标"
                    : `更多口语指标（${extraSignals.length}）`}
                  {showAllSignals ? (
                    <ChevronUp className="size-3.5" />
                  ) : (
                    <ChevronDown className="size-3.5" />
                  )}
                </Button>
                {visibleExtraSignals.length > 0 && (
                  <div className="mt-2 grid grid-cols-1 gap-px overflow-hidden rounded-lg border border-border bg-border sm:grid-cols-3">
                    {visibleExtraSignals.map((signal) => (
                      <div
                        key={signal.id}
                        className="min-w-0 bg-card px-3.5 py-3"
                      >
                        <div className="text-muted-foreground text-xs">
                          {signal.label}
                        </div>
                        <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
                          <span className="text-base font-semibold tabular-nums">
                            {signal.value}
                          </span>
                          <Badge variant={signalStatusVariant(signal.status)}>
                            {signal.status}
                          </Badge>
                        </div>
                        <div className="text-muted-foreground mt-1 text-xs leading-relaxed">
                          {signal.detail}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </CardContent>
        </Card>

        {/* 对话时间线：辩论 / 费曼多轮对照（有 turns 才出） */}
        {current.debate && current.debate.turns.length > 0 && (
          <ConversationTimeline
            debate={current.debate}
            mode={normalizedMode}
          />
        )}

        {/* ③ 诊断明细：五维唯一成绩口径；题目清单只在「场景任务」内 */}
        {dimensionItems.length > 0 && (
          <Card id="dimension-detail" className="scroll-mt-6">
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">诊断明细</CardTitle>
              <p className="text-muted-foreground mt-1 mb-0 text-sm">
                五维结论（综合分来源）；默认展开最弱一项。题目清单见「场景任务」。
              </p>
            </CardHeader>
            <CardContent className="flex flex-col overflow-hidden rounded-lg border border-border">
              {dimensionItems.map((item, index) => {
                const isOpen = item.key === effectiveOpenDimension;
                const checks =
                  item.key === "scenario_task" ? taskChecks : undefined;
                return (
                  <div
                    key={item.key}
                    className={cn(
                      "min-w-0",
                      index > 0 && "border-t border-border",
                    )}
                  >
                    <button
                      type="button"
                      aria-expanded={isOpen}
                      onClick={() => setOpenDimension(isOpen ? null : item.key)}
                      className="grid w-full cursor-pointer items-center gap-3 px-4 py-3.5 text-left sm:grid-cols-[8rem_minmax(120px,1fr)_3rem_1.25rem]"
                    >
                      <span className="text-sm font-medium">{item.label}</span>
                      {item.score != null ? (
                        <Progress value={item.score} className="h-1.5" />
                      ) : (
                        <span />
                      )}
                      <strong className="text-right text-lg tabular-nums">
                        {item.score ?? "--"}
                      </strong>
                      <ChevronDown
                        className={cn(
                          "text-muted-foreground size-4 transition-transform",
                          isOpen && "rotate-180",
                        )}
                      />
                    </button>
                    {isOpen && (
                      <div className="bg-muted/25 border-t border-border px-4 py-3 sm:pl-[9rem]">
                        <p className="m-0 text-sm leading-relaxed">
                          {item.verdict}
                        </p>
                        {item.evidence && (
                          <p className="text-muted-foreground mt-2 mb-0 text-xs leading-relaxed">
                            依据：{item.evidence}
                          </p>
                        )}
                        {checks && checks.length > 0 && (
                          <div className="mt-3 grid gap-2 sm:grid-cols-2">
                            {checks.map((check, checkIndex) => {
                              const Icon =
                                check.status === "met"
                                  ? CheckCircle2
                                  : check.status === "partial"
                                    ? CircleAlert
                                    : XCircle;
                              return (
                                <div
                                  key={`${check.label}-${checkIndex}`}
                                  className="bg-background flex gap-3 rounded-lg border border-border px-3.5 py-3"
                                >
                                  <Icon
                                    className={cn(
                                      "mt-0.5 size-4 shrink-0",
                                      check.status === "met" && "text-success",
                                      check.status === "partial" &&
                                        "text-warning",
                                      check.status === "missed" &&
                                        "text-destructive",
                                    )}
                                  />
                                  <div className="min-w-0">
                                    <div className="text-sm font-medium">
                                      {check.label}
                                    </div>
                                    {check.evidence && (
                                      <p className="text-muted-foreground mt-1 mb-0 text-xs leading-relaxed">
                                        {check.evidence}
                                      </p>
                                    )}
                                  </div>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <div className="text-muted-foreground mt-2 flex items-center gap-1 text-[0.7rem]">
                          <Info className="size-3" />
                          {item.legacy ? "旧报告推算" : SOURCE_LABELS[item.source]}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {/* ④ 怎么改：原句 vs 建议 */}
        {hasTranscript && evidenceItems.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">关键表达怎么改</CardTitle>
              <p className="text-muted-foreground m-0 text-sm">
                原句、问题与建议改写对照；默认 3 条。
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {visibleEvidence.map((item, index) => (
                <div
                  key={`${item.original}-${index}`}
                  id={`evidence-item-${index}`}
                  className="grid scroll-mt-6 gap-3 rounded-lg border border-border px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
                >
                  <div className="min-w-0">
                    <div className="text-muted-foreground text-xs font-medium">
                      原句
                    </div>
                    <p className="mt-1 mb-0 whitespace-pre-wrap text-sm leading-relaxed">
                      {item.original}
                    </p>
                    <div className="text-destructive mt-2 text-sm">
                      {item.problem}
                    </div>
                    {item.issues.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {item.issues.map((issue) => (
                          <Badge key={issue} variant="secondary">
                            {issueLabel(issue)}
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                  <div className="border-border md:border-l md:pl-4">
                    <div className="text-muted-foreground text-xs font-medium">
                      建议表达
                    </div>
                    <p className="mt-1 mb-0 whitespace-pre-wrap text-sm leading-relaxed">
                      {item.rewritten ??
                        "暂无对应改写，可先按左侧问题精简原句。"}
                    </p>
                    {item.focus && item.focus !== item.problem && (
                      <p className="text-muted-foreground mt-2 mb-0 text-xs">
                        改写重点：{item.focus}
                      </p>
                    )}
                  </div>
                </div>
              ))}
              {evidenceItems.length > 3 && (
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-fit"
                  onClick={() => setShowAllEvidence((value) => !value)}
                >
                  {showAllEvidence
                    ? "收起其余证据"
                    : `查看其余 ${evidenceItems.length - 3} 条`}
                </Button>
              )}
            </CardContent>
          </Card>
        )}

        {/* ⑤ 按需：整篇逻辑（默认收起） */}
        {hasTranscript && report.logicReview && (
          <Card className="border-border">
            <CardHeader className="pb-0">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left"
                onClick={() => setShowLogicReview((v) => !v)}
                aria-expanded={showLogicReview}
              >
                <div>
                  <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                    整篇逻辑
                  </div>
                  <CardTitle className="mt-1 text-base">
                    {narrativeFree
                      ? "主线是否清楚"
                      : "观点是否被论证清楚"}
                  </CardTitle>
                  {!showLogicReview && (
                    <p className="text-muted-foreground mt-1 mb-0 line-clamp-1 text-sm">
                      {report.logicReview.verdict}
                    </p>
                  )}
                </div>
                {showLogicReview ? (
                  <ChevronUp className="text-muted-foreground size-4 shrink-0" />
                ) : (
                  <ChevronDown className="text-muted-foreground size-4 shrink-0" />
                )}
              </button>
            </CardHeader>
            {showLogicReview && (
              <CardContent className="pt-3">
                <p className="text-muted-foreground m-0 mb-3 text-sm leading-relaxed">
                  {report.logicReview.verdict}
                </p>
                <div className="grid overflow-hidden rounded-lg border border-border md:grid-cols-2">
                  {(narrativeFree
                    ? [
                        ["讲述主线", report.logicReview.thesis],
                        ["关键细节", report.logicReview.support],
                        ["衔接", report.logicReview.coherence],
                        ["收束", report.logicReview.closure],
                      ]
                    : [
                        ["核心观点", report.logicReview.thesis],
                        ["论据支撑", report.logicReview.support],
                        ["推理衔接", report.logicReview.coherence],
                        ["结论闭环", report.logicReview.closure],
                      ]
                  ).map(([label, detail], index) => (
                    <div
                      key={label}
                      className={cn(
                        "min-w-0 px-4 py-3",
                        index > 0 && "border-t border-border",
                        index === 1 && "md:border-t-0 md:border-l",
                        index === 2 && "md:border-l-0",
                        index === 3 && "md:border-l",
                      )}
                    >
                      <div className="text-muted-foreground text-xs font-medium">
                        {label}
                      </div>
                      <p className="mt-1.5 mb-0 whitespace-pre-wrap text-sm leading-relaxed">
                        {detail}
                      </p>
                    </div>
                  ))}
                </div>
              </CardContent>
            )}
          </Card>
        )}

        {/* ⑥ 逐字稿 / 录音：有时间线时不重复列分轮录音，只保留全文高亮与重转写 */}
        {(hasTranscript || audioMaterials.length > 0 || hasAudio) && (
          <Card>
            <CardHeader className="pb-0">
              <button
                type="button"
                className="flex w-full items-center justify-between text-left text-[0.95rem] font-semibold"
                onClick={() => {
                  setShowDetails((v) => {
                    const next = !v;
                    if (next) {
                      setShowTranscript(true);
                      if (!audioCoveredByTimeline && audioMaterials.length > 0) {
                        setShowAudio(true);
                      }
                    }
                    return next;
                  });
                }}
                aria-expanded={showDetails}
              >
                {hasConversationTimeline ? "整篇逐字稿" : "原始材料"}
                <span className="text-muted-foreground flex items-center gap-1 text-sm font-normal">
                  {hasConversationTimeline
                    ? "高亮可跳改写"
                    : audioMaterials.length > 0
                      ? "逐字稿 · 录音"
                      : "逐字稿"}
                  {showDetails ? (
                    <ChevronUp className="size-4" />
                  ) : (
                    <ChevronDown className="size-4" />
                  )}
                </span>
              </button>
            </CardHeader>
            {showDetails && (
              <CardContent className="flex flex-col gap-4 pt-4">
                {hasConversationTimeline && audioCoveredByTimeline && (
                  <p className="text-muted-foreground m-0 text-xs leading-relaxed">
                    分轮发言与录音见上方「对话时间线」。此处为合并全文，便于对照改写高亮。
                  </p>
                )}

                {!hasConversationTimeline && (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => setShowTranscript((v) => !v)}
                    >
                      {showTranscript ? "收起逐字稿" : "查看逐字稿"}
                    </Button>
                    {audioMaterials.length > 0 && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => setShowAudio((v) => !v)}
                      >
                        {showAudio
                          ? "收起录音"
                          : `查看录音${audioMaterials.length > 1 ? `（${audioMaterials.length}）` : ""}`}
                      </Button>
                    )}
                    {!audioApi.isTauri() && (
                      <span className="text-muted-foreground self-center text-xs">
                        浏览器模式
                      </span>
                    )}
                  </div>
                )}

                {(showTranscript || hasConversationTimeline) && (
                  <div className="rounded-lg border border-border px-4 py-3">
                    {!hasConversationTimeline && (
                      <h3 className="mt-0 mb-3 text-base font-semibold">
                        最终逐字稿
                      </h3>
                    )}
                    {hasTranscript ? (
                      <>
                        {transcriptSegments?.some((seg) => seg.mark >= 0) && (
                          <p className="text-muted-foreground mt-0 mb-3 text-xs">
                            标黄句子有对应改写建议，点击可跳转。
                          </p>
                        )}
                        <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
                          {(transcriptSegments ?? []).map((seg, segIndex) =>
                            seg.mark < 0 ? (
                              <span key={segIndex}>{seg.text}</span>
                            ) : (
                              <button
                                key={segIndex}
                                type="button"
                                title="查看对应改写建议"
                                onClick={() => scrollToEvidence(seg.mark)}
                                className="decoration-warning/70 hover:bg-warning/35 cursor-pointer rounded-sm bg-warning/25 px-0.5 text-left underline decoration-2 underline-offset-2"
                              >
                                {seg.text}
                              </button>
                            ),
                          )}
                        </p>
                      </>
                    ) : (
                      <p className="text-muted-foreground m-0 text-sm">
                        无内容。可回练习页粘贴文本再分析。
                      </p>
                    )}
                  </div>
                )}

                {showAudio && audioMaterials.length > 0 && (
                  <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
                    <h3 className="m-0 text-base font-semibold">录音素材</h3>
                    <div className="flex flex-col gap-3">
                      {audioMaterials.map((material) => (
                        <div
                          key={material.id}
                          className="bg-muted/30 flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium">
                              {material.label}
                            </span>
                            {typeof material.durationSec === "number" && (
                              <span className="text-muted-foreground text-xs">
                                {Math.round(material.durationSec)} 秒
                              </span>
                            )}
                          </div>
                          {material.url ? (
                            <audio
                              controls
                              preload="metadata"
                              src={material.url}
                              className="w-full"
                              onCanPlay={() => setAudioError(null)}
                              onError={() =>
                                setAudioError(
                                  "录音加载失败，文件可能已被删除或不可访问。",
                                )
                              }
                            />
                          ) : (
                            <p className="text-muted-foreground m-0 text-sm">
                              浏览器模式只能回放本次最新录音。
                            </p>
                          )}
                        </div>
                      ))}
                      {audioError && (
                        <p className="text-destructive m-0 text-sm">
                          {audioError}
                        </p>
                      )}
                      {lastWavUrl && audioMaterials.length === 1 && (
                        <Button
                          variant="ghost"
                          size="sm"
                          asChild
                          className="w-fit"
                        >
                          <a href={lastWavUrl} download={`${current.id}.wav`}>
                            下载 WAV
                          </a>
                        </Button>
                      )}
                    </div>
                  </div>
                )}

                {hasAudio && audioApi.isTauri() && (
                  <Button
                    variant="secondary"
                    size="sm"
                    className="w-fit"
                    disabled={analyzing}
                    onClick={() =>
                      void reanalyzeSession({ retranscribe: true })
                    }
                  >
                    {analyzing ? "处理中…" : "用最新录音重新评审"}
                  </Button>
                )}
              </CardContent>
            )}
          </Card>
        )}

        {/* 复练对比详情：顶条摘要 + 此处按需展开，避免两处同时铺开 */}
        {cmp && (
          <div id="comparison-detail" className="scroll-mt-6">
            {showComparisonDetail ? (
              <div className="flex flex-col gap-2">
                <div className="flex justify-end">
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => setShowComparisonDetail(false)}
                  >
                    收起对比详情
                  </Button>
                </div>
                <ComparisonCard comparison={cmp} paceRange={modePaceRange} />
              </div>
            ) : comparisonHighlights.length === 0 ? (
              <Button
                variant="outline"
                size="sm"
                className="w-fit"
                onClick={() => setShowComparisonDetail(true)}
              >
                查看复练对比详情
              </Button>
            ) : null}
          </div>
        )}

        {error && (
          <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border px-3.5 py-3 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
