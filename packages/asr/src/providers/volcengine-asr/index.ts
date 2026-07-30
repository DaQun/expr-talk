import type { ASRConfig, TestResult } from "@expr-talk/shared";
import type { StreamingASRProvider, StreamingASRSession } from "../../types";

/** 火山引擎（字节）流式语音识别 */
export const volcengineAsrProvider: StreamingASRProvider = {
  id: "volcengine-asr",
  name: "火山引擎流式语音识别",
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
    const extra = config.extra ?? {};
    const appId = String(extra.appId || "").trim();
    const token = String(config.apiKey || extra.accessToken || "").trim();
    const cluster = String(extra.cluster || "").trim();
    if (!appId || !token) {
      return {
        ok: false,
        message: "需要 AppId 与 Access Token（火山控制台获取）",
      };
    }
    return {
      ok: true,
      message: `火山引擎凭证已填写（cluster: ${cluster || "默认"}）`,
    };
  },
  async start(_config: ASRConfig): Promise<StreamingASRSession> {
    throw new Error("请在桌面端通过 OnlineAsr 客户端启动火山引擎实时识别");
  },
};
