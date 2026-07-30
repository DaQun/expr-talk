import type {
  ASRConfig,
  ASRProviderCapabilities,
  ASRProviderInfo,
  StreamingASREvent,
  TestResult,
  Transcript,
} from "@expr-talk/shared";

export type AudioFile = {
  path: string;
  mimeType?: string;
  durationSec?: number;
};

export type StreamingASRSession = {
  /** 推入 16kHz int16 PCM 帧 */
  pushPcm(frame: Int16Array): void;
  end(): Promise<void>;
  onEvent(handler: (event: StreamingASREvent) => void): () => void;
};

export interface ASRProvider {
  id: string;
  name: string;
  local: boolean;
  capabilities: ASRProviderCapabilities;
  testConnection(config: ASRConfig): Promise<TestResult>;
  info(): ASRProviderInfo;
}

export interface StreamingASRProvider extends ASRProvider {
  start(config: ASRConfig): Promise<StreamingASRSession>;
}

export interface BatchASRProvider extends ASRProvider {
  transcribe(file: AudioFile, config: ASRConfig): Promise<Transcript>;
}
