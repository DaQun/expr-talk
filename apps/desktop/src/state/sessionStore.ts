import { create } from "zustand";
import type {
  AttemptComparison,
  CreateSessionInput,
  DebateState,
  FeynmanCheckpoint,
  FeynmanDifficulty,
  FeynmanLearnerRole,
  PracticeMode,
  StructuredReport,
  TrainingGoal,
  TrainingSession,
  TranscriptSegment,
} from "@expr-talk/shared";
import {
  DEFAULT_MODE_GOALS,
  DEFAULT_MODE_TOPICS,
  defaultTopicForMode,
  normalizePracticeMode,
} from "@expr-talk/shared";
import { compareAttempts, formatFinalAsrSegment, joinFinalSegments } from "@expr-talk/core";
import {
  sanitizeDisplayReasoning,
  type LLMStreamProgress,
} from "@expr-talk/llm";
import { api } from "../ipc/client";
import { MicRecorder } from "../audio/recorder";
import type { AsrEventPayload, AsrModelStatus } from "../ipc/audio";
import { audioApi } from "../ipc/audio";
import { withTimeout } from "../utils/timeout";
import { useSettingsStore } from "./settingsStore";
import { resolveLlmConfig } from "../services/llmReadiness";
import {
  applyFeynmanEvaluation,
  formatDebateTranscript,
  initialDebateState,
  interactiveQuestionLabel,
  isInteractiveMode,
  matchesActiveRecording,
  recordingIdsForSession,
  turnRecordingId,
  withoutSessionRecordings,
} from "./sessionLifecycle";

async function resolveAsrOptions(): Promise<{
  asrProvider: string;
  asrConfig: Record<string, unknown>;
}> {
  try {
    // 优先内存设置；未 load 时拉一次
    let settings = useSettingsStore.getState().settings;
    if (!useSettingsStore.getState().loaded) {
      await useSettingsStore.getState().load();
      settings = useSettingsStore.getState().settings;
    }
    const asrProvider = settings.asr.realtimeProvider || "local-sherpa";
    const asrConfig = {
      ...(settings.asr.providers[asrProvider] ?? {}),
    };
    return { asrProvider, asrConfig };
  } catch {
    return { asrProvider: "local-sherpa", asrConfig: {} };
  }
}

type SessionState = {
  current: TrainingSession | null;
  report: StructuredReport | null;
  comparison: AttemptComparison | null;
  draftMode: PracticeMode;
  draftTopic: string;
  draftGoal: TrainingGoal | string;
  pasteText: string;
  analyzing: boolean;
  error: string | null;
  analyzeNote: string | null;
  /** 正在生成的交互式模型回复；完成后才写入正式对话记录。 */
  streamedQuestion: string | null;
  /** 流式阶段的模型思考过程（reasoning）；有值才展示，无值不展示。 */
  streamedReasoning: string | null;
  level: number;
  lastWavUrl: string | null;
  lastAudioPath: string | null;
  liveSegments: TranscriptSegment[];
  partialText: string;
  asrStatus: string | null;
  modelStatus: AsrModelStatus | null;
  /** 即将开始的复练上下文 */
  retryParentId: string | null;
  feynmanLearnerRole: FeynmanLearnerRole;
  feynmanDifficulty: FeynmanDifficulty;
  setDraftMode: (mode: PracticeMode) => void;
  setDraftTopic: (topic: string) => void;
  setDraftGoal: (goal: TrainingGoal | string) => void;
  setPasteText: (text: string) => void;
  setFeynmanLearnerRole: (role: FeynmanLearnerRole) => void;
  setFeynmanDifficulty: (difficulty: FeynmanDifficulty) => void;
  refreshModelStatus: () => Promise<void>;
  createAndStart: () => Promise<void>;
  /** 从父 session 创建复练，等待用户选择输入方式并开始。 */
  startRetry: (parentSessionId: string) => Promise<boolean>;
  /** 录音中丢弃本轮音轨与字幕，保留题目/目标/复练关系后重新开始 */
  rerecord: () => Promise<void>;
  /** 放弃整场未完成训练：停麦、删除素材和记录，保留题目草稿。 */
  discardRecording: () => Promise<void>;
  /** 返回 true 时应进入复盘；false 表示辩论仍在进行。 */
  stopAndAnalyze: () => Promise<boolean>;
  startDebateResponse: () => Promise<void>;
  requestDebateQuestion: () => Promise<void>;
  /** 提交粘贴文字作为当前反方质询的回应；返回 true 时进入复盘。 */
  submitDebateText: () => Promise<boolean>;
  finishInteractiveSession: () => Promise<void>;
  analyzePaste: () => Promise<void>;
  /**
   * 复盘页：对已有素材重新评审。
   * - retranscribe=true 或无逐字稿且有录音：先离线转写再分析
   * - 否则用当前 finalTranscript 重新出报告
   */
  reanalyzeSession: (opts?: { retranscribe?: boolean }) => Promise<void>;
  loadSession: (id: string) => Promise<void>;
  clearError: () => void;
};

let activeRecorder: MicRecorder | null = null;
let startLock = false;

async function ensureLlmReady(): Promise<void> {
  const store = useSettingsStore.getState();
  if (!store.loaded) await store.load();
  const ready = resolveLlmConfig(useSettingsStore.getState().settings);
  if (!ready.ok) throw new Error(ready.reason);
}

function revokeLastWavUrl(url: string | null) {
  if (url) URL.revokeObjectURL(url);
}

function formatOfflineTranscript(raw: string): string {
  return joinFinalSegments(
    raw
      .split(/\n+/)
      .map((text) => text.trim())
      .filter(Boolean)
      .map((text) => ({ text, isFinal: true })),
  );
}

function createLlmProgressReporter(
  set: (partial: Partial<SessionState>) => void,
): (progress: LLMStreamProgress) => void {
  let lastReportedChars = -250;
  return ({ phase, receivedChars }) => {
    if (phase === "streaming" && receivedChars - lastReportedChars < 250) return;
    lastReportedChars = receivedChars;
    const analyzeNote =
      phase === "connecting"
        ? "正在连接大模型…"
        : phase === "parsing"
          ? "正在整理复盘报告…"
          : receivedChars > 0
            ? `正在接收评审内容… ${receivedChars} 字`
            : "大模型已连接，等待生成内容…";
    set({ analyzeNote });
  };
}

function extractStreamedQuestion(content?: string): string | null {
  if (!content?.trim()) return null;

  try {
    const parsed = JSON.parse(content);
    if (parsed && typeof parsed.question === "string" && parsed.question.trim()) {
      return parsed.question.trim();
    }
    return null;
  } catch {
    // JSON incomplete — best-effort partial extraction
  }

  const match = content.match(/"question"\s*:\s*"((?:\\.|[^"\\])*)/);
  if (!match) return null;
  const raw = match[1];
  try {
    const question = JSON.parse(`"${raw}"`);
    return typeof question === "string" && question.trim() ? question : null;
  } catch {
    const unescaped = raw
      .replace(/\\n/g, "\n")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
    return unescaped.trim() || null;
  }
}

function cleanReasoningForDisplay(reasoning?: string | null): string | undefined {
  if (!reasoning?.trim()) return undefined;
  const cleaned = sanitizeDisplayReasoning(reasoning);
  return cleaned || undefined;
}

function createInteractiveProgressReporter(
  set: (partial: Partial<SessionState>) => void,
): (progress: LLMStreamProgress) => void {
  const reportProgress = createLlmProgressReporter(set);
  let lastPreview = "";
  let lastReasoning = "";
  return (progress) => {
    reportProgress(progress);
    const reasoning = cleanReasoningForDisplay(progress.reasoning);
    if (reasoning && reasoning !== lastReasoning) {
      lastReasoning = reasoning;
      set({ streamedReasoning: reasoning });
    }
    const preview = extractStreamedQuestion(progress.content);
    if (!preview || preview === lastPreview) return;
    lastPreview = preview;
    set({ streamedQuestion: preview });
  };
}

function localId(): string {
  return `ses_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

async function discardSessionRecordings(session: TrainingSession): Promise<void> {
  await Promise.all(
    recordingIdsForSession(session).map((id) =>
      audioApi.discard(id).catch(() => undefined),
    ),
  );
}

async function generateInteractiveQuestion(
  session: TrainingSession,
  onProgress: (progress: LLMStreamProgress) => void,
): Promise<{
  question: string;
  understood: boolean;
  focus?: string;
  checkpoints?: FeynmanCheckpoint[];
}> {
  if (session.mode === "feynman") {
    return api.generateFeynmanQuestion(session, onProgress);
  }
  const result = await api.generateDebateQuestion(session, onProgress);
  return { question: result.question, understood: false, focus: result.focus };
}

async function completeInteractiveSession(
  session: TrainingSession,
  set: (partial: Partial<SessionState>) => void,
): Promise<{ session: TrainingSession; report: StructuredReport }> {
  if (!session.debate) throw new Error("缺少多轮训练上下文");
  const completed: TrainingSession = {
    ...session,
    status: "analyzing",
    finalTranscript: formatDebateTranscript(session.debate),
    debate: {
      ...session.debate,
      phase: "completed",
      pendingQuestion: undefined,
    },
  };
  await api.updateSession(completed);
  const report = await api.analyze(
    completed.id,
    completed,
    createLlmProgressReporter(set),
  );
  const reviewed: TrainingSession = {
    ...completed,
    status: "reviewed",
    report,
    metrics: (await api.getSession(completed.id))?.metrics,
  };
  if (!useSettingsStore.getState().settings.privacy.keepAudio) {
    await discardSessionRecordings(reviewed);
    const withoutAudio = withoutSessionRecordings(reviewed);
    await api.updateSession(withoutAudio);
    return { session: withoutAudio, report };
  }
  await api.updateSession(reviewed);
  return { session: reviewed, report };
}

type InteractiveQuestionOutcome = {
  waiting: TrainingSession;
  learnerUnderstood: boolean;
};

async function handleInteractiveQuestionResult(
  session: TrainingSession,
  debate: DebateState,
  result: { question: string; understood: boolean; focus?: string; checkpoints?: FeynmanCheckpoint[] },
  round: number,
  reasoning?: string,
): Promise<InteractiveQuestionOutcome> {
  const displayReasoning = cleanReasoningForDisplay(reasoning);
  const nextDebate: DebateState =
    session.mode === "feynman"
      ? applyFeynmanEvaluation(debate, result, displayReasoning)
      : {
          ...debate,
          phase: "cross_examination",
          pendingQuestion: result.question,
          turns: [
            ...debate.turns,
            {
              id: `debate_opponent_${Date.now()}`,
              role: "opponent" as const,
              round,
              text: result.question,
              createdAt: new Date().toISOString(),
              ...(displayReasoning ? { reasoning: displayReasoning } : {}),
            },
          ],
        };
  const waiting: TrainingSession = {
    ...session,
    status: "debating",
    debate: nextDebate,
    finalTranscript: formatDebateTranscript(nextDebate),
  };
  await api.updateSession(waiting);
  return { waiting, learnerUnderstood: session.mode === "feynman" && result.understood };
}

function applyAsrEvent(
  get: () => SessionState,
  set: (partial: Partial<SessionState>) => void,
  recordingId: string,
  ev: AsrEventPayload,
) {
  if (
    ev.sessionId !== recordingId ||
    activeRecorder?.recordingId !== recordingId ||
    !matchesActiveRecording(get().current, recordingId)
  ) {
    return;
  }
  if (ev.type === "ready") {
    set({
      asrStatus: ev.message ?? "ASR 就绪",
      // 就绪后清掉启动阶段的 ASR 告警，避免一直红条
      error: null,
    });
    return;
  }
  if (ev.type === "error") {
    const msg = ev.message ?? "ASR 错误";
    // 无 sessionId 的多为预加载全局事件，只更新状态栏，不打断练习
    if (!ev.sessionId) {
      set({ asrStatus: msg });
      return;
    }
    set({
      asrStatus: msg,
      error: msg,
    });
    return;
  }
  if (ev.type === "partial") {
    set({
      partialText: ev.text,
      asrStatus: "识别中…",
      error: null,
    });
    return;
  }
  if (ev.type === "final") {
    const text = formatFinalAsrSegment(ev.text);
    const segments = [...get().liveSegments];
    const existing = segments.find((s) => s.id === ev.segmentId);
    if (existing) {
      existing.text = text;
      existing.isFinal = true;
    } else {
      segments.push({
        id: ev.segmentId || `seg_${Date.now()}`,
        text,
        isFinal: true,
      });
    }
    set({ liveSegments: segments, partialText: "", asrStatus: "句段完成" });
  }
}

async function buildComparison(
  session: TrainingSession,
  report: StructuredReport,
): Promise<AttemptComparison | null> {
  if (!session.parentSessionId || !session.metrics) return null;
  const parent = await api.getSession(session.parentSessionId);
  if (!parent?.metrics) return null;

  return compareAttempts({
    parentSessionId: parent.id,
    round: session.round ?? 2,
    targetIssue:
      session.targetIssue ??
      parent.report?.nextPractice.targetIssue ??
      report.nextPractice.targetIssue,
    beforeMetrics: parent.metrics,
    afterMetrics: session.metrics,
    beforeReport: parent.report,
    afterReport: report,
    successCriteria: parent.report?.nextPractice.successCriteria,
  });
}

export const useSessionStore = create<SessionState>((rawSet, get) => {
  const set: (partial: Partial<SessionState>) => void = (partial) => {
    if ("analyzing" in partial) {
      rawSet({ ...partial, streamedQuestion: null, streamedReasoning: null });
    } else {
      rawSet(partial);
    }
  };
  return {
  current: null,
  report: null,
  comparison: null,
  draftMode: "free",
  draftTopic: DEFAULT_MODE_TOPICS.free,
  draftGoal: DEFAULT_MODE_GOALS.free,
  pasteText: "",
  analyzing: false,
  error: null,
  analyzeNote: null,
  streamedQuestion: null,
  streamedReasoning: null,
  level: 0,
  lastWavUrl: null,
  lastAudioPath: null,
  liveSegments: [],
  partialText: "",
  asrStatus: null,
  modelStatus: null,
  retryParentId: null,
  feynmanLearnerRole: "outsider",
  feynmanDifficulty: "standard",

  setDraftMode: (mode) => {
    const m = normalizePracticeMode(mode);
    const topic = defaultTopicForMode(m);
    const currentMode = get().current?.mode;
    const modeChanged = currentMode !== undefined && currentMode !== m;
    // 切换训练模式时清空上一场会话，避免旧对话残留到新模式
    if (modeChanged) {
      if (activeRecorder?.isRunning) {
        void activeRecorder.discard().catch(() => undefined);
        activeRecorder = null;
      }
      revokeLastWavUrl(get().lastWavUrl);
    }
    set({
      draftMode: m,
      draftTopic: topic.prompt,
      draftGoal: DEFAULT_MODE_GOALS[m],
      ...(modeChanged
        ? {
            current: null,
            report: null,
            comparison: null,
            retryParentId: null,
            error: null,
            analyzeNote: null,
            streamedQuestion: null,
            streamedReasoning: null,
            level: 0,
            liveSegments: [],
            partialText: "",
            lastWavUrl: null,
            lastAudioPath: null,
            asrStatus: null,
            pasteText: "",
          }
        : {}),
    });
  },
  setDraftTopic: (topic) => set({ draftTopic: topic }),
  setDraftGoal: (goal) => set({ draftGoal: goal }),
  setPasteText: (text) => set({ pasteText: text }),
  setFeynmanLearnerRole: (role) => set({ feynmanLearnerRole: role }),
  setFeynmanDifficulty: (difficulty) => set({ feynmanDifficulty: difficulty }),
  clearError: () => set({ error: null }),

  refreshModelStatus: async () => {
    try {
      const status = await audioApi.modelStatus();
      set({ modelStatus: status });
    } catch {
      // ignore
    }
  },

  createAndStart: async () => {
    if (startLock) return;
    if (get().current?.status === "recording" && activeRecorder?.isRunning) {
      return;
    }
    try {
      await ensureLlmReady();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    startLock = true;
    const draftMode = normalizePracticeMode(get().draftMode);

    const pendingRetry = get().current;
    const shouldResumeRetry =
      pendingRetry?.status === "created" && Boolean(pendingRetry.parentSessionId);
    const provisional: TrainingSession = shouldResumeRetry
      ? {
          ...pendingRetry,
          status: "recording",
          startedAt: new Date().toISOString(),
          liveTranscript: [],
        }
      : {
          id: localId(),
          mode: draftMode,
          topic: get().draftTopic,
          goal: get().draftGoal,
          status: "recording",
          startedAt: new Date().toISOString(),
          liveTranscript: [],
          round: 1,
          ...(isInteractiveMode(draftMode)
            ? {
                debate: initialDebateState(
                  draftMode,
                  draftMode === "feynman"
                    ? {
                        learnerRole: get().feynmanLearnerRole,
                        difficulty: get().feynmanDifficulty,
                      }
                    : undefined,
                ),
              }
            : {}),
        };

    revokeLastWavUrl(get().lastWavUrl);
    set({
      current: provisional,
      report: null,
      comparison: null,
      retryParentId: provisional.parentSessionId ?? null,
      error: null,
      analyzeNote: null,
      streamedQuestion: null,
      streamedReasoning: null,
      level: 0,
      liveSegments: [],
      partialText: "",
      lastWavUrl: null,
      lastAudioPath: null,
      asrStatus: "请求麦克风…",
    });

    try {
      if (activeRecorder) {
        try {
          await activeRecorder.discard();
        } catch {
          // ignore
        }
        activeRecorder = null;
      }

      const { asrProvider, asrConfig } = await resolveAsrOptions();
      const recorder = new MicRecorder({
        sessionId: provisional.id,
        enableAsr: true,
        asrProvider,
        asrConfig,
        onLevel: (rms) => set({ level: rms }),
        onError: (err) => set({ error: err.message }),
        onAsrEvent: (ev) => applyAsrEvent(get, set, provisional.id, ev),
        onStatus: (msg) => set({ asrStatus: msg }),
      });

      await recorder.startLocalOnly();
      activeRecorder = recorder;
      await api.updateSession(provisional);

      window.setTimeout(() => {
        void recorder.connectBackend();
      }, 50);
    } catch (e) {
      if (activeRecorder) {
        await activeRecorder.discard().catch(() => undefined);
      }
      activeRecorder = null;
      set({
        current: null,
        asrStatus: null,
        error:
          e instanceof Error
            ? e.message
            : String(e) || "无法启动麦克风，请到系统设置允许麦克风",
      });
    } finally {
      startLock = false;
    }
  },

  startDebateResponse: async () => {
    if (startLock || get().analyzing) return;
    const current = get().current;
    if (
      !current ||
      !isInteractiveMode(current.mode) ||
      current.status !== "debating" ||
      !current.debate ||
      (!current.debate.pendingQuestion && current.mode !== "feynman")
    ) {
      return;
    }
    try {
      await ensureLlmReady();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    startLock = true;
    try {
      const debate = current.debate;
      const next: TrainingSession = {
        ...current,
        status: "recording",
        liveTranscript: [],
        finalTranscript: formatDebateTranscript(debate),
        debate: {
          ...debate,
          currentRound: debate.currentRound + 1,
        },
      };
      set({
        current: next,
        report: null,
        comparison: null,
        error: null,
        analyzeNote:
          current.mode === "feynman" && !current.debate.pendingQuestion
            ? `第 ${next.debate?.currentRound ?? 2} 轮讲解 · 继续补充`
            : `第 ${next.debate?.currentRound ?? 2} 轮回应 · 请回应${interactiveQuestionLabel(current.mode)}`,
        streamedQuestion: null,
        streamedReasoning: null,
        level: 0,
        liveSegments: [],
        partialText: "",
        pasteText: "",
        lastWavUrl: null,
        lastAudioPath: null,
        asrStatus: "请求麦克风…",
      });

      const { asrProvider, asrConfig } = await resolveAsrOptions();
      const recordingId = turnRecordingId(
        next.id,
        next.debate?.currentRound ?? 2,
      );
      const recorder = new MicRecorder({
        sessionId: recordingId,
        enableAsr: true,
        asrProvider,
        asrConfig,
        onLevel: (rms) => set({ level: rms }),
        onError: (err) => set({ error: err.message }),
        onAsrEvent: (ev) => applyAsrEvent(get, set, recordingId, ev),
        onStatus: (msg) => set({ asrStatus: msg }),
      });
      await recorder.startLocalOnly();
      activeRecorder = recorder;
      await api.updateSession(next);
      window.setTimeout(() => void recorder.connectBackend(), 50);
    } catch (e) {
      if (activeRecorder) await activeRecorder.discard().catch(() => undefined);
      activeRecorder = null;
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      startLock = false;
    }
  },

  startRetry: async (parentSessionId: string) => {
    if (startLock) return false;
    try {
      await ensureLlmReady();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
    startLock = true;

    try {
      const parent = await withTimeout(
        api.getSession(parentSessionId),
        5_000,
        "加载上一轮",
      );
      if (!parent) throw new Error("未找到上一轮练习");

      const topic =
        parent.report?.nextPractice.retryPrompt ||
        parent.topic ||
        get().draftTopic;
      const targetIssue =
        parent.report?.nextPractice.targetIssue ?? parent.targetIssue;
      const round = (parent.round ?? 1) + 1;
      const mode = normalizePracticeMode(parent.mode);
      const parentFeynman = parent.debate?.feynman;

      const provisional: TrainingSession = {
        id: localId(),
        mode,
        topic,
        goal: parent.goal,
        status: "created",
        startedAt: new Date().toISOString(),
        liveTranscript: [],
        parentSessionId: parent.id,
        round,
        targetIssue,
        ...(isInteractiveMode(mode)
          ? {
              debate: initialDebateState(
                mode,
                mode === "feynman"
                  ? {
                      learnerRole:
                        parentFeynman?.learnerRole ?? get().feynmanLearnerRole,
                      difficulty:
                        parentFeynman?.difficulty ?? get().feynmanDifficulty,
                    }
                  : undefined,
              ),
            }
          : {}),
      };

      revokeLastWavUrl(get().lastWavUrl);
      set({
        current: provisional,
        report: null,
        comparison: null,
        retryParentId: parent.id,
        draftMode: mode,
        draftTopic: topic,
        draftGoal: parent.goal,
        pasteText: "",
        error: null,
        analyzeNote: null,
        streamedQuestion: null,
        streamedReasoning: null,
        level: 0,
        liveSegments: [],
        partialText: "",
        lastWavUrl: null,
        lastAudioPath: null,
        asrStatus: `复练第 ${round} 轮 · 等待开始录音`,
      });

      if (activeRecorder) {
        try {
          await activeRecorder.discard();
        } catch {
          // ignore
        }
        activeRecorder = null;
      }

      await api.updateSession(provisional);
      return true;
    } catch (e) {
      if (activeRecorder) {
        await activeRecorder.discard().catch(() => undefined);
      }
      activeRecorder = null;
      set({
        current: null,
        error: e instanceof Error ? e.message : String(e),
        asrStatus: null,
      });
      return false;
    } finally {
      startLock = false;
    }
  },

  rerecord: async () => {
    if (startLock || get().analyzing) return;
    const current = get().current;
    if (!current || current.status !== "recording") return;

    startLock = true;
    try {
      if (activeRecorder) {
        try {
          await activeRecorder.discard();
        } catch {
          // 丢弃本轮，停止失败不阻断重录
        }
        activeRecorder = null;
      }

      const provisional: TrainingSession = {
        id: localId(),
        mode: current.mode,
        topic: current.topic,
        goal: current.goal,
        status: "recording",
        startedAt: new Date().toISOString(),
        liveTranscript: [],
        round: current.round ?? 1,
        parentSessionId: current.parentSessionId,
        targetIssue: current.targetIssue,
        debate: current.debate,
      };

      revokeLastWavUrl(get().lastWavUrl);
      set({
        current: provisional,
        report: null,
        comparison: null,
        error: null,
        analyzeNote: null,
        level: 0,
        liveSegments: [],
        partialText: "",
        pasteText: "",
        lastWavUrl: null,
        lastAudioPath: null,
        asrStatus: "重新录制 · 请求麦克风…",
      });

      await api.deleteSession(current.id);

      const { asrProvider, asrConfig } = await resolveAsrOptions();
      const recorder = new MicRecorder({
        sessionId: provisional.id,
        enableAsr: true,
        asrProvider,
        asrConfig,
        onLevel: (rms) => set({ level: rms }),
        onError: (err) => set({ error: err.message }),
        onAsrEvent: (ev) => applyAsrEvent(get, set, provisional.id, ev),
        onStatus: (msg) => set({ asrStatus: msg }),
      });

      await recorder.startLocalOnly();
      activeRecorder = recorder;
      await api.updateSession(provisional);
      window.setTimeout(() => {
        void recorder.connectBackend();
      }, 50);
    } catch (e) {
      if (activeRecorder) {
        await activeRecorder.discard().catch(() => undefined);
      }
      activeRecorder = null;
      set({
        current: null,
        asrStatus: null,
        error:
          e instanceof Error
            ? e.message
            : String(e) || "重新录制失败，请检查麦克风权限后重试",
      });
    } finally {
      startLock = false;
    }
  },

  discardRecording: async () => {
    if (startLock || get().analyzing) return;
    const current = get().current;
    if (!current || current.status === "reviewed") return;

    startLock = true;
    try {
      if (activeRecorder) {
        try {
          await activeRecorder.discard();
        } catch {
          // 放弃本轮，停止失败也清状态
        }
        activeRecorder = null;
      }

      await api.deleteSession(current.id);

      revokeLastWavUrl(get().lastWavUrl);
      set({
        current: null,
        report: null,
        comparison: null,
        error: null,
        analyzeNote: null,
        level: 0,
        liveSegments: [],
        partialText: "",
        pasteText: "",
        lastWavUrl: null,
        lastAudioPath: null,
        asrStatus: null,
        // 题目/目标/模式草稿保留；复练上下文清掉（未完成的复练作废）
        retryParentId: null,
      });
    } finally {
      startLock = false;
    }
  },

  stopAndAnalyze: async () => {
    const current = get().current;
    if (!current) return false;
    if (get().analyzing) return false;

    set({ analyzing: true, error: null, analyzeNote: "1/3 停止录音…" });

    let audioPath: string | undefined;
    let audioRecordingId: string | undefined;
    let durationSec: number | undefined;
    let wavUrl: string | null = null;
    let asrTranscript = "";

    try {
      if (activeRecorder?.isRunning) {
        try {
          audioRecordingId = activeRecorder.recordingId;
          const result = await withTimeout(
            activeRecorder.stop(),
            15_000,
            "停止录音",
          );
          audioPath = result.audioPath;
          durationSec = result.durationSec;
          asrTranscript = result.transcript?.trim() ?? "";
          if (result.wavBlob) {
            revokeLastWavUrl(get().lastWavUrl);
            wavUrl = URL.createObjectURL(result.wavBlob);
          }
        } catch (e) {
          activeRecorder = null;
          console.warn("stop recorder failed", e);
          set({
            analyzeNote: `停止录音告警：${e instanceof Error ? e.message : String(e)}，继续分析…`,
          });
        }
        activeRecorder = null;
      }

      set({ analyzeNote: "2/3 整理逐字稿…" });

      const paste = get().pasteText.trim();
      const partialLeft = get().partialText.trim();
      let fromSegments = joinFinalSegments(
        get().liveSegments.filter((s) => s.isFinal),
      );
      // 实时 final 为空但还有 partial：先收成一段
      if (!fromSegments && partialLeft) {
        fromSegments = partialLeft;
      }
      // 实时字幕为空：必须尽量从录音离线转写，否则大模型无法评审
      let pathForOffline =
        audioPath || get().lastAudioPath || undefined;
      if (
        !paste &&
        !fromSegments &&
        !asrTranscript.trim() &&
        audioApi.isTauri()
      ) {
        if (!pathForOffline) {
          try {
            const resolved = await withTimeout(
              audioApi.recordingPath(audioRecordingId ?? current.id),
              3_000,
              "解析录音路径",
            );
            pathForOffline = resolved ?? undefined;
          } catch {
            pathForOffline = undefined;
          }
        }
        if (pathForOffline) {
          try {
            set({ analyzeNote: "2/3 实时无字幕，正在离线转写录音…" });
            const offline = await withTimeout(
              audioApi.transcribeFile(pathForOffline),
              120_000,
              "离线转写",
            );
            if (offline.trim()) {
              asrTranscript = formatOfflineTranscript(offline);
              set({
                liveSegments: [
                  {
                    id: `seg_offline_${Date.now()}`,
                    text: asrTranscript,
                    isFinal: true,
                  },
                ],
                partialText: "",
                asrStatus: "离线转写完成",
                lastAudioPath: pathForOffline,
                error: null,
              });
              fromSegments = asrTranscript;
              audioPath = audioPath ?? pathForOffline;
            } else {
              set({
                analyzeNote: "离线转写结果为空，无法送大模型评审",
              });
            }
          } catch (e) {
            const msg = e instanceof Error ? e.message : String(e);
            console.warn("offline transcribe failed", e);
            set({
              analyzeNote: `离线转写失败：${msg}`,
            });
            // 后面若仍无稿，会用更明确的错误抛出
            if (!get().error) {
              // 不立刻 set error，留给最终汇总
            }
          }
        } else {
          set({
            analyzeNote: "未找到录音文件，且无实时字幕，无法评审",
          });
        }
      }
      const asrFormatted = asrTranscript
        ? formatOfflineTranscript(asrTranscript)
        : "";
      const mergedAsrText =
        fromSegments &&
        asrFormatted &&
        !fromSegments.includes(asrFormatted) &&
        !asrFormatted.includes(fromSegments)
          ? `${fromSegments}\n${asrFormatted}`
          : fromSegments || asrFormatted;
      const finalText = paste || mergedAsrText;
      const liveTranscript =
        get().liveSegments.length > 0
          ? get().liveSegments
          : finalText
            ? [
                {
                  id: `seg_${Date.now()}`,
                  text: finalText,
                  isFinal: true as const,
                },
              ]
            : [];

      const debateBefore = current.debate;
      const isInteractive = isInteractiveMode(current.mode) && Boolean(debateBefore);
      const debateTurnSource = paste ? "paste" : "audio";
      const debateWithUser: DebateState | undefined = isInteractive
        ? {
            ...(debateBefore as DebateState),
            phase: "cross_examination",
            pendingQuestion: undefined,
            turns: [
              ...(debateBefore as DebateState).turns,
              {
                id: `debate_user_${Date.now()}`,
                role: "user",
                round: (debateBefore as DebateState).currentRound,
                text: finalText,
                createdAt: new Date().toISOString(),
                source: debateTurnSource,
                ...(debateTurnSource === "audio" && durationSec
                  ? { durationSec }
                  : {}),
                ...(debateTurnSource === "audio" && audioPath
                  ? { audioFile: audioPath, audioRecordingId }
                  : {}),
              },
            ],
          }
        : undefined;
      const debateUserTurns = debateWithUser?.turns.filter(
        (turn) => turn.role === "user",
      );
      const debateDurationSec =
        debateUserTurns?.length &&
        debateUserTurns.every(
          (turn) =>
            turn.source === "audio" &&
            typeof turn.durationSec === "number" &&
            turn.durationSec > 0,
        )
          ? debateUserTurns.reduce(
              (sum, turn) => sum + (turn.durationSec ?? 0),
              0,
            )
          : undefined;
      const debateInputSource = debateUserTurns?.length
        ? debateUserTurns.every((turn) => turn.source === "audio")
          ? "audio"
          : debateUserTurns.every((turn) => turn.source === "paste")
            ? "paste"
            : "mixed"
        : undefined;
      let sessionForAnalyze: TrainingSession = {
        ...current,
        status: "analyzing",
        liveTranscript,
        finalTranscript: debateWithUser
          ? formatDebateTranscript(debateWithUser)
          : finalText || undefined,
        audioFile: audioPath ?? current.audioFile,
        durationSec: isInteractive
          ? debateDurationSec
          : debateTurnSource === "paste"
            ? undefined
            : durationSec ?? current.durationSec,
        inputSource: isInteractive ? debateInputSource : debateTurnSource,
        endedAt: new Date().toISOString(),
        debate: debateWithUser,
      };

      await api.updateSession(sessionForAnalyze);

      set({
        analyzeNote: finalText
          ? "3/3 大模型评审中…"
          : "3/3 无逐字稿，无法评审…",
        current: sessionForAnalyze,
        report: null,
        comparison: null,
      });

      if (!finalText.trim()) {
        throw new Error(
          pathForOffline
            ? "没有逐字稿：实时识别为空，且从录音离线转写未得到文字。请在复盘页点「从录音重转写并评审」，或回练习页粘贴文本。（与 API Key 无关）"
            : "没有逐字稿，无法进行大模型评审。请确认麦克风与识别，或粘贴文本后再评。（与 API Key 无关）",
        );
      }

      if (debateWithUser) {
        const round = debateWithUser.currentRound;
        const questionLabel = interactiveQuestionLabel(current.mode);
        set({ analyzeNote: `${questionLabel}生成中 · 第 ${round} 轮` });
        try {
          const result = await generateInteractiveQuestion(
            sessionForAnalyze,
            createInteractiveProgressReporter(set),
          );
          const outcome = await handleInteractiveQuestionResult(
            sessionForAnalyze, debateWithUser, result, round, get().streamedReasoning ?? undefined,
          );
          set({
            current: outcome.waiting,
            liveSegments: [],
            partialText: "",
            level: 0,
            analyzing: false,
            analyzeNote: outcome.learnerUnderstood
              ? "小白已理解，你可以继续补充或手动结束"
              : `第 ${round} 轮${questionLabel}已到`,
            error: null,
          });
          return false;
        } catch (e) {
          const msg = e instanceof Error ? e.message : String(e);
          const waiting: TrainingSession = {
            ...sessionForAnalyze,
            status: "debating",
            debate: debateWithUser,
            finalTranscript: formatDebateTranscript(debateWithUser),
            failureReason: msg,
          };
          await api.updateSession(waiting);
          set({
            current: waiting,
            analyzing: false,
            error: msg,
            analyzeNote: `${questionLabel}生成失败，可重试`,
            liveSegments: [],
            partialText: "",
          });
          return false;
        }
      }

      const report = await api.analyze(
        current.id,
        sessionForAnalyze,
        createLlmProgressReporter(set),
      );

      const withReport: TrainingSession = {
        ...sessionForAnalyze,
        status: "reviewed",
        report,
        metrics: (await api.getSession(current.id))?.metrics,
      };

      set({ analyzeNote: "生成复练对比…" });
      let comparison: AttemptComparison | null = null;
      try {
        comparison = await buildComparison(withReport, report);
      } catch (e) {
        console.warn("comparison failed", e);
      }

      if (comparison) {
        withReport.comparison = comparison;
        await api.updateSession(withReport);
      }


      const keepAudio = useSettingsStore.getState().settings.privacy.keepAudio;
      if (!keepAudio) {
        await discardSessionRecordings(withReport);
        revokeLastWavUrl(wavUrl);
        wavUrl = null;
        const withoutAudio = withoutSessionRecordings(withReport);
        withReport.audioFile = withoutAudio.audioFile;
        withReport.debate = withoutAudio.debate;
        audioPath = undefined;
        await api.updateSession(withReport);
      }

      set({
        current: withReport,
        report,
        comparison,
        level: 0,
        lastWavUrl: wavUrl,
        lastAudioPath: audioPath ?? null,
        liveSegments: [],
        partialText: "",
        retryParentId: null,
        analyzeNote: comparison
          ? comparison.conclusive === false
            ? "完成：对比结果暂不确定"
            : comparison.improved
              ? "完成：有进步"
              : "完成：对比已生成"
          : "完成：大模型报告",
        analyzing: false,
        error: null,
      });
      return true;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      // 保留录音/逐字稿素材，但不挂规则报告
      const cur = get().current;
      const keepAudio = useSettingsStore.getState().settings.privacy.keepAudio;
      if (!keepAudio && cur) {
        await discardSessionRecordings(cur);
        revokeLastWavUrl(wavUrl);
        wavUrl = null;
        audioPath = undefined;
      }
      if (cur) {
        const kept: TrainingSession = {
          ...(keepAudio ? cur : withoutSessionRecordings(cur)),
          status: "failed",
          report: undefined,
          failureReason: msg,
          endedAt: cur.endedAt ?? new Date().toISOString(),
        };
        await api.updateSession(kept).catch((persistError) => {
          console.error("persist failed session failed", persistError);
        });
        set({
          current: kept,
          report: null,
          comparison: null,
          error: msg,
          analyzing: false,
          analyzeNote: null,
          level: 0,
          lastWavUrl: wavUrl,
          lastAudioPath: audioPath ?? null,
          liveSegments: [],
          partialText: "",
        });
      } else {
        set({
          error: msg,
          analyzing: false,
          analyzeNote: null,
          level: 0,
          report: null,
        });
      }
      return false;
    }
  },

  requestDebateQuestion: async () => {
    if (get().analyzing) return;
    const current = get().current;
    if (!current?.debate || !isInteractiveMode(current.mode)) return;
    const questionLabel = interactiveQuestionLabel(current.mode);
    try {
      await ensureLlmReady();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    set({
      analyzing: true,
      error: null,
      analyzeNote: `${questionLabel}生成中…`,
    });
    try {
      const result = await generateInteractiveQuestion(
        current,
        createInteractiveProgressReporter(set),
      );
      const outcome = await handleInteractiveQuestionResult(
        current, current.debate, result, current.debate.currentRound, get().streamedReasoning ?? undefined,
      );
      set({
        current: outcome.waiting,
        analyzing: false,
        analyzeNote: outcome.learnerUnderstood
          ? "小白已理解，你可以继续补充或手动结束"
          : `${questionLabel}已到`,
      });
    } catch (e) {
      set({
        analyzing: false,
        error: e instanceof Error ? e.message : String(e),
        analyzeNote: `${questionLabel}生成失败，可重试`,
      });
    }
  },

  submitDebateText: async () => {
    if (get().analyzing) return false;
    const current = get().current;
    const text = get().pasteText.trim();
    if (
      !current?.debate ||
      !isInteractiveMode(current.mode) ||
      current.status !== "debating" ||
      (!current.debate.pendingQuestion && current.mode !== "feynman")
    ) {
      set({
        error: `当前没有等待回应的${interactiveQuestionLabel(current?.mode ?? "debate")}`,
      });
      return false;
    }
    if (!text) {
      set({
        error:
          current.mode === "feynman" ? "请先粘贴本轮讲解" : "请先粘贴本轮回应",
      });
      return false;
    }

    const questionLabel = interactiveQuestionLabel(current.mode);
    try {
      await ensureLlmReady();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return false;
    }
    set({
      analyzing: true,
      error: null,
      analyzeNote: "正在提交本轮文字回应…",
    });
    const round = current.debate.currentRound + 1;
    const debateWithUser: DebateState = {
      ...current.debate,
      currentRound: round,
      pendingQuestion: undefined,
      turns: [
        ...current.debate.turns,
        {
          id: `debate_user_${Date.now()}`,
          role: "user",
          round,
          text,
          createdAt: new Date().toISOString(),
          source: "paste",
        },
      ],
    };
    const updated: TrainingSession = {
      ...current,
      status: "analyzing",
      debate: debateWithUser,
      finalTranscript: formatDebateTranscript(debateWithUser),
      durationSec: undefined,
      inputSource:
        current.inputSource === "audio" || current.inputSource === "mixed"
          ? "mixed"
          : "paste",
      liveTranscript: [
        {
          id: `seg_paste_${Date.now()}`,
          text,
          isFinal: true,
        },
      ],
      failureReason: undefined,
    };

    try {
      await api.updateSession(updated);
      set({ current: updated, analyzeNote: `${questionLabel}生成中 · 第 ${round} 轮` });
      const result = await generateInteractiveQuestion(
        updated,
        createInteractiveProgressReporter(set),
      );
      const outcome = await handleInteractiveQuestionResult(
        updated, debateWithUser, result, round, get().streamedReasoning ?? undefined,
      );
      set({
        current: outcome.waiting,
        pasteText: "",
        analyzing: false,
        analyzeNote: outcome.learnerUnderstood
          ? "小白已理解，你可以继续补充或手动结束"
          : `第 ${round} 轮${questionLabel}已到`,
        error: null,
      });
      return false;
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const waiting: TrainingSession = {
        ...updated,
        status: "debating",
        failureReason: msg,
      };
      await api.updateSession(waiting).catch(() => undefined);
      set({
        current: waiting,
        pasteText: "",
        analyzing: false,
        error: msg,
        analyzeNote: "本轮提交失败，内容已保留",
      });
      return false;
    }
  },

  finishInteractiveSession: async () => {
    if (get().analyzing) return;
    const current = get().current;
    if (!current?.debate || !isInteractiveMode(current.mode)) return;
    try {
      await ensureLlmReady();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    const feynmanMode = current.mode === "feynman";
    // 立即收起待答问题，避免生成复盘期间界面停留在“小白正在追问”的旧状态
    const settled: TrainingSession =
      current.debate.pendingQuestion || get().streamedQuestion
        ? {
            ...current,
            debate: { ...current.debate, pendingQuestion: undefined },
          }
        : current;
    set({
      current: settled,
      analyzing: true,
      error: null,
      analyzeNote: feynmanMode
        ? "讲解结束，正在生成复盘…"
        : "辩论结束，正在生成总复盘…",
    });
    try {
      const completed = await completeInteractiveSession(current, set);
      set({
        current: completed.session,
        report: completed.report,
        comparison: null,
        analyzing: false,
        analyzeNote: feynmanMode ? "完成：费曼学习复盘" : "完成：辩论总复盘",
        error: null,
      });
    } catch (e) {
      set({
        analyzing: false,
        error: e instanceof Error ? e.message : String(e),
        analyzeNote: feynmanMode ? "费曼学习复盘生成失败" : "总复盘生成失败",
      });
    }
  },

  analyzePaste: async () => {
    if (get().analyzing) return;
    try {
      await ensureLlmReady();
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
      return;
    }
    set({
      analyzing: true,
      error: null,
      analyzeNote: "分析粘贴文本…",
      liveSegments: [],
      partialText: "",
      level: 0,
    });
    let pastedSession: TrainingSession | null = null;
    try {
      const text = get().pasteText.trim();
      if (!text) throw new Error("请先粘贴逐字稿");
      const pendingRetry = get().current;
      const shouldResumeRetry =
        pendingRetry?.status === "created" && Boolean(pendingRetry.parentSessionId);
      const input: CreateSessionInput = {
        mode: normalizePracticeMode(get().draftMode),
        topic: get().draftTopic,
        goal: get().draftGoal,
      };
      const session = shouldResumeRetry
        ? pendingRetry
        : await withTimeout(api.createSession(input), 5_000, "创建 session");
      await api.injectPasteTranscript(session.id, text);
      let stopped = await api.stopRecording(session.id, {
        finalTranscript: text,
        durationSec: null,
      });
      pastedSession = stopped;
      set({ current: stopped });
      if (isInteractiveMode(session.mode)) {
        const questionLabel = interactiveQuestionLabel(session.mode);
        const debate: DebateState = {
          ...(session.debate ??
            initialDebateState(
              session.mode,
              session.mode === "feynman"
                ? {
                    learnerRole: get().feynmanLearnerRole,
                    difficulty: get().feynmanDifficulty,
                  }
                : undefined,
            )),
          phase: "cross_examination",
          turns: [
            {
              id: `debate_user_${Date.now()}`,
              role: "user",
              round: 1,
              text,
              createdAt: new Date().toISOString(),
              source: "paste",
            },
          ],
        };
        stopped = {
          ...stopped,
          status: "analyzing",
          debate,
          finalTranscript: formatDebateTranscript(debate),
          inputSource: "paste",
        };
        await api.updateSession(stopped);
        set({
          current: stopped,
          analyzeNote: `${questionLabel}生成中…`,
          streamedQuestion: null,
        });
        const result = await generateInteractiveQuestion(
          stopped,
          createInteractiveProgressReporter(set),
        );
        const outcome = await handleInteractiveQuestionResult(
          stopped, debate, result, 1, get().streamedReasoning ?? undefined,
        );
        set({
          current: outcome.waiting,
          analyzing: false,
          analyzeNote: outcome.learnerUnderstood
            ? "小白已理解，你可以继续补充或手动结束"
            : `第 1 轮${questionLabel}已到`,
          pasteText: "",
          error: null,
        });
        return;
      }
      set({ analyzeNote: "大模型评审中…" });
      const report = await api.analyze(
        session.id,
        stopped,
        createLlmProgressReporter(set),
      );
      set({
        current: { ...stopped, status: "reviewed", report },
        report,
        comparison: null,
        analyzeNote: "完成：大模型报告",
        error: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (pastedSession) {
        const failed: TrainingSession = {
          ...pastedSession,
          status: "failed",
          report: undefined,
          failureReason: msg,
          endedAt: pastedSession.endedAt ?? new Date().toISOString(),
        };
        await api.updateSession(failed).catch((persistError) => {
          console.error("persist pasted analysis failure failed", persistError);
        });
        set({ current: failed });
      }
      set({
        error: msg,
        report: null,
      });
    } finally {
      set({ analyzing: false });
    }
  },

  reanalyzeSession: async (opts) => {
    if (get().analyzing) return;
    const current = get().current;
    if (!current) {
      set({ error: "没有可评审的练习记录" });
      return;
    }

    set({ analyzing: true, error: null, analyzeNote: "准备重新评审…" });

    try {
      let text = current.finalTranscript?.trim() ?? "";
      let audioPath =
        get().lastAudioPath ?? current.audioFile ?? null;

      if ((!audioPath || !audioPath.trim()) && audioApi.isTauri()) {
        try {
          audioPath = await withTimeout(
            audioApi.recordingPath(current.id),
            3_000,
            "解析录音路径",
          );
        } catch {
          // ignore
        }
      }
      if (audioPath) {
        set({ lastAudioPath: audioPath });
      }

      const forceRetranscribe = opts?.retranscribe === true;
      const needTranscript = !text;
      const canTranscribe = Boolean(audioPath) && audioApi.isTauri();

      if ((forceRetranscribe || needTranscript) && canTranscribe && audioPath) {
        set({
          analyzeNote: forceRetranscribe
            ? "从录音重新转写…"
            : "无逐字稿，从录音转写…",
        });
        const offline = await withTimeout(
          audioApi.transcribeFile(audioPath),
          90_000,
          "离线转写",
        );
        text = formatOfflineTranscript(offline);
        if (!text) {
          throw new Error("转写结果为空，请检查录音内容或改用粘贴文本");
        }
      }

      if (!text) {
        throw new Error(
          audioPath
            ? "没有可用逐字稿。可点「从录音重转写并评审」，或回练习页粘贴文本。"
            : "没有录音也没有逐字稿，无法重新评审。",
        );
      }

      set({ analyzeNote: "大模型重新评审中…" });

      const liveTranscript =
        current.liveTranscript?.length && !forceRetranscribe && !needTranscript
          ? current.liveTranscript
          : [
              {
                id: `seg_re_${Date.now()}`,
                text,
                isFinal: true as const,
              },
            ];
      const inputSource =
        current.inputSource ?? (audioPath ? "audio" : "paste");

      const sessionForAnalyze: TrainingSession = {
        ...current,
        status: "analyzing",
        finalTranscript: text,
        liveTranscript,
        audioFile: audioPath ?? current.audioFile,
        inputSource,
        durationSec:
          inputSource === "paste" || inputSource === "mixed"
            ? undefined
            : current.durationSec,
        report: undefined,
      };

      await api.updateSession(sessionForAnalyze);

      const report = await api.analyze(
        current.id,
        sessionForAnalyze,
        createLlmProgressReporter(set),
      );

      const fresh = await api.getSession(current.id);
      const withReport: TrainingSession = {
        ...sessionForAnalyze,
        status: "reviewed",
        report,
        metrics: fresh?.metrics ?? sessionForAnalyze.metrics,
      };

      set({ analyzeNote: "更新复练对比…" });
      let comparison: AttemptComparison | null = null;
      try {
        comparison = await buildComparison(withReport, report);
      } catch (e) {
        console.warn("comparison failed", e);
      }
      if (comparison) {
        withReport.comparison = comparison;
      }
      await api.updateSession(withReport);

      set({
        current: withReport,
        report,
        comparison,
        analyzeNote: "重新评审完成（大模型）",
        analyzing: false,
        error: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const cur = get().current;
      if (cur) {
        const failed: TrainingSession = {
          ...cur,
          report: undefined,
          status: "failed",
          failureReason: msg,
        };
        await api.updateSession(failed).catch((persistError) => {
          console.error("persist reanalysis failure failed", persistError);
        });
        set({
          current: failed,
          report: null,
          comparison: null,
          error: msg,
          analyzing: false,
          analyzeNote: null,
        });
      } else {
        set({
          error: msg,
          analyzing: false,
          analyzeNote: null,
          report: null,
        });
      }
    }
  },

  loadSession: async (id: string) => {
    set({ analyzing: true, error: null });
    try {
      const session = await withTimeout(api.getSession(id), 5_000, "加载记录");
      let lastAudioPath: string | null = session?.audioFile ?? null;
      if (session && !lastAudioPath && audioApi.isTauri()) {
        try {
          const resolved = await audioApi.recordingPath(session.id);
          if (resolved) lastAudioPath = resolved;
        } catch {
          // keep audioFile
        }
      }
      set({
        current: session,
        report: session?.report ?? null,
        comparison: session?.comparison ?? null,
        ...(session
          ? {
              draftMode: normalizePracticeMode(session.mode),
              draftTopic: session.topic,
              draftGoal: session.goal,
              liveSegments: session.status === "recording" ? session.liveTranscript : [],
              partialText: "",
            }
          : {}),
        lastAudioPath,
        error: session?.failureReason ?? null,
      });
    } catch (e) {
      set({ error: e instanceof Error ? e.message : String(e) });
    } finally {
      set({ analyzing: false });
    }
  },
  };
});
