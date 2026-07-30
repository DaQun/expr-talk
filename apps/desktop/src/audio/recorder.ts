import { encodeWavBlob, floatToInt16, resampleFloat32 } from "./resample";
import { audioApi, type AsrEventPayload } from "../ipc/audio";

export const TARGET_SAMPLE_RATE = 16_000;
/** 约 200ms @16k */
const FLUSH_SAMPLES = 3200;
const TICK_MS = 100;

function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = window.setTimeout(
      () => reject(new Error(`${label} 超时（${Math.round(ms / 1000)}s）`)),
      ms,
    );
    p.then(
      (v) => {
        clearTimeout(t);
        resolve(v);
      },
      (e) => {
        clearTimeout(t);
        reject(e);
      },
    );
  });
}

/** int16 → little-endian bytes，避免 Array.from 大数组卡主线程 */
function int16ToBytes(pcm: Int16Array): Uint8Array {
  return new Uint8Array(pcm.buffer, pcm.byteOffset, pcm.byteLength);
}

export type RecorderStopResult = {
  durationSec: number;
  sampleCount: number;
  audioPath?: string;
  wavBlob?: Blob;
  peakRms: number;
  transcript?: string;
  asrEnabled?: boolean;
  asrMessage?: string;
};

export type MicRecorderOptions = {
  sessionId: string;
  enableAsr?: boolean;
  /** ASR provider id，默认 local-sherpa */
  asrProvider?: string;
  /** 写入设置的 provider 字段 */
  asrConfig?: Record<string, unknown>;
  onLevel?: (rms: number) => void;
  onError?: (error: Error) => void;
  onAsrEvent?: (event: AsrEventPayload) => void;
  onStatus?: (message: string) => void;
};

/**
 * 防卡死设计：
 * - onaudioprocess / 音频回调里 **绝不** invoke / setState
 * - 只往内存队列推样本
 * - setInterval 里做重采样 + IPC + UI 电平
 */
export class MicRecorder {
  private sessionId: string;
  private enableAsr: boolean;
  private asrProvider: string;
  private asrConfig: Record<string, unknown>;
  private onLevel?: (rms: number) => void;
  private onError?: (error: Error) => void;
  private onAsrEvent?: (event: AsrEventPayload) => void;
  private onStatus?: (message: string) => void;

  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private processor: ScriptProcessorNode | null = null;
  private mute: GainNode | null = null;

  private running = false;
  private startedAt = 0;
  private peakRms = 0;
  private lastRms = 0;

  /** 音频回调只写这里 */
  private rawChunks: Float32Array[] = [];
  private pcmOut: number[] = [];
  private allPcmLocal: number[] = [];

  private tickTimer: number | null = null;
  private useTauriSink = false;
  private backendReady = false;
  private asrEnabled = false;
  private asrMessage = "";
  /** audio_start 返回的落盘路径；stop 失败时仍可用于离线转写 */
  private knownAudioPath: string | undefined;
  private unlistenAsr: (() => void) | null = null;
  /** 串行发送队列：绝不丢 PCM（旧逻辑在 IPC 慢时会丢包导致无字幕） */
  private pendingSend: Promise<void> = Promise.resolve();
  private consecutiveSendErrors = 0;

  constructor(options: MicRecorderOptions) {
    this.sessionId = options.sessionId;
    this.enableAsr = options.enableAsr ?? true;
    this.asrProvider = options.asrProvider ?? "local-sherpa";
    this.asrConfig = options.asrConfig ?? {};
    this.onLevel = options.onLevel;
    this.onError = options.onError;
    this.onAsrEvent = options.onAsrEvent;
    this.onStatus = options.onStatus;
  }

  get isRunning(): boolean {
    return this.running;
  }

  get recordingId(): string {
    return this.sessionId;
  }

  /**
   * 只做本地麦克风。成功返回后 UI 应已可动。
   * 后端连接请再调 connectBackend()。
   */
  async startLocalOnly(): Promise<void> {
    if (this.running) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      throw new Error("当前环境不支持 getUserMedia");
    }

    this.onStatus?.("请求麦克风权限…");
    this.stream = await withTimeout(
      navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      }),
      15_000,
      "麦克风权限",
    );

    this.onStatus?.("打开音频上下文…");
    this.context = new AudioContext();
    if (this.context.state === "suspended") {
      await this.context.resume();
    }

    this.source = this.context.createMediaStreamSource(this.stream);
    // ScriptProcessor 在主线程回调 —— 回调内禁止任何 IPC
    this.processor = this.context.createScriptProcessor(2048, 1, 1);
    this.mute = this.context.createGain();
    this.mute.gain.value = 0;

    this.rawChunks = [];
    this.pcmOut = [];
    this.allPcmLocal = [];
    this.peakRms = 0;
    this.lastRms = 0;
    this.startedAt = performance.now();
    this.running = true;
    this.useTauriSink = audioApi.isTauri();
    this.backendReady = false;
    this.knownAudioPath = undefined;
    this.pendingSend = Promise.resolve();
    this.consecutiveSendErrors = 0;

    this.processor.onaudioprocess = (ev) => {
      if (!this.running) return;
      const input = ev.inputBuffer.getChannelData(0);
      // 仅拷贝，零 IPC、零 React
      const copy = new Float32Array(input.length);
      copy.set(input);
      this.rawChunks.push(copy);
      // 粗略电平，tick 里再推 UI
      let sum = 0;
      for (let i = 0; i < copy.length; i += 8) {
        const v = copy[i];
        sum += v * v;
      }
      this.lastRms = Math.sqrt(sum / Math.max(1, copy.length / 8));
      if (this.lastRms > this.peakRms) this.peakRms = this.lastRms;
    };

    this.source.connect(this.processor);
    this.processor.connect(this.mute);
    this.mute.connect(this.context.destination);

    // 定时器：唯一允许做重活 / IPC / UI 的地方
    this.tickTimer = window.setInterval(() => this.tick(), TICK_MS);
    this.onStatus?.("本地录音中（电平应跳动）");
  }

  /** 在 startLocalOnly 成功之后调用；失败不影响本地录音 */
  async connectBackend(): Promise<void> {
    if (!this.running || !this.useTauriSink) return;

    try {
      this.onStatus?.("连接后端录音…");
      if (this.onAsrEvent) {
        this.unlistenAsr = await audioApi.onAsrEvent((ev) => {
          if (ev.sessionId && ev.sessionId !== this.sessionId) return;
          this.onAsrEvent?.(ev);
        });
      }

      const start = await withTimeout(
        audioApi.start(
          this.sessionId,
          TARGET_SAMPLE_RATE,
          this.enableAsr,
          this.asrProvider,
          this.asrConfig,
        ),
        12_000,
        "后端 audio_start",
      );
      this.backendReady = true;
      this.knownAudioPath = start.audioPath || undefined;
      this.asrEnabled = start.asrEnabled;
      this.asrMessage = start.asrMessage;
      this.onStatus?.(start.asrMessage || "录音中");
      this.onAsrEvent?.({
        sessionId: this.sessionId,
        type: start.asrEnabled ? "ready" : "error",
        segmentId: "",
        text: "",
        isFinal: false,
        message: start.asrMessage,
      });
    } catch (e) {
      this.backendReady = false;
      const msg = e instanceof Error ? e.message : String(e);
      this.onStatus?.(`仅本地缓冲（后端失败：${msg}）`);
      this.onAsrEvent?.({
        sessionId: this.sessionId,
        type: "error",
        segmentId: "",
        text: "",
        isFinal: false,
        message: `后端录音未连接：${msg}。实时字幕不可用，停止后将尝试离线转写。`,
      });
    }
  }

  /** 兼容旧 API：本地 + 后端 */
  async start(): Promise<void> {
    await this.startLocalOnly();
    // 下一 macrotask 再连后端，确保 UI 已绘制
    window.setTimeout(() => {
      void this.connectBackend();
    }, 0);
  }

  private tick() {
    if (!this.running || !this.context) return;

    // 1) UI 电平（节流：tick 10Hz）
    this.onLevel?.(this.lastRms);

    // 2) 消化音频队列
    const chunks = this.rawChunks;
    if (chunks.length === 0) return;
    this.rawChunks = [];

    const inputRate = this.context.sampleRate;
    for (const float32 of chunks) {
      const resampled = resampleFloat32(float32, inputRate, TARGET_SAMPLE_RATE);
      const pcm = floatToInt16(resampled);
      for (let i = 0; i < pcm.length; i++) {
        this.pcmOut.push(pcm[i]);
        this.allPcmLocal.push(pcm[i]);
      }
    }

    // 3) 够一批再异步发送（不 await，不阻塞 tick）
    if (this.pcmOut.length >= FLUSH_SAMPLES) {
      const take = this.pcmOut.splice(0, this.pcmOut.length);
      const chunk = Int16Array.from(take);
      this.sendAsync(chunk);
    }
  }

  private sendAsync(chunk: Int16Array) {
    if (!this.useTauriSink || !this.backendReady) return;
    if (chunk.length === 0) return;
    // 连续失败过多时暂停送流，避免拖垮主线程；不永久熔断
    if (this.consecutiveSendErrors >= 8) return;
    const bytes = int16ToBytes(chunk);
    this.pendingSend = this.pendingSend
      .then(() => audioApi.appendPcmBytes(this.sessionId, bytes))
      .then(() => {
        this.consecutiveSendErrors = 0;
      })
      .catch((e) => {
        this.consecutiveSendErrors += 1;
        if (this.consecutiveSendErrors <= 2 || this.consecutiveSendErrors % 4 === 0) {
          this.onError?.(e instanceof Error ? e : new Error(String(e)));
        }
      });
  }

  /** 等发送队列排空（停止前调用，避免尾部字幕丢失） */
  private async flushSendQueue(timeoutMs = 8_000): Promise<void> {
    try {
      await withTimeout(this.pendingSend, timeoutMs, "上传音频队列");
    } catch {
      // 不阻断停止；本地 WAV 仍可用
    }
  }

  async stop(): Promise<RecorderStopResult> {
    this.running = false;
    if (this.tickTimer != null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }

    // 最后一轮 tick
    if (this.context) {
      const chunks = this.rawChunks;
      this.rawChunks = [];
      for (const float32 of chunks) {
        const resampled = resampleFloat32(
          float32,
          this.context.sampleRate,
          TARGET_SAMPLE_RATE,
        );
        const pcm = floatToInt16(resampled);
        for (let i = 0; i < pcm.length; i++) {
          this.pcmOut.push(pcm[i]);
          this.allPcmLocal.push(pcm[i]);
        }
      }
    }

    // 剩余 PCM 入队，再等队列排空
    if (this.pcmOut.length > 0 && this.backendReady) {
      const chunk = Int16Array.from(this.pcmOut);
      this.pcmOut = [];
      this.sendAsync(chunk);
    }
    await this.flushSendQueue();

    const durationSec = Math.max(
      0.1,
      (performance.now() - this.startedAt) / 1000,
    );

    // 本地始终有可回放 WAV（不依赖后端）
    const pcmLocal = Int16Array.from(this.allPcmLocal);
    const sampleCount = pcmLocal.length;
    const wavBlob =
      pcmLocal.length > 0
        ? encodeWavBlob(pcmLocal, TARGET_SAMPLE_RATE)
        : undefined;

    let audioPath: string | undefined = this.knownAudioPath;
    let transcript = "";
    // 后端 stop：加长超时；失败仍保留 start 时的路径供离线转写
    if (this.useTauriSink && this.backendReady) {
      try {
        const result = await withTimeout(
          audioApi.stop(this.sessionId),
          10_000,
          "停止后端录音",
        );
        audioPath = result.audioPath || audioPath;
        transcript = result.transcript?.trim() ?? "";
      } catch {
        // 不抛：分析继续，audioPath 可能仍可用
      }
    }

    this.teardown();
    return {
      durationSec,
      sampleCount,
      audioPath,
      wavBlob,
      peakRms: this.peakRms,
      // 包含 ASR finish 产生的尾句；store 会与实时 final segments 去重合并。
      transcript,
      asrEnabled: this.asrEnabled,
      asrMessage: this.asrMessage,
    };
  }

  async discard(): Promise<void> {
    const sessionId = this.sessionId;
    this.running = false;
    if (this.tickTimer != null) {
      clearInterval(this.tickTimer);
      this.tickTimer = null;
    }
    this.teardown();
    if (this.useTauriSink) {
      await audioApi.discard(sessionId);
    }
  }

  private teardown() {
    try {
      this.unlistenAsr?.();
      this.unlistenAsr = null;
      if (this.processor) {
        this.processor.onaudioprocess = null;
        this.processor.disconnect();
      }
      this.source?.disconnect();
      this.mute?.disconnect();
      this.stream?.getTracks().forEach((t) => t.stop());
      void this.context?.close();
    } catch {
      // ignore
    }
    this.processor = null;
    this.source = null;
    this.mute = null;
    this.stream = null;
    this.context = null;
  }
}
