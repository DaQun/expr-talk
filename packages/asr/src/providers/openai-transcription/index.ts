import type { ASRConfig, TestResult, Transcript } from "@expr-talk/shared";
import type { AudioFile, BatchASRProvider } from "../../types";

/**
 * OpenAI compatible transcription 占位。
 * POST /v1/audio/transcriptions
 */
export const openaiTranscriptionProvider: BatchASRProvider = {
  id: "openai-transcription",
  name: "OpenAI Compatible Transcription",
  local: false,
  capabilities: {
    streaming: false,
    batch: true,
    wordTimestamps: true,
    speakerDiarization: false,
    punctuation: true,
  },
  info() {
    return {
      id: this.id,
      name: this.name,
      local: this.local,
      capabilities: this.capabilities,
    };
  },
  async testConnection(config: ASRConfig): Promise<TestResult> {
    if (!config.baseUrl) {
      return { ok: false, message: "缺少 baseUrl" };
    }
    if (!config.apiKey) {
      return { ok: false, message: "缺少 apiKey" };
    }
    return {
      ok: false,
      message: "在线 transcription 调用尚未实现（Milestone 2）。",
    };
  },
  async transcribe(_file: AudioFile, _config: ASRConfig): Promise<Transcript> {
    throw new Error("openai-transcription 尚未实现");
  },
};
