import type { ASRConfig, TestResult } from "@showtalk/shared";
import type { StreamingASRProvider, StreamingASRSession } from "../../types";

/** 腾讯云实时语音识别 */
export const tencentAsrProvider: StreamingASRProvider = {
  id: "tencent-asr",
  name: "腾讯云实时语音识别",
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
    const secretId = String(config.apiKey || extra.secretId || "").trim();
    const secretKey = String(extra.secretKey || "").trim();
    const appId = String(extra.appId || "").trim();
    if (!secretId || !secretKey || !appId) {
      return {
        ok: false,
        message: "需要 SecretId、SecretKey、AppId（在设置里填写）",
      };
    }
    return {
      ok: true,
      message: `腾讯云 ASR 凭证已填写（引擎 ${String(extra.engineModelType || "16k_zh")}）`,
    };
  },
  async start(_config: ASRConfig): Promise<StreamingASRSession> {
    throw new Error("请在桌面端通过 OnlineAsr 客户端启动腾讯云实时识别");
  },
};
