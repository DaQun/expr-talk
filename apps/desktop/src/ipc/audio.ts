import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

export type AudioStartResult = {
  sessionId: string;
  audioPath: string;
  sampleRate: number;
  asrEnabled: boolean;
  asrMessage: string;
};

export type AudioStopResult = {
  sessionId: string;
  audioPath: string;
  sampleCount: number;
  durationSec: number;
  sampleRate: number;
  transcript: string;
};

export type AsrEventPayload = {
  sessionId: string;
  type: "partial" | "final" | "ready" | "error" | string;
  segmentId: string;
  text: string;
  isFinal: boolean;
  message?: string | null;
};

export type AsrModelStatus = {
  ready: boolean;
  modelDir?: string | null;
  missing: string[];
  hint: string;
  /** 已下载核心文件字节数 */
  sizeBytes?: number | null;
  /** 如 "268 MB" */
  sizeLabel?: string | null;
  /** 解压后预估 */
  expectedSizeBytes?: number;
  expectedSizeLabel?: string;
  /** 压缩包预估（下载流量） */
  expectedArchiveBytes?: number;
  expectedArchiveLabel?: string;
};

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

export const audioApi = {
  isTauri,

  async start(
    sessionId: string,
    sampleRate = 16_000,
    enableAsr = true,
    asrProvider = "local-sherpa",
    asrConfig: Record<string, unknown> = {},
  ): Promise<AudioStartResult> {
    return invoke<AudioStartResult>("audio_start", {
      sessionId,
      sampleRate,
      enableAsr,
      asrProvider,
      asrConfig,
    });
  },

  async downloadModel(): Promise<AsrModelStatus> {
    return invoke<AsrModelStatus>("asr_download_model");
  },

  /** @deprecated 用 appendPcmBytes，避免大 number[] 分配 */
  async appendPcm(sessionId: string, pcm: number[]): Promise<void> {
    const buf = new ArrayBuffer(pcm.length * 2);
    const view = new DataView(buf);
    for (let i = 0; i < pcm.length; i++) {
      view.setInt16(i * 2, pcm[i], true);
    }
    await invoke("audio_append_pcm_bytes", {
      sessionId,
      pcm: Array.from(new Uint8Array(buf)),
    });
  },

  async appendPcmBytes(sessionId: string, pcm: Uint8Array): Promise<void> {
    // Tauri 可接受 number[]；分块拷贝仍比 Int16->number 轻
    await invoke("audio_append_pcm_bytes", {
      sessionId,
      pcm: Array.from(pcm),
    });
  },

  async stop(sessionId: string): Promise<AudioStopResult> {
    return invoke<AudioStopResult>("audio_stop", { sessionId });
  },

  async discard(sessionId: string): Promise<void> {
    if (!isTauri()) return;
    await invoke("audio_discard", { sessionId });
  },

  async modelStatus(): Promise<AsrModelStatus | null> {
    if (!isTauri()) return null;
    try {
      return await invoke<AsrModelStatus>("asr_model_status");
    } catch {
      return null;
    }
  },

  /** 对已落盘 WAV 离线转写；实时字幕为空时的补救 */
  async transcribeFile(path: string): Promise<string> {
    if (!isTauri()) {
      throw new Error("离线转写仅桌面端可用");
    }
    return invoke<string>("asr_transcribe_file", { path });
  },

  /** 按 sessionId 解析 recordings 目录下的 wav 路径（stop 失败时的兜底） */
  async recordingPath(sessionId: string): Promise<string | null> {
    if (!isTauri()) return null;
    try {
      return await invoke<string | null>("audio_recording_path", { sessionId });
    } catch {
      return null;
    }
  },

  async onAsrEvent(
    handler: (event: AsrEventPayload) => void,
  ): Promise<UnlistenFn> {
    if (!isTauri()) return () => undefined;
    return listen<AsrEventPayload>("asr-event", (e) => {
      handler(e.payload);
    });
  },
};
