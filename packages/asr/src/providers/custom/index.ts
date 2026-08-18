import type { ASRConfig, TestResult, Transcript } from "@showtalk/shared";
import type { AudioFile, BatchASRProvider } from "../../types";

/** 自定义 OpenAI compatible 端点占位 */
export const customOpenAITranscriptionProvider: BatchASRProvider = {
  id: "custom-openai-transcription",
  name: "Custom OpenAI Compatible ASR",
  local: false,
  capabilities: {
    streaming: false,
    batch: true,
    wordTimestamps: false,
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
    if (!config.baseUrl) return { ok: false, message: "缺少 baseUrl" };
    return { ok: false, message: "自定义 ASR 尚未实现" };
  },
  async transcribe(_file: AudioFile, _config: ASRConfig): Promise<Transcript> {
    throw new Error("custom-openai-transcription 尚未实现");
  },
};
