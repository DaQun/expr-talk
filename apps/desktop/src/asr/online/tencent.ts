/**
 * 腾讯云实时 ASR 鉴权与握手在 Rust 完成（签名 URL）。
 * 前端占位：配置校验。
 */
import { fieldStr, type OnlineAsrClient, type OnlineAsrConfig } from "./types";

export function createTencentAsrClient(config: OnlineAsrConfig): OnlineAsrClient {
  return {
    async start() {
      const secretId = fieldStr(config.fields, "secretId", "apiKey");
      const secretKey = fieldStr(config.fields, "secretKey");
      const appId = fieldStr(config.fields, "appId");
      if (!secretId || !secretKey || !appId) {
        throw new Error("腾讯云需要 SecretId、SecretKey、AppId");
      }
      config.onEvent?.({
        sessionId: config.sessionId,
        type: "ready",
        segmentId: "",
        text: "",
        isFinal: false,
        message: "腾讯云实时识别由桌面端原生通道处理",
      });
    },
    feedPcm() {},
    async stop() {},
  };
}
