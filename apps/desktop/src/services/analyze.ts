import {
  DEFAULT_MODE_RUBRICS,
  normalizePracticeMode,
  type AppSettings,
  type SessionMetrics,
  type StructuredReport,
  type DebateState,
  type TrainingSession,
} from "@expr-talk/shared";
import {
  computeSessionMetrics,
  segmentsToUtterances,
} from "@expr-talk/core";
import {
  generateDebateTurn,
  generateFeynmanTurn,
  getLLMProvider,
  type LLMStreamProgress,
} from "@expr-talk/llm";
import { resolveLlmConfig } from "./llmReadiness";
import { selectAnalysisText } from "./analysisText";

export type AnalyzeResult = {
  metrics: SessionMetrics;
  report: StructuredReport;
  usedLlm: true;
};

export async function generateDebateQuestion(
  session: TrainingSession,
  debate: DebateState,
  settings: AppSettings,
  onProgress?: (progress: LLMStreamProgress) => void,
) {
  const ready = resolveLlmConfig(settings);
  if (!ready.ok) throw new LlmReviewError("not_configured", ready.reason);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    onProgress?.({ phase: "connecting", receivedChars: 0 });
    return await generateDebateTurn(debate, session.topic, ready.config, {
      signal: controller.signal,
      onProgress,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LlmReviewError(
        "llm_failed",
        "反方质询等待超过 2 分钟，已停止本次请求。",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

export async function generateFeynmanQuestion(
  session: TrainingSession,
  state: DebateState,
  settings: AppSettings,
  onProgress?: (progress: LLMStreamProgress) => void,
) {
  const ready = resolveLlmConfig(settings);
  if (!ready.ok) throw new LlmReviewError("not_configured", ready.reason);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);
  try {
    onProgress?.({ phase: "connecting", receivedChars: 0 });
    return await generateFeynmanTurn(state, session.topic, ready.config, {
      signal: controller.signal,
      onProgress,
    });
  } catch (error) {
    if (controller.signal.aborted) {
      throw new LlmReviewError(
        "llm_failed",
        "小白理解判断等待超过 2 分钟，已停止本次请求。",
      );
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

/** 未配置 / 不可用大模型，或评审失败（不再降级规则报告） */
export class LlmReviewError extends Error {
  readonly code: "not_configured" | "no_transcript" | "llm_failed";

  constructor(
    code: LlmReviewError["code"],
    message: string,
  ) {
    super(message);
    this.name = "LlmReviewError";
    this.code = code;
  }
}

const LLM_TIMEOUT_MS = 120_000;

function yieldUi(): Promise<void> {
  return new Promise((r) => {
    if (typeof requestAnimationFrame === "function") {
      requestAnimationFrame(() => r());
    } else {
      setTimeout(r, 0);
    }
  });
}

function computeMetrics(session: TrainingSession): {
  text: string;
  metrics: SessionMetrics;
  coverage: ReturnType<typeof selectAnalysisText>["coverage"];
} {
  const fullText = session.finalTranscript ?? "";
  const debateUserTurns = session.debate?.turns.filter(
    (turn) => turn.role === "user" && turn.text.trim(),
  );
  const metricsText = debateUserTurns?.length
    ? debateUserTurns.map((turn) => turn.text).join("\n")
    : fullText;
  const selected = selectAnalysisText(fullText);

  const finalSegs = session.debate
    ? (debateUserTurns ?? []).map((turn) => ({
        id: turn.id,
        text: turn.text,
        isFinal: true as const,
      }))
    : (session.liveTranscript ?? []).filter((s) => s.isFinal);
  const segments =
    finalSegs.length > 0
      ? finalSegs
      : metricsText
        ? [{ id: "seg_all", text: metricsText, isFinal: true as const }]
        : [];

  const utterances = segmentsToUtterances(session.id, segments);
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
  const metrics = computeSessionMetrics({
    text: metricsText,
    durationSec: session.debate
      ? debateDurationSec
      : session.inputSource === "paste" || session.inputSource === "mixed"
        ? undefined
        : session.durationSec,
    segments,
    utteranceCount: Math.max(1, utterances.length || 1),
  });

  return { text: selected.text, metrics, coverage: selected.coverage };
}

/**
 * 复盘报告：仅大模型。
 * 本地只算 metrics 作为 LLM 输入；不生成规则报告。
 * 未配置 / 调用失败时抛 LlmReviewError。
 */
export async function analyzeSession(
  session: TrainingSession,
  settings: AppSettings,
  onProgress?: (progress: LLMStreamProgress) => void,
): Promise<AnalyzeResult> {
  await yieldUi();
  const { text, metrics, coverage } = computeMetrics(session);

  if (!text.trim()) {
    throw new LlmReviewError(
      "no_transcript",
      "没有逐字稿，无法进行大模型评审。请先完成语音识别、从录音重转写，或粘贴文本。（不是 API Key 的问题）",
    );
  }

  const ready = resolveLlmConfig(settings);
  if (!ready.ok) {
    throw new LlmReviewError("not_configured", ready.reason);
  }

  const provider = getLLMProvider(ready.config.providerId);
  if (!provider) {
    throw new LlmReviewError(
      "not_configured",
      `未知大模型 Provider：${ready.config.providerId}`,
    );
  }

  const mode = normalizePracticeMode(session.mode);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), LLM_TIMEOUT_MS);

  try {
    await yieldUi();
    onProgress?.({ phase: "connecting", receivedChars: 0 });
    const llmReport = await provider.finalReport(
      {
        mode,
        topic: session.topic,
        goal: session.goal,
        transcript: text,
        metrics,
        rubric: DEFAULT_MODE_RUBRICS[mode],
      },
      ready.config,
      { signal: controller.signal, onProgress },
    );

    return {
      metrics,
      report: {
        ...llmReport,
        source: "llm",
        analysisCoverage: coverage,
      },
      usedLlm: true,
    };
  } catch (e) {
    if (e instanceof LlmReviewError) throw e;
    if (controller.signal.aborted) {
      throw new LlmReviewError(
        "llm_failed",
        "大模型评审等待超过 2 分钟，已停止本次请求。未生成复盘报告，可稍后重试。",
      );
    }
    const msg = e instanceof Error ? e.message : String(e);
    throw new LlmReviewError(
      "llm_failed",
      `大模型评审失败：${msg.slice(0, 200)}。未生成复盘报告。`,
    );
  } finally {
    clearTimeout(timeout);
  }
}

/** @deprecated 评审已强制 LLM；仅保留 metrics 计算兼容旧调用 */
export async function analyzeSessionRulesOnly(
  session: TrainingSession,
): Promise<{ metrics: SessionMetrics; usedLlm: false }> {
  await yieldUi();
  const { metrics } = computeMetrics(session);
  return { metrics, usedLlm: false };
}
