import type { ASRConfig, TestResult } from "@showtalk/shared";
import type { StreamingASRProvider, StreamingASRSession } from "../../types";

/** 阿里云百炼 / DashScope 实时 ASR（paraformer-realtime） */
export const aliyunBailianProvider: StreamingASRProvider = {
  id: "aliyun-bailian",
  name: "阿里云百炼（DashScope 实时）",
  local: false,
  capabilities: {
    streaming: true,
    batch: false,
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
    if (!config.apiKey?.trim()) {
      return { ok: false, message: "缺少百炼 API Key（DASHSCOPE_API_KEY）" };
    }
    return {
      ok: true,
      message: `将使用模型 ${config.model || "paraformer-realtime-v2"} 做实时识别`,
    };
  },
  async start(_config: ASRConfig): Promise<StreamingASRSession> {
    throw new Error("请在桌面端通过 OnlineAsr 客户端启动百炼实时识别");
  },
};
