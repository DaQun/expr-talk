import { createAliyunBailianClient } from "./aliyun";
import { createTencentAsrClient } from "./tencent";
import { createVolcengineAsrClient } from "./volcengine";
import type { OnlineAsrClient, OnlineAsrConfig } from "./types";

export type { OnlineAsrClient, OnlineAsrConfig } from "./types";

export const ONLINE_STREAMING_ASR_IDS = [
  "aliyun-bailian",
  "tencent-asr",
  "volcengine-asr",
] as const;

export type OnlineStreamingAsrId = (typeof ONLINE_STREAMING_ASR_IDS)[number];

export function isOnlineStreamingAsrId(id: string): id is OnlineStreamingAsrId {
  return (ONLINE_STREAMING_ASR_IDS as readonly string[]).includes(id);
}

export function createOnlineAsrClient(
  config: OnlineAsrConfig,
): OnlineAsrClient {
  switch (config.providerId) {
    case "aliyun-bailian":
      return createAliyunBailianClient(config);
    case "tencent-asr":
      return createTencentAsrClient(config);
    case "volcengine-asr":
      return createVolcengineAsrClient(config);
    default:
      throw new Error(`不支持的在线 ASR: ${config.providerId}`);
  }
}
