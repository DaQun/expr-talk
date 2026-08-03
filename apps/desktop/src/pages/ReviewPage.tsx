import { useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
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
  SCORE_DIMENSION_LABELS,
  type DimensionReview,
  type EvaluationDimensionKey,
  type ScoreDimension,
} from "@expr-talk/shared";
import { useSessionStore } from "@/state/sessionStore";
import { ComparisonCard } from "@/components/ComparisonCard";
import {
  buildEmptyTranscriptGuidance,
  GuidancePanel,
} from "@/components/GuidancePanel";
import { audioApi } from "@/ipc/audio";
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
  llm: "综合判断",
  objective: "客观计算",
  mixed: "综合 + 客观",
};

function issueLabel(code: string): string {
  return ISSUE_CODE_LABELS[code as keyof typeof ISSUE_CODE_LABELS] ?? code;
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

type SignalStatus = "正常" | "偏低" | "偏高" | "偏多" | "未评估";

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
  const [audioError, setAudioError] = useState<string | null>(null);
  const analyzeElapsed = useElapsedSeconds(analyzing);

  useEffect(() => {
    if (sessionId && current?.id !== sessionId) void loadSession(sessionId);
  }, [sessionId, current?.id, loadSession]);

  useEffect(() => {
    void refreshModelStatus();
  }, [refreshModelStatus]);

  const hasTranscript = Boolean(current?.finalTranscript?.trim());
  const diskAudioPath = lastAudioPath || current?.audioFile || null;
  const playableAudioUrl =
    lastWavUrl ||
    (diskAudioPath && audioApi.isTauri()
      ? convertFileSrc(diskAudioPath)
      : null);
  const turnAudio = (current?.debate?.turns ?? [])
    .filter((turn) => turn.role === "user" && Boolean(turn.audioFile))
    .map((turn) => ({
      id: turn.id,
      label: `第 ${turn.round} 轮${current?.mode === "feynman" ? "讲解" : "我方发言"}`,
      path: turn.audioFile!,
      durationSec: turn.durationSec,
      url: audioApi.isTauri() ? convertFileSrc(turn.audioFile!) : null,
    }));
  const audioMaterials =
    turnAudio.length > 0
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
  const hasAudio = audioMaterials.length > 0;
  const canReanalyze = hasTranscript || hasAudio;
  const primaryIssue = report?.topIssues[0];
  const next = report?.nextPractice;
  const cmp = comparison ?? current?.comparison ?? null;

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
  const modelScores = Object.entries(report.scores).filter(
    (entry): entry is [ScoreDimension, number] => typeof entry[1] === "number",
  );
  const scorePriorityByMode: Record<string, ScoreDimension[]> = {
    free: ["logic", "structure", "clarity", "directness", "density"],
    short_video: ["logic", "hook", "density", "rhythm", "memorability"],
    debate: ["logic", "persuasiveness", "structure", "clarity", "directness"],
    feynman: ["clarity", "structure", "logic", "density", "directness"],
  };
  const scorePriority = scorePriorityByMode[current.mode] ?? scorePriorityByMode.free;
  const scoreMap = new Map(modelScores);
  const featuredScores = scorePriority
    .flatMap((key) => {
      const value = scoreMap.get(key);
      return typeof value === "number" ? ([[key, value]] as Array<[ScoreDimension, number]>) : [];
    })
    .slice(0, 3);
  const fallbackDimensionScores: Partial<Record<EvaluationDimensionKey, number>> = {
    content: averageScores(scoreMap, ["density", "memorability"]),
    logic: averageScores(scoreMap, ["logic", "structure", "persuasiveness"]),
    expression: averageScores(scoreMap, ["clarity", "directness", "rhythm"]),
    scenario_task: averageScores(scoreMap, ["hook", "actionability", "persuasiveness"]),
  };
  const dimensionItems = DIMENSION_ORDER.flatMap((key) => {
    const review = report.dimensionReviews?.[key];
    const fallbackScore = fallbackDimensionScores[key];
    if (key === "voice" && !review) return [];
    return [{
      key,
      label: DIMENSION_LABELS[key],
      score: review?.score ?? fallbackScore,
      verdict: review?.verdict ??
          (fallbackScore != null
            ? "该项来自旧版报告的相关细分分数。"
            : "当前报告未提供此项判断。"),
      evidence: review?.evidence,
      source: review?.source ?? ("llm" as const),
      legacy: !review && fallbackScore != null,
    }];
  });
  const lowestDimensionKey = dimensionItems
    .filter((item): item is typeof item & { score: number } => item.score != null)
    .sort((a, b) => a.score - b.score)[0]?.key;
  const chars = Math.max(1, metrics?.totalChars ?? 0);
  const perHundredChars = (count: number) => ((count / chars) * 100).toFixed(1);
  const modePaceRange = PACE_RANGES[current.mode] ?? PACE_RANGES.free;
  const fillerRate = metrics ? (metrics.fillerCount / chars) * 100 : undefined;
  const repetitionPercent = metrics ? metrics.repetitionRate * 100 : undefined;
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
  const objectiveSignals = metrics
    ? [
        {
          label: "时长",
          value: measuredDurationSec
            ? `${Math.round(measuredDurationSec)} 秒`
            : "未记录",
          status: measuredDurationSec ? "正常" as const : "未评估" as const,
          detail: measuredDurationSec
            ? "是否达标见题目清单"
            : "粘贴文本无法推断口述时长",
        },
        {
          label: "语速",
          value: measuredWordsPerMinute
            ? `${measuredWordsPerMinute} 字/分`
            : "缺少时长",
          status: rangeStatus(measuredWordsPerMinute, modePaceRange),
          detail: `本模式参考 ${modePaceRange[0]}-${modePaceRange[1]}`,
        },
        {
          label: "填充词",
          value: `${perHundredChars(metrics.fillerCount)} 次/百字`,
          status: fillerRate != null && fillerRate > 3 ? "偏多" as const : "正常" as const,
          detail: `共 ${metrics.fillerCount} 次，参考 <=3.0`,
        },
        {
          label: "重复率",
          value: `${repetitionPercent?.toFixed(1)}%`,
          status: repetitionPercent != null && repetitionPercent > 5 ? "偏多" as const : "正常" as const,
          detail: "参考 <=5.0%",
        },
        {
          label: "平均句长",
          value: `${metrics.avgSentenceLength} 字`,
          status: metrics.avgSentenceLength > 35 ? "偏高" as const : "正常" as const,
          detail: "按句末标点和字幕句段统计",
        },
      ]
    : [];
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

  return (
    <div>
      <PageHeader title="复盘" description={current.topic} />

      <div className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center gap-2">
          <Badge>
            {report.source === "llm" ? "大模型报告" : "历史规则报告"}
          </Badge>
          {current.round != null && current.round > 1 && (
            <Badge variant="warning">第 {current.round} 轮</Badge>
          )}
          {analyzeNote && (
            <span className="text-muted-foreground text-sm">{analyzeNote}</span>
          )}
          {canReanalyze && (
            <Button
              variant="ghost"
              size="sm"
              className="ml-auto"
              disabled={analyzing}
              onClick={() => void reanalyzeSession()}
            >
              {analyzing ? "评审中…" : "重新评审"}
            </Button>
          )}
        </div>

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

        <div className="grid gap-4 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
          <Card>
            <CardHeader className="pb-2">
              <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                整体表现
              </div>
              <CardTitle className="text-lg">本轮总结</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
                {report.summary}
              </p>
              {featuredScores.length > 0 && (
                <div className="grid grid-cols-3 divide-x divide-border overflow-hidden rounded-lg border border-border">
                  {featuredScores.map(([key, value], index) => (
                    <div key={key} className="min-w-0 px-3 py-2.5">
                      <div className="text-muted-foreground truncate text-xs">
                        {index === 0 ? "核心 · " : ""}
                        {SCORE_DIMENSION_LABELS[key] ?? key}
                      </div>
                      <div className="mt-0.5 text-lg font-semibold tabular-nums">
                        {value}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="surface-hero border-primary/25">
            <CardHeader className="pb-2">
              <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                最优先改这一点
              </div>
              <CardTitle className="text-lg">
                {hasTranscript && primaryIssue
                  ? primaryIssue.title
                  : hasTranscript
                    ? "整体较稳"
                    : "缺少逐字稿"}
              </CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {primaryIssue?.evidence && hasTranscript && (
                <div className="border-primary/20 bg-background/70 rounded-lg border px-3.5 py-3 text-sm">
                  <span className="text-muted-foreground">判断依据：</span>
                  {primaryIssue.evidence}
                </div>
              )}
              <p className="m-0 text-sm leading-relaxed">
                {hasTranscript
                  ? (primaryIssue?.suggestion ??
                    next?.instruction ??
                    report.summary)
                  : "先解决录音或识别问题，生成逐字稿后才能给出可复练目标。"}
              </p>
              <Button asChild className="w-fit">
                <Link to={hasTranscript ? `/retry/${current.id}` : "/practice"}>
                  {hasTranscript ? "围绕这一点再练一次" : "回练习页补救"}
                </Link>
              </Button>
            </CardContent>
          </Card>
        </div>

        {dimensionItems.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <CardTitle className="text-lg">五维评测总览</CardTitle>
                  <p className="text-muted-foreground mt-1 mb-0 text-sm">
                    分数用于定位相对强弱，结论与证据用于决定怎么改。
                  </p>
                </div>
                <Badge variant="outline">按本轮场景评估</Badge>
              </div>
            </CardHeader>
            <CardContent className="flex flex-col overflow-hidden rounded-lg border border-border">
              {dimensionItems.map((item, index) => (
                <details
                  key={item.key}
                  open={item.key === lowestDimensionKey}
                  className={cn(
                    "group min-w-0",
                    index > 0 && "border-t border-border",
                  )}
                >
                  <summary className="grid cursor-pointer list-none items-center gap-3 px-4 py-3.5 sm:grid-cols-[8rem_minmax(120px,1fr)_3rem_1.25rem]">
                    <span className="text-sm font-medium">{item.label}</span>
                    {item.score != null ? (
                      <Progress value={item.score} className="h-1.5" />
                    ) : null}
                    <strong className="text-right text-lg tabular-nums">{item.score ?? "--"}</strong>
                    <ChevronDown className="text-muted-foreground size-4 transition-transform group-open:rotate-180" />
                  </summary>
                  <div className="bg-muted/25 border-t border-border px-4 py-3 sm:pl-[9rem]">
                    <p className="m-0 text-sm leading-relaxed">{item.verdict}</p>
                    {item.evidence && (
                      <p className="text-muted-foreground mt-2 mb-0 text-xs leading-relaxed">
                        依据：{item.evidence}
                      </p>
                    )}
                    <div className="text-muted-foreground mt-2 flex items-center gap-1 text-[0.7rem]">
                      <Info className="size-3" />
                      {item.legacy
                        ? "旧报告推算"
                        : SOURCE_LABELS[item.source]}
                    </div>
                  </div>
                </details>
              ))}
            </CardContent>
          </Card>
        )}

        {report.taskChecks && report.taskChecks.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-lg">题目完成情况</CardTitle>
              <p className="text-muted-foreground m-0 text-sm">
                逐项核对本轮题目与场景要求。
              </p>
            </CardHeader>
            <CardContent className="grid gap-2 md:grid-cols-2">
              {report.taskChecks.map((check, index) => {
                const Icon = check.status === "met"
                  ? CheckCircle2
                  : check.status === "partial"
                    ? CircleAlert
                    : XCircle;
                return (
                  <div key={`${check.label}-${index}`} className="flex gap-3 rounded-lg border border-border px-3.5 py-3">
                    <Icon className={cn(
                      "mt-0.5 size-4 shrink-0",
                      check.status === "met" && "text-success",
                      check.status === "partial" && "text-warning",
                      check.status === "missed" && "text-destructive",
                    )} />
                    <div className="min-w-0">
                      <div className="text-sm font-medium">{check.label}</div>
                      {check.evidence && (
                        <p className="text-muted-foreground mt-1 mb-0 text-xs leading-relaxed">{check.evidence}</p>
                      )}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        )}

        {objectiveSignals.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <div className="flex items-center justify-between gap-2">
                <CardTitle className="text-base">客观口语指标</CardTitle>
                <Badge variant="outline">本地计算</Badge>
              </div>
            </CardHeader>
            <CardContent className="grid grid-cols-2 overflow-hidden rounded-lg border border-border sm:grid-cols-3 lg:grid-cols-5">
              {objectiveSignals.map((signal, index) => (
                <div key={signal.label} className={cn("min-w-0 px-3.5 py-3", index > 0 && "border-l border-border")}>
                  <div className="text-muted-foreground text-xs">{signal.label}</div>
                  <div className="mt-1 flex flex-wrap items-baseline gap-1.5">
                    <span className="text-base font-semibold tabular-nums">{signal.value}</span>
                    <Badge
                      variant={
                        signal.status === "正常"
                          ? "success"
                          : signal.status === "未评估"
                            ? "secondary"
                            : "warning"
                      }
                    >
                      {signal.status}
                    </Badge>
                  </div>
                  {signal.detail && <div className="text-muted-foreground mt-0.5 text-xs">{signal.detail}</div>}
                </div>
              ))}
            </CardContent>
          </Card>
        )}

        {hasTranscript && report.logicReview && (
          <Card className="border-primary/20">
            <CardHeader className="pb-3">
              <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                整篇逻辑
              </div>
              <CardTitle className="text-lg">观点是否被论证清楚</CardTitle>
              <p className="text-muted-foreground m-0 text-sm leading-relaxed">
                {report.logicReview.verdict}
              </p>
            </CardHeader>
            <CardContent>
              <div className="grid overflow-hidden rounded-lg border border-border md:grid-cols-2">
                {[
                  ["核心观点", report.logicReview.thesis],
                  ["论据支撑", report.logicReview.support],
                  ["推理衔接", report.logicReview.coherence],
                  ["结论闭环", report.logicReview.closure],
                ].map(([label, detail], index) => (
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
          </Card>
        )}

        {hasTranscript && evidenceItems.length > 0 && (
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">关键表达怎么改</CardTitle>
              <p className="text-muted-foreground m-0 text-sm">
                把原句、问题和建议改写放在一起，按证据逐条看。
              </p>
            </CardHeader>
            <CardContent className="flex flex-col gap-2.5">
              {visibleEvidence.map((item, index) => (
                <div
                  key={`${item.original}-${index}`}
                  className="grid gap-3 rounded-lg border border-border px-4 py-3 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]"
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

        {next && hasTranscript && (
          <Card className="border-primary/20">
            <CardHeader className="pb-2">
              <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                下一轮练习
              </div>
              <CardTitle className="text-lg">{issueLabel(next.targetIssue)}</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(260px,0.65fr)]">
              <div>
                <p className="m-0 text-sm leading-relaxed">
                  {next.instruction}
                </p>
                <div className="bg-muted/40 mt-3 rounded-lg border border-border px-3.5 py-3 text-sm">
                  <span className="text-muted-foreground">复练题目：</span>
                  {next.retryPrompt}
                </div>
              </div>
              <div className="flex flex-col gap-3">
                {next.successCriteria.length > 0 && (
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
                <Button asChild className="w-fit">
                  <Link to={`/retry/${current.id}`}>开始同题复练</Link>
                </Button>
              </div>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader className="pb-0">
            <button
              type="button"
              className="flex w-full items-center justify-between text-left text-[0.95rem] font-semibold"
              onClick={() => setShowDetails((v) => !v)}
              aria-expanded={showDetails}
            >
              完整报告与原始材料
              <span className="text-muted-foreground flex items-center gap-1 text-sm font-normal">
                {showDetails ? "收起" : "展开"}
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
              {report.topIssues.length > 1 && (
                <div className="flex flex-col gap-2">
                  <h3 className="m-0 text-base font-semibold">其他问题</h3>
                  <div className="flex flex-col gap-2">
                    {report.topIssues.slice(1).map((issue, index) => (
                      <div
                        key={`${issue.code}-${issue.title}`}
                        className="bg-card flex items-start justify-between gap-3 rounded-lg border border-border px-4 py-3"
                      >
                        <div className="min-w-0">
                          <strong>
                            {index + 2}. {issue.title}
                          </strong>
                          {issue.evidence && (
                            <div className="text-muted-foreground mt-1 whitespace-pre-wrap text-sm">
                              证据：{issue.evidence}
                            </div>
                          )}
                          {issue.suggestion && (
                            <div className="mt-1 whitespace-pre-wrap text-sm">
                              建议：{issue.suggestion}
                            </div>
                          )}
                        </div>
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
                    ))}
                  </div>
                </div>
              )}

              <div className="flex flex-wrap gap-2 border-t border-border pt-4">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowTranscript((v) => !v)}
                >
                  {showTranscript ? "收起逐字稿" : "查看逐字稿"}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => setShowAudio((v) => !v)}
                >
                  {showAudio
                    ? "收起录音"
                    : `查看录音${audioMaterials.length > 1 ? `（${audioMaterials.length}）` : ""}`}
                </Button>
                {!audioApi.isTauri() && (
                  <span className="text-muted-foreground self-center text-xs">
                    浏览器模式
                  </span>
                )}
              </div>

              {showTranscript && (
                <div className="rounded-lg border border-border px-4 py-3">
                  <h3 className="mt-0 mb-3 text-base font-semibold">
                    最终逐字稿
                  </h3>
                  {hasTranscript ? (
                    <p className="m-0 whitespace-pre-wrap leading-relaxed">
                      {current.finalTranscript}
                    </p>
                  ) : (
                    <p className="text-muted-foreground m-0">
                      无内容。可回练习页粘贴文本再分析。
                    </p>
                  )}
                </div>
              )}

              {showAudio && (
                <div className="flex flex-col gap-3 rounded-lg border border-border px-4 py-3">
                  <h3 className="m-0 text-base font-semibold">录音素材</h3>
                  {audioMaterials.length > 0 ? (
                    <div className="flex flex-col gap-3">
                      {audioMaterials.map((material) => (
                        <div
                          key={material.id}
                          className="bg-muted/30 flex flex-col gap-2 rounded-lg border border-border px-3 py-2.5"
                        >
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <span className="text-sm font-medium">{material.label}</span>
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
                          {material.path && (
                            <p className="text-muted-foreground m-0 font-mono text-xs break-all">
                              {material.path}
                            </p>
                          )}
                        </div>
                      ))}
                      {audioError && (
                        <p className="text-destructive m-0 text-sm">{audioError}</p>
                      )}
                      {lastWavUrl && audioMaterials.length === 1 && (
                        <Button variant="ghost" size="sm" asChild className="w-fit">
                          <a href={lastWavUrl} download={`${current.id}.wav`}>
                            下载 WAV
                          </a>
                        </Button>
                      )}
                    </div>
                  ) : (
                    <p className="text-muted-foreground m-0 text-sm">
                      没有可回放录音（可能各轮都使用了粘贴文本，或已按隐私设置删除）。
                    </p>
                  )}
                  {hasAudio && (
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
                </div>
              )}
            </CardContent>
          )}
        </Card>

        {cmp && <ComparisonCard comparison={cmp} />}

        {error && (
          <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border px-3.5 py-3 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
