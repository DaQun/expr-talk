import type { ASRProviderInfo } from "@showtalk/shared";
import type { ASRProvider } from "../types";
import { localSherpaProvider } from "./local-sherpa";
import { aliyunBailianProvider } from "./aliyun-bailian";
import { tencentAsrProvider } from "./tencent-asr";
import { volcengineAsrProvider } from "./volcengine-asr";
import { openaiTranscriptionProvider } from "./openai-transcription";
import { customOpenAITranscriptionProvider } from "./custom";

const providers: ASRProvider[] = [
  localSherpaProvider,
  aliyunBailianProvider,
  tencentAsrProvider,
  volcengineAsrProvider,
  openaiTranscriptionProvider,
  customOpenAITranscriptionProvider,
];

const LISTED_ASR_IDS = new Set([
  "local-sherpa",
  "aliyun-bailian",
  "tencent-asr",
  "volcengine-asr",
]);

export function listASRProviders(): ASRProviderInfo[] {
  return providers.filter((p) => LISTED_ASR_IDS.has(p.id)).map((p) => p.info());
}

export function getASRProvider(id: string): ASRProvider | undefined {
  return providers.find((p) => p.id === id);
}

export function isLocalAsrProvider(id: string): boolean {
  return getASRProvider(id)?.local === true;
}

export function isOnlineStreamingAsr(id: string): boolean {
  const p = getASRProvider(id);
  return Boolean(p && !p.local && p.capabilities.streaming);
}
