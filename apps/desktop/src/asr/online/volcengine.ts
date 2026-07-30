/**
 * 火山引擎流式 ASR 在 Rust 完成（首包鉴权）。
 * 前端占位：配置校验。
 */
import { fieldStr, type OnlineAsrClient, type OnlineAsrConfig } from "./types";

export function createVolcengineAsrClient(
  config: OnlineAsrConfig,
): OnlineAsrClient {
  return {
    async start() {
      const appId = fieldStr(config.fields, "appId");
      const token = fieldStr(config.fields, "accessToken", "apiKey");
      if (!appId || !token) {
        throw new Error("火山引擎需要 AppId 与 Access Token");
      }
      config.onEvent?.({
        sessionId: config.sessionId,
        type: "ready",
        segmentId: "",
        text: "",
        isFinal: false,
        message: "火山引擎实时识别由桌面端原生通道处理",
      });
    },
    feedPcm() {},
    async stop() {},
  };
}
