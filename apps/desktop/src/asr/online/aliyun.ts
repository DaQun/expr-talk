import type { AsrEventPayload } from "@/ipc/audio";
import {
  fieldStr,
  type OnlineAsrClient,
  type OnlineAsrConfig,
} from "./types";

/**
 * 百炼实时 ASR：浏览器 WebSocket 无法带 Authorization，
 * 实际识别走 Tauri Rust 通道。此客户端仅作「配置校验 + 明确报错」占位，
 * 正常路径不会调用 start（由 audio_start 的 provider 路由到 Rust）。
 */
export function createAliyunBailianClient(
  config: OnlineAsrConfig,
): OnlineAsrClient {
  const apiKey = fieldStr(config.fields, "apiKey");
  return {
    async start() {
      if (!apiKey) throw new Error("请填写百炼 API Key");
      config.onEvent?.({
        sessionId: config.sessionId,
        type: "ready",
        segmentId: "",
        text: "",
        isFinal: false,
        message: "百炼实时识别由桌面端原生通道处理",
      } satisfies AsrEventPayload);
    },
    feedPcm() {},
    async stop() {},
  };
}
