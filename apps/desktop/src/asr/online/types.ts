import type { AsrEventPayload } from "@/ipc/audio";

export type OnlineAsrConfig = {
  providerId: string;
  /** 扁平化后的 provider 配置 */
  fields: Record<string, unknown>;
  sessionId: string;
  sampleRate?: number;
  onEvent?: (event: AsrEventPayload) => void;
};

export type OnlineAsrClient = {
  start(): Promise<void>;
  /** 16k mono int16 PCM */
  feedPcm(pcm: Int16Array): void;
  stop(): Promise<void>;
};

export function fieldStr(
  fields: Record<string, unknown>,
  ...keys: string[]
): string {
  for (const k of keys) {
    const v = fields[k];
    if (typeof v === "string" && v.trim()) return v.trim();
    if (typeof v === "number") return String(v);
  }
  return "";
}

export function uuid(): string {
  if (typeof crypto !== "undefined" && "randomUUID" in crypto) {
    return crypto.randomUUID();
  }
  return `t_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}
