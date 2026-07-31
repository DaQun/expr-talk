import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  categoriesForMode,
  DEFAULT_MODE_RUBRICS,
  MODE_PRACTICE_HINTS,
  MODE_SUGGESTED_DURATION_SEC,
  normalizePracticeMode,
  pickRandomTopic,
  PRACTICE_MODE_LABELS,
  PRACTICE_MODES,
  SCORE_DIMENSION_LABELS,
  topicsForMode,
  type PracticeMode,
  type ScoreDimension,
} from "@expr-talk/shared";
import { useSessionStore } from "@/state/sessionStore";
import { audioApi } from "@/ipc/audio";
import {
  buildPracticeGuidance,
  GuidancePanel,
} from "@/components/GuidancePanel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { useElapsedSeconds } from "@/hooks/useElapsedSeconds";
import { FeynmanWorkbench } from "@/components/FeynmanWorkbench";

export function PracticePage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const {
    draftMode: rawDraftMode,
    draftTopic,
    pasteText,
    current,
    analyzing,
    error,
    analyzeNote,
    streamedQuestion,
    level,
    liveSegments,
    partialText,
    asrStatus,
    modelStatus,
    setDraftMode,
    setDraftTopic,
    setPasteText,
    feynmanLearnerRole,
    feynmanDifficulty,
    setFeynmanLearnerRole,
    setFeynmanDifficulty,
    createAndStart,
    rerecord,
    discardRecording,
    stopAndAnalyze,
    startDebateResponse,
    requestDebateQuestion,
    submitDebateText,
    finishDebate,
    analyzePaste,
    refreshModelStatus,
    loadSession,
  } = useSessionStore();

  const draftMode = normalizePracticeMode(rawDraftMode);

  const modeRubricLine = useMemo(
    () =>
      Object.entries(DEFAULT_MODE_RUBRICS[draftMode])
        .map(([k, v]) => {
          const label = SCORE_DIMENSION_LABELS[k as ScoreDimension] ?? k;
          return `${label} ${Math.round((v ?? 0) * 100)}%`;
        })
        .join(" · "),
    [draftMode],
  );
  const suggestedSec = MODE_SUGGESTED_DURATION_SEC[draftMode];
  const topicCategories = useMemo(
    () => categoriesForMode(draftMode),
    [draftMode],
  );
  const modeTopics = useMemo(() => topicsForMode(draftMode), [draftMode]);

  const [seconds, setSeconds] = useState(0);
  const [pasteOpen, setPasteOpen] = useState(false);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [topicCategory, setTopicCategory] = useState("全部");
  const [topicId, setTopicId] = useState<string | null>(null);
  const transcriptScrollRef = useRef<HTMLDivElement>(null);
  const transcriptAutoFollowRef = useRef(true);
  const recording = current?.status === "recording";
  const debateMode = draftMode === "debate";
  const feynmanMode = draftMode === "feynman";
  const interactiveMode = debateMode || feynmanMode;
  const debateWaiting = interactiveMode && current?.status === "debating";
  const sessionActive = recording || debateWaiting;
  const canAbandon =
    Boolean(current) &&
    current?.status !== "reviewed" &&
    current?.status !== "completed" &&
    current?.status !== "failed";
  const tauri = audioApi.isTauri();
  const levelPct = Math.min(100, Math.round(level * 400));
  const startDisabled = sessionActive || analyzing;
  const finalSegs = liveSegments.filter((s) => s.isFinal && s.text.trim());
  const hasSubtitle = Boolean(finalSegs.length > 0 || partialText.trim());
  const analyzeElapsed = useElapsedSeconds(analyzing);

  async function finishDebateAndReview() {
    await finishDebate();
    const state = useSessionStore.getState();
    if (state.current?.id && state.report) {
      navigate(`/review/${state.current.id}`);
    }
  }

  async function handlePasteSubmit() {
    if (recording) {
      const shouldReview = await stopAndAnalyze();
      const id = useSessionStore.getState().current?.id;
      if (shouldReview) navigate(id ? `/review/${id}` : "/review");
      return;
    }

    if (debateWaiting) {
      const shouldReview = await submitDebateText();
      if (shouldReview) {
        const id = useSessionStore.getState().current?.id;
        navigate(id ? `/review/${id}` : "/review");
      }
      return;
    }

    await analyzePaste();
    if (useSessionStore.getState().current?.status === "debating") return;
    const id = useSessionStore.getState().current?.id;
    navigate(id ? `/review/${id}` : "/review");
  }

  useEffect(() => {
    const t = window.setTimeout(() => {
      void refreshModelStatus();
    }, 300);
    return () => window.clearTimeout(t);
  }, [refreshModelStatus]);

  useEffect(() => {
    const resumeId = searchParams.get("resume");
    if (resumeId && current?.id !== resumeId) void loadSession(resumeId);
  }, [searchParams, current?.id, loadSession]);

  // 切换模式时重置分类；选题高亮由实际题目文本决定
  useEffect(() => {
    setTopicCategory("全部");
  }, [draftMode]);

  useEffect(() => {
    const match = modeTopics.find((t) => t.prompt === draftTopic);
    setTopicId(match?.id ?? null);
  }, [draftTopic, modeTopics]);

  // 启动时若 store 仍是旧 mode id，归一成 free/short_video/debate
  useEffect(() => {
    if (rawDraftMode !== draftMode) {
      setDraftMode(draftMode);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!recording) {
      setConfirmDiscard(false);
      return;
    }
    setSeconds(0);
    const timer = window.setInterval(() => setSeconds((s) => s + 1), 1000);
    return () => window.clearInterval(timer);
  }, [recording, current?.id]);

  useEffect(() => {
    transcriptAutoFollowRef.current = true;
  }, [current?.id]);

  useEffect(() => {
    const container = transcriptScrollRef.current;
    if (!container || !transcriptAutoFollowRef.current) return;

    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [liveSegments, partialText]);

  useEffect(() => {
    if (!confirmDiscard) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !analyzing) setConfirmDiscard(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmDiscard, analyzing]);

  useEffect(() => {
    if (recording && seconds >= 10 && !hasSubtitle) {
      setPasteOpen(true);
    }
  }, [recording, seconds, hasSubtitle]);

  const guidance = useMemo(
    () =>
      buildPracticeGuidance({
        tauri,
        recording,
        hasSubtitle,
        levelPct,
        modelReady: modelStatus ? modelStatus.ready : null,
        modelHint: modelStatus?.hint,
        asrStatus,
        error,
        seconds,
      }),
    [
      tauri,
      recording,
      hasSubtitle,
      levelPct,
      modelStatus,
      asrStatus,
      error,
      seconds,
    ],
  );

  const mm = String(Math.floor(seconds / 60)).padStart(2, "0");
  const ss = String(seconds % 60).padStart(2, "0");

  function selectTopic(id: string) {
    const topic = modeTopics.find((item) => item.id === id);
    if (!topic) return;
    setTopicId(topic.id);
    setDraftTopic(topic.prompt);
  }

  const recorderPanel = (
    <div className="bg-background grid min-h-[12rem] gap-3 rounded-lg border border-border p-3.5 lg:grid-cols-[180px_minmax(0,1fr)]">
      <div className="border-border flex flex-col justify-between gap-3 lg:border-r lg:pr-4">
        <div>
          <div className="text-muted-foreground text-[0.72rem] font-medium tracking-wide uppercase">
            录音台
          </div>
          <div
            className="mt-1 font-mono text-3xl font-bold tracking-widest tabular-nums"
            aria-live="polite"
          >
            {mm}:{ss}
          </div>
        </div>
        <div>
          <Progress
            value={recording ? levelPct : 0}
            aria-label={recording ? "音量电平" : "待机音量"}
          />
          <p className="text-muted-foreground mt-1.5 mb-0 text-xs">
            {recording
              ? `电平 ${levelPct}%${levelPct < 5 ? " · 请靠近麦克风" : ""}`
              : "麦克风待机"}
          </p>
        </div>
      </div>
      <div className="flex min-h-36 min-w-0 flex-col justify-between gap-3">
        <div>
          <div className="text-muted-foreground flex items-center justify-between gap-3 text-[0.72rem] font-medium tracking-wide uppercase">
            <span>实时字幕</span>
            <span className="normal-case tracking-normal">
              {recording ? asrStatus || "采集中" : "待命"}
            </span>
          </div>
          <div
            ref={transcriptScrollRef}
            className="mt-2 max-h-[5.5rem] overflow-y-auto text-sm leading-relaxed break-words"
            onScroll={(event) => {
              const container = event.currentTarget;
              const distanceFromBottom =
                container.scrollHeight -
                container.scrollTop -
                container.clientHeight;
              transcriptAutoFollowRef.current = distanceFromBottom <= 8;
            }}
          >
            {finalSegs.map((segment) => (
              <div key={segment.id} className="mb-1 last:mb-0">
                {segment.text}
              </div>
            ))}
            {partialText && (
              <div className="text-primary/90 mb-1 last:mb-0">
                {partialText}
              </div>
            )}
            {!hasSubtitle && (
              <span className="text-muted-foreground">
                {recording
                  ? levelPct < 5
                    ? "请开始说话，电平应跳动…"
                    : "正在识别…若超过 15 秒仍无字，可粘贴文本"
                  : "开始后，你说出的内容会按句显示在这里。"}
              </span>
            )}
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {debateWaiting ? (
            <>
              <Button
                disabled={analyzing || !current?.debate?.pendingQuestion}
                onClick={() => void startDebateResponse()}
              >
                {feynmanMode ? "开始录音讲解" : "开始回应"}
              </Button>
              {debateMode && (
                <Button
                  variant="secondary"
                  disabled={analyzing}
                  onClick={() => void finishDebateAndReview()}
                >
                  结束并查看复盘
                </Button>
              )}
            </>
          ) : !recording ? (
            <>
              <Button
                disabled={startDisabled}
                onClick={() => void createAndStart()}
              >
                {debateMode
                  ? "开始立论"
                  : feynmanMode
                    ? "开始讲解"
                    : "开始录音练习"}
              </Button>
              <span className="text-muted-foreground text-xs">
                {debateMode
                  ? "立论结束后，模型会提出反方质询"
                  : feynmanMode
                    ? "讲解后，小白会追问直到确认理解"
                    : "说完后停止，自动进入复盘"}
              </span>
            </>
          ) : (
            <>
              <Button
                disabled={analyzing || confirmDiscard}
                onClick={() => {
                  void (async () => {
                    const shouldReview = await stopAndAnalyze();
                    const id = useSessionStore.getState().current?.id;
                    if (shouldReview) {
                      navigate(id ? `/review/${id}` : "/review");
                    }
                  })();
                }}
              >
                {analyzing
                  ? "分析中…"
                  : debateMode
                  ? "停止本轮回应"
                  : feynmanMode
                    ? "停止本轮讲解"
                    : "停止并进入复盘"}
              </Button>
              <Button
                variant="secondary"
                disabled={analyzing || confirmDiscard}
                onClick={() => void rerecord()}
                title="丢弃当前录音与字幕，保留题目后重新开始"
              >
                重新录制
              </Button>
              <Button
                variant="ghost"
                disabled={analyzing}
                onClick={() => setConfirmDiscard(true)}
                title="停止麦克风并放弃本次练习，不进入分析"
              >
                放弃本次练习
              </Button>
            </>
          )}
        </div>
      </div>
    </div>
  );

  const discardDialog = confirmDiscard
    ? createPortal(
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !analyzing) {
              setConfirmDiscard(false);
            }
          }}
        >
          <div
            role="alertdialog"
            aria-modal="true"
            aria-labelledby="discard-title"
            aria-describedby="discard-description"
            className="bg-card w-full max-w-sm rounded-xl border border-border p-5 shadow-2xl"
          >
            <h2 id="discard-title" className="m-0 text-lg font-semibold">
              放弃本次练习？
            </h2>
            <p
              id="discard-description"
              className="text-muted-foreground mt-2 mb-0 text-sm leading-relaxed"
            >
              本次未完成的讲解、提问、录音和字幕都会被丢弃，不会生成复盘报告。题目仍会保留。
            </p>
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={analyzing}
                autoFocus
                onClick={() => setConfirmDiscard(false)}
              >
                继续练习
              </Button>
              <Button
                variant="destructive"
                disabled={analyzing}
                onClick={() => {
                  void (async () => {
                    await discardRecording();
                    setConfirmDiscard(false);
                  })();
                }}
              >
                确认放弃
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  if (feynmanMode) {
    return (
      <FeynmanWorkbench
        draftTopic={draftTopic}
        draftMode={draftMode}
        topicCategory={topicCategory}
        topicCategories={topicCategories}
        topicId={topicId}
        topics={modeTopics}
        current={current}
        recording={recording}
        waiting={debateWaiting}
        analyzing={analyzing}
        streamedQuestion={streamedQuestion}
        pasteText={pasteText}
        learnerRole={feynmanLearnerRole}
        difficulty={feynmanDifficulty}
        modelReady={modelStatus?.ready ?? null}
        recorderPanel={recorderPanel}
        discardDialog={discardDialog}
        guidance={
          <GuidancePanel
            title={recording ? "录音中提示" : "开始前检查"}
            items={guidance.filter((item) => item.id !== "ready")}
          />
        }
        error={error}
        onModeChange={setDraftMode}
        onTopicCategoryChange={setTopicCategory}
        onTopicSelect={selectTopic}
        onTopicChange={(topic) => {
          setDraftTopic(topic);
          setTopicId(null);
        }}
        onPasteTextChange={setPasteText}
        onLearnerRoleChange={setFeynmanLearnerRole}
        onDifficultyChange={setFeynmanDifficulty}
        onStartVoice={() => void createAndStart()}
        onStartResponse={() => void startDebateResponse()}
        onSubmitText={() => void handlePasteSubmit()}
        onRetryQuestion={() => void requestDebateQuestion()}
        onAbandon={() => setConfirmDiscard(true)}
        onOpenReview={() => {
          const id = useSessionStore.getState().current?.id;
          if (id) navigate(`/review/${id}`);
        }}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="练习"
        description={
          debateMode
            ? "先立论，再回应反方质询；结束后生成整场复盘。"
            : feynmanMode
              ? "向小白讲解一个概念；小白会追问，直到确认已经听懂。"
            : "说完就停。只改一个点，马上复练对比。"
        }
        className="mb-4"
      />

      <div className="flex flex-col gap-3">
        <GuidancePanel
          title={recording ? "录音中提示" : "开始前检查"}
          items={guidance.filter((g) => g.id !== "ready")}
        />

        <Card
          className={cn(
            "relative overflow-hidden",
            recording &&
              "border-warning/40 shadow-[0_0_0_1px_oklch(0.8_0.14_85_/_12%)]",
          )}
        >
          {recording && (
            <div className="from-transparent via-warning to-transparent absolute inset-x-0 top-0 h-0.5 animate-pulse bg-gradient-to-r" />
          )}
          <CardContent className="flex flex-col gap-3 pt-1">
            <div className="flex flex-wrap gap-2">
              <Badge>{PRACTICE_MODE_LABELS[draftMode]}</Badge>
              <Badge variant="outline">建议 {suggestedSec} 秒</Badge>
              {recording && <Badge variant="warning">● 录音中</Badge>}
              {current?.parentSessionId && (
                <Badge variant="warning">
                  复练第 {current.round ?? "?"} 轮
                </Badge>
              )}
              {modelStatus && (
                <Badge variant={modelStatus.ready ? "success" : "warning"}>
                  ASR {modelStatus.ready ? "就绪" : "未就绪"}
                </Badge>
              )}
            </div>

            <div className="bg-muted/50 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-border px-3.5 py-2.5">
              <p className="text-sm leading-relaxed">
                {MODE_PRACTICE_HINTS[draftMode]}
              </p>
              <p className="text-muted-foreground text-xs">
                评分侧重：{modeRubricLine}
              </p>
            </div>

            {debateMode && current?.debate && current.debate.turns.length > 0 && (
              <div className="bg-background max-h-64 overflow-y-auto rounded-lg border border-border p-3.5">
                <div className="text-muted-foreground mb-2 text-[0.72rem] font-medium tracking-wide uppercase">
                  辩论记录 · 第 {current.debate.currentRound} 轮
                </div>
                <div className="flex flex-col gap-2 text-sm leading-relaxed">
                  {current.debate.turns
                    .filter(
                      (turn, index, turns) =>
                        !(
                          current.debate?.pendingQuestion &&
                          turn.role === "opponent" &&
                          index === turns.length - 1
                        ),
                    )
                    .map((turn) => (
                      <div
                        key={turn.id}
                        className={cn(
                          "border-l-2 px-3 py-1.5",
                          turn.role === "opponent"
                            ? "border-warning"
                            : "border-border",
                        )}
                      >
                        <div className="text-muted-foreground mb-0.5 text-xs">
                          {turn.role === "opponent" ? "反方质询" : "我的发言"} · 第 {turn.round} 轮
                        </div>
                        {turn.text}
                      </div>
                    ))}
                </div>
              </div>
            )}

            {debateWaiting && current?.debate?.pendingQuestion && (
              <div className="border-warning/50 bg-warning/10 rounded-lg border px-3.5 py-3">
                <div className="text-warning-foreground mb-1 text-xs font-medium">
                  反方质询
                </div>
                <p className="m-0 text-sm leading-relaxed">{current.debate.pendingQuestion}</p>
              </div>
            )}

            {debateWaiting && !current?.debate?.pendingQuestion && (
              <Button
                variant="secondary"
                disabled={analyzing}
                onClick={() => void requestDebateQuestion()}
              >
                重试生成反方质询
              </Button>
            )}

            <div className="grid gap-3 lg:grid-cols-[minmax(180px,0.65fr)_minmax(0,1.35fr)]">
              <div className="space-y-1.5">
                <Label htmlFor="mode">训练模式</Label>
                <Select
                  value={draftMode}
                  onValueChange={(v) => setDraftMode(v as PracticeMode)}
                  disabled={sessionActive}
                >
                  <SelectTrigger id="mode" className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent position="popper">
                    {PRACTICE_MODES.map((m) => (
                      <SelectItem key={m} value={m}>
                        {PRACTICE_MODE_LABELS[m]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-1.5">
                  <div className="flex flex-wrap items-end gap-2">
                    <div className="min-w-[8rem] flex-1 space-y-2">
                      <Label htmlFor="topic-cat">
                        {draftMode === "free" ? "提示库" : "主题分类"}
                      </Label>
                      <Select
                        value={topicCategory}
                        onValueChange={setTopicCategory}
                        disabled={sessionActive}
                      >
                        <SelectTrigger id="topic-cat" className="w-full">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {topicCategories.map((c) => (
                            <SelectItem key={c} value={c}>
                              {c}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="min-w-[12rem] flex-[2] space-y-2">
                      <Label htmlFor="topic-pick">选题</Label>
                      <Select
                        value={topicId ?? "custom"}
                        onValueChange={selectTopic}
                        disabled={sessionActive}
                      >
                        <SelectTrigger id="topic-pick" className="w-full">
                          <SelectValue
                            placeholder={
                              current?.parentSessionId
                                ? "自定义复练题目"
                                : draftTopic.trim()
                                  ? "自定义题目"
                                  : "选择题目"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent position="popper">
                          {topicId === null && (
                            <SelectItem value="custom" disabled>
                              自定义题目
                            </SelectItem>
                          )}
                          {modeTopics
                            .filter(
                              (t) =>
                                topicCategory === "全部" ||
                                t.category === topicCategory,
                            )
                            .map((t) => (
                              <SelectItem key={t.id} value={t.id}>
                                {t.title}
                                {t.side === "pro"
                                  ? " · 正方"
                                  : t.side === "con"
                                    ? " · 反方"
                                    : ""}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={sessionActive}
                      onClick={() => {
                        const t = pickRandomTopic(
                          draftMode,
                          topicCategory,
                          topicId ?? undefined,
                        );
                        selectTopic(t.id);
                      }}
                    >
                      换一题
                    </Button>
                  </div>
              </div>

              <div className="space-y-1.5 lg:col-span-2">
                <Label htmlFor="topic">题目（可改）</Label>
                <Textarea
                  id="topic"
                  value={draftTopic}
                  onChange={(e) => {
                    setDraftTopic(e.target.value);
                    setTopicId(null);
                  }}
                  disabled={sessionActive}
                  rows={2}
                  className="min-h-20"
                />
              </div>
            </div>

            {recorderPanel}

            <div className="flex flex-wrap gap-2.5">
              <Button variant="ghost" onClick={() => setPasteOpen((v) => !v)}>
                {pasteOpen ? "收起粘贴稿" : "没有字幕？粘贴文本"}
              </Button>
              {canAbandon && !recording && (
                <Button
                  variant="ghost"
                  disabled={analyzing}
                  onClick={() => setConfirmDiscard(true)}
                >
                  放弃本次练习
                </Button>
              )}
            </div>
          </CardContent>
        </Card>

        {pasteOpen && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base">
                {debateWaiting ? "粘贴本轮回应" : "粘贴逐字稿"}
              </CardTitle>
              <CardDescription>
                {debateWaiting
                  ? `将作为第 ${(current?.debate?.currentRound ?? 1) + 1} 轮我方回应，提交后继续生成反方质询。`
                  : "优先于 ASR 结果。适合模型未就绪、浏览器预览，或识别不准时补救。"}
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div className="space-y-2">
                <Label htmlFor="paste">逐字稿</Label>
                <Textarea
                  id="paste"
                  value={pasteText}
                  onChange={(e) => setPasteText(e.target.value)}
                  placeholder="把口语内容粘贴到这里…"
                  disabled={analyzing}
                />
              </div>
              <div className="flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  disabled={analyzing || !pasteText.trim()}
                  onClick={() => void handlePasteSubmit()}
                >
                  {recording && interactiveMode
                    ? "用粘贴稿结束本轮"
                    : recording
                      ? "用粘贴稿停止并分析"
                      : debateWaiting
                        ? `提交第 ${(current?.debate?.currentRound ?? 1) + 1} 轮文字回应`
                        : debateMode
                          ? "提交首轮文字立论"
                          : "仅分析粘贴文本"}
                </Button>
                {debateWaiting && debateMode && (
                  <Button
                    variant="outline"
                    disabled={analyzing}
                    onClick={() => void finishDebateAndReview()}
                  >
                    结束并查看复盘
                  </Button>
                )}
              </div>
            </CardContent>
          </Card>
        )}

        {analyzeNote && (
          <div className="text-muted-foreground text-sm" role="status">
            <p className="m-0">
              {analyzeNote}
              {analyzing ? ` · 已等待 ${analyzeElapsed} 秒` : ""}
            </p>
            {analyzing && analyzeElapsed >= 30 && (
              <p className="mt-1 mb-0 text-xs">
                模型仍在生成完整报告，请继续等待；超过 2 分钟才会停止请求。
              </p>
            )}
          </div>
        )}
        {error && !guidance.some((g) => g.id === "error") && (
          <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border px-3.5 py-3 text-sm">
            {error}
          </div>
        )}
      </div>

      {discardDialog}
    </div>
  );
}
