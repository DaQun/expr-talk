import type { ASRConfig, TestResult } from "@showtalk/shared";
import type { StreamingASRProvider, StreamingASRSession } from "../../types";

/**
 * 本地 Sherpa-ONNX 流式 ASR。
 * 真实推理在 Tauri Rust 侧（官方 sherpa-onnx OnlineRecognizer），
 * 前端通过 audio_* IPC + asr-event 交互。
 */
export const localSherpaProvider: StreamingASRProvider = {
  id: "local-sherpa",
  name: "Local Sherpa-ONNX Streaming Zipformer",
  local: true,
  capabilities: {
    streaming: true,
    batch: false,
    wordTimestamps: false,
    speakerDiarization: false,
    punctuation: false,
  },
  info() {
    return {
      id: this.id,
      name: this.name,
      local: this.local,
      capabilities: this.capabilities,
    };
  },
  async testConnection(_config: ASRConfig): Promise<TestResult> {
    return {
      ok: false,
      message:
        "本地模型默认不随安装附带。请在设置页点击「下载本地模型」，或运行 scripts/download-asr-model.sh",
    };
  },
  async start(_config: ASRConfig): Promise<StreamingASRSession> {
    throw new Error("请使用桌面端 MicRecorder + audio_* IPC，而非直接调用 JS Provider");
  },
};
