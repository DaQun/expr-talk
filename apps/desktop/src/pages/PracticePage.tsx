import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useNavigate, useSearchParams } from "react-router-dom";
import {
  categoriesForMode,
  DEFAULT_MODE_RUBRICS,
  normalizePracticeMode,
  SCORE_DIMENSION_LABELS,
  topicsForMode,
  type ScoreDimension,
} from "@showtalk/shared";
import { useSessionStore } from "@/state/sessionStore";
import { Button } from "@/components/ui/button";
import { useElapsedSeconds } from "@/hooks/useElapsedSeconds";
import { FeynmanWorkbench } from "@/components/FeynmanWorkbench";
import { DebateWorkbench } from "@/components/DebateWorkbench";
import { SoloWorkbench } from "@/components/SoloWorkbench";
import type { DebateRecordingUi } from "@/components/PracticeComposer";
import { useSettingsStore } from "@/state/settingsStore";
import { resolveLlmConfig } from "@/services/llmReadiness";

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
    streamedReasoning,
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
    finishInteractiveSession,
    analyzePaste,
    refreshModelStatus,
    loadSession,
  } = useSessionStore();
  const settings = useSettingsStore((state) => state.settings);
  const settingsLoaded = useSettingsStore((state) => state.loaded);

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
  const topicCategories = useMemo(
    () => categoriesForMode(draftMode),
    [draftMode],
  );
  const modeTopics = useMemo(() => topicsForMode(draftMode), [draftMode]);

  const [seconds, setSeconds] = useState(0);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string | null>(null);
  const [topicCategory, setTopicCategory] = useState("全部");
  const recording = current?.status === "recording";
  const debateMode = draftMode === "debate";
  const feynmanMode = draftMode === "feynman";
  const interactiveMode = debateMode || feynmanMode;
  const debateWaiting = interactiveMode && current?.status === "debating";
  // 费曼配置：会话进行中一律使用会话内快照，全局 draft 只表示“下一场”
  const sessionFeynman =
    current?.mode === "feynman" ? current.debate?.feynman : undefined;
  const effectiveLearnerRole = sessionFeynman?.learnerRole ?? feynmanLearnerRole;
  const effectiveDifficulty = sessionFeynman?.difficulty ?? feynmanDifficulty;
  const levelPct = Math.min(100, Math.round(level * 400));
  const llmReadiness = settingsLoaded
    ? resolveLlmConfig(settings)
    : ({ ok: false, reason: "正在检查大模型配置…" } as const);
  const llmReady = llmReadiness.ok;
  const finalSegs = recording
    ? liveSegments.filter((s) => s.isFinal && s.text.trim())
    : [];
  const analyzeElapsed = useElapsedSeconds(analyzing);

  async function finishDebateAndReview() {
    await finishInteractiveSession();
    const state = useSessionStore.getState();
    if (state.current?.id && state.report) {
      navigate(`/review/${state.current.id}`);
    }
  }

  // 文字提交的两种语义（按钮文案已在各工作台按状态区分）：
  // 交互模式等待回应时提交文字回应；否则提交粘贴文本做整段复盘。
  // 录音中无文字入口（输入区被隐藏），故无需处理 recording 分支。
  async function handlePasteSubmit() {
    if (debateWaiting) {
      const shouldReview = await submitDebateText();
      if (shouldReview) {
        const id = useSessionStore.getState().current?.id;
        navigate(id ? `/review/${id}` : "/review");
      }
      return;
    }

    await analyzePaste();
    const state = useSessionStore.getState();
    // 分析失败（如大模型未就绪/逐字稿为空）时留在本页展示错误，不跳进复盘
    if (state.error) return;
    if (state.current?.status === "debating") return;
    const id = state.current?.id;
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

  useEffect(() => {
    setTopicCategory("全部");
  }, [draftMode]);

  // 单一数据源：draftTopic。topicId 纯派生（与题库 prompt 完全匹配时才高亮对应项）
  const topicId = useMemo(
    () => modeTopics.find((t) => t.prompt === draftTopic)?.id ?? null,
    [draftTopic, modeTopics],
  );

  // 启动时若 store 仍是旧 mode id，归一成 free/short_video/debate/feynman
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
    if (!confirmDiscard) return;

    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !analyzing && !discarding) setConfirmDiscard(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [confirmDiscard, analyzing, discarding]);

  // 空格键开始/停止；输入控件聚焦时不抢占
  useEffect(() => {
    const toggle = (event: KeyboardEvent) => {
      if (event.code !== "Space" || event.repeat) return;
      const target = event.target as HTMLElement | null;
      if (
        target &&
        (target.closest("input, textarea, select, [contenteditable]") ||
          target.isContentEditable ||
          target.closest('[role="dialog"], [role="alertdialog"]'))
      ) {
        return;
      }
      if (analyzing || confirmDiscard) return;
      if (recording) {
        event.preventDefault();
        void (async () => {
          const shouldReview = await stopAndAnalyze();
          const id = useSessionStore.getState().current?.id;
          if (shouldReview) navigate(id ? `/review/${id}` : "/review");
        })();
        return;
      }
      if (!llmReady) return;
      if (debateWaiting) {
        event.preventDefault();
        void startDebateResponse();
        return;
      }
      if (!current) {
        event.preventDefault();
        void createAndStart();
      }
    };
    window.addEventListener("keydown", toggle);
    return () => window.removeEventListener("keydown", toggle);
  }, [
    recording,
    analyzing,
    confirmDiscard,
    llmReady,
    debateWaiting,
    current,
    stopAndAnalyze,
    startDebateResponse,
    createAndStart,
    navigate,
  ]);

  function selectTopic(id: string) {
    if (id === "custom") return; // 保留已输入文本；topicId 不再与题库匹配即视为自定义
    const topic = modeTopics.find((item) => item.id === id);
    if (!topic) return;
    setDraftTopic(topic.prompt);
  }

  const recordingUi: DebateRecordingUi = {
    seconds,
    levelPct,
    asrStatus,
    finalSegments: finalSegs,
    partialText,
    onStop: () => {
      void (async () => {
        const shouldReview = await stopAndAnalyze();
        const id = useSessionStore.getState().current?.id;
        if (shouldReview) {
          navigate(id ? `/review/${id}` : "/review");
        }
      })();
    },
    onRerecord: () => void rerecord(),
  };

  const discardDialog = confirmDiscard
    ? createPortal(
        <div
          className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4 backdrop-blur-[2px]"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !analyzing && !discarding) {
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
            {discardError && (
              <p
                role="alert"
                className="text-destructive mt-3 mb-0 text-sm leading-relaxed"
              >
                {discardError}
              </p>
            )}
            <div className="mt-5 flex justify-end gap-2">
              <Button
                variant="secondary"
                disabled={analyzing || discarding}
                autoFocus
                onClick={() => setConfirmDiscard(false)}
              >
                继续练习
              </Button>
              <Button
                variant="destructive"
                disabled={analyzing || discarding}
                onClick={() => {
                  void (async () => {
                    setDiscarding(true);
                    setDiscardError(null);
                    try {
                      await discardRecording();
                      setConfirmDiscard(false);
                    } catch (e) {
                      setDiscardError(
                        e instanceof Error ? e.message : "放弃失败，请重试。",
                      );
                    } finally {
                      setDiscarding(false);
                    }
                  })();
                }}
              >
                {discarding ? "正在丢弃…" : "确认放弃"}
              </Button>
            </div>
          </div>
        </div>,
        document.body,
      )
    : null;

  const sharedWorkbenchProps = {
    draftTopic,
    draftMode,
    topicCategory,
    topicCategories,
    topicId,
    topics: modeTopics,
    current,
    recording,
    analyzing,
    analyzeNote,
    analyzeElapsed,
    pasteText,
    modelReady: modelStatus?.ready ?? null,
    llmReady,
    llmReason: llmReadiness.ok ? undefined : llmReadiness.reason,
    recordingUi,
    discardDialog,
    error,
    onModeChange: setDraftMode,
    onTopicCategoryChange: setTopicCategory,
    onTopicSelect: selectTopic,
    onTopicChange: (topic: string) => {
      setDraftTopic(topic);
    },
    onPasteTextChange: setPasteText,
    onStartVoice: () => void createAndStart(),
    onSubmitText: () => void handlePasteSubmit(),
    onAbandon: () => setConfirmDiscard(true),
  };

  if (feynmanMode) {
    return (
      <FeynmanWorkbench
        {...sharedWorkbenchProps}
        waiting={debateWaiting}
        streamedQuestion={streamedQuestion}
        streamedReasoning={streamedReasoning}
        learnerRole={effectiveLearnerRole}
        difficulty={effectiveDifficulty}
        onLearnerRoleChange={setFeynmanLearnerRole}
        onDifficultyChange={setFeynmanDifficulty}
        onStartResponse={() => void startDebateResponse()}
        onRetryQuestion={() => void requestDebateQuestion()}
        onFinish={() => void finishDebateAndReview()}
        onOpenReview={() => {
          const id = useSessionStore.getState().current?.id;
          if (id) navigate(`/review/${id}`);
        }}
      />
    );
  }

  if (debateMode) {
    return (
      <DebateWorkbench
        {...sharedWorkbenchProps}
        waiting={debateWaiting}
        streamedQuestion={streamedQuestion}
        streamedReasoning={streamedReasoning}
        modeRubricLine={modeRubricLine}
        onStartResponse={() => void startDebateResponse()}
        onRetryQuestion={() => void requestDebateQuestion()}
        onFinish={() => void finishDebateAndReview()}
      />
    );
  }

  return (
    <SoloWorkbench
      {...sharedWorkbenchProps}
      modeRubricLine={modeRubricLine}
    />
  );
}
