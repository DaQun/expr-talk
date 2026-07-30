export type ASRConfig = {
  providerId: string;
  language?: string;
  modelPath?: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  extra?: Record<string, unknown>;
};

export type ASRProviderCapabilities = {
  streaming: boolean;
  batch: boolean;
  wordTimestamps: boolean;
  speakerDiarization: boolean;
  punctuation: boolean;
};

export type TestResult = {
  ok: boolean;
  latencyMs?: number;
  message?: string;
};

export type ASRProviderInfo = {
  id: string;
  name: string;
  capabilities: ASRProviderCapabilities;
  local: boolean;
};

export type Transcript = {
  text: string;
  segments?: Array<{
    startMs?: number;
    endMs?: number;
    text: string;
    confidence?: number;
  }>;
  language?: string;
};

export type StreamingASREvent =
  | { type: "partial"; text: string; segmentId: string }
  | { type: "final"; text: string; segmentId: string; startMs?: number; endMs?: number }
  | { type: "error"; message: string }
  | { type: "ended" };
