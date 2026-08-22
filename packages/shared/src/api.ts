import type { ASRConfig, ASRProviderInfo, TestResult } from "./asr";
import type { LLMConfig, LLMProviderInfo } from "./llm";
import type { CreateSessionInput, TrainingSession } from "./session";
import type { StructuredReport } from "./report";
import type { UserProfile } from "./profile";

/** 前端与 Rust 后端的 IPC 契约（与架构文档 §9 对齐） */
export type AppAPI = {
  session: {
    create(input: CreateSessionInput): Promise<TrainingSession>;
    startRecording(id: string): Promise<void>;
    stopRecording(id: string): Promise<TrainingSession>;
    analyze(id: string): Promise<StructuredReport>;
  };
  asr: {
    listProviders(): Promise<ASRProviderInfo[]>;
    testProvider(config: ASRConfig): Promise<TestResult>;
  };
  llm: {
    listProviders(): Promise<LLMProviderInfo[]>;
    testProvider(config: LLMConfig): Promise<TestResult>;
  };
  history: {
    list(query?: HistoryQuery): Promise<TrainingSession[]>;
    get(id: string): Promise<TrainingSession | null>;
  };
  profile: {
    get(): Promise<UserProfile>;
  };
};

export type HistoryQuery = {
  mode?: string;
  limit?: number;
  offset?: number;
  search?: string;
};

export type AppSettings = {
  asr: {
    realtimeProvider: string;
    finalProvider: string;
    useFinalRefinement: boolean;
    providers: Record<string, Record<string, unknown>>;
  };
  llm: {
    provider: string;
    /** @deprecated 兼容旧版设置；复盘现由 Provider 配置决定是否可用。 */
    enableReport: boolean;
    providers: Record<string, Record<string, unknown>>;
  };
  privacy: {
    keepAudio: boolean;
    autoDeleteAudioDays?: number;
  };
};

export const DEFAULT_SETTINGS: AppSettings = {
  asr: {
    realtimeProvider: "local-sherpa",
    finalProvider: "local-sherpa",
    useFinalRefinement: false,
    providers: {
      "local-sherpa": { modelPath: "", language: "zh" },
      "aliyun-bailian": {
        apiKey: "",
        baseUrl: "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
        model: "paraformer-realtime-v2",
        language: "zh",
      },
      "tencent-asr": {
        secretId: "",
        secretKey: "",
        appId: "",
        engineModelType: "16k_zh",
        region: "ap-shanghai",
      },
      "volcengine-asr": {
        appId: "",
        accessToken: "",
        product: "seed-asr-2-duration",
        resourceId: "volc.bigasr.sauc.duration",
        /** 仅旧流式语音识别标准版使用，保留用于兼容已有配置 */
        cluster: "volcengine_streaming_common",
        language: "zh-CN",
      },
      "openai-transcription": {
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini-transcribe",
        language: "zh",
      },
    },
  },
  llm: {
    provider: "deepseek",
    // 兼容旧版设置；当前评审流程不再读取该字段
    enableReport: true,
    providers: {
      openai: {
        apiKey: "",
        baseUrl: "https://api.openai.com/v1",
        model: "gpt-4o-mini",
      },
      deepseek: {
        apiKey: "",
        baseUrl: "https://api.deepseek.com/v1",
        model: "deepseek-chat",
      },
      custom: {
        apiKey: "",
        baseUrl: "",
        model: "",
      },
    },
  },
  privacy: {
    keepAudio: true,
  },
};
