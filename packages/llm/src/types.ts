import type {
  LLMConfig,
  LLMProviderInfo,
  LLMReportInput,
  StructuredReport,
  TestResult,
} from "@showtalk/shared";

export type LLMStreamProgress = {
  phase: "connecting" | "streaming" | "parsing";
  receivedChars: number;
  /** 已累计的可见内容；仅在流式阶段提供，供交互模式预览模型回复。 */
  content?: string;
  /** 部分模型只在 reasoning 字段中返回内容，保留给调用方决定是否展示。 */
  reasoning?: string;
};

export type LLMRequestOptions = {
  signal?: AbortSignal;
  onProgress?: (progress: LLMStreamProgress) => void;
};

export interface LLMProvider {
  id: string;
  name: string;
  local: boolean;
  supportsStructuredOutput: boolean;
  info(): LLMProviderInfo;
  testConnection(config: LLMConfig): Promise<TestResult>;
  finalReport(
    input: LLMReportInput,
    config: LLMConfig,
    options?: LLMRequestOptions,
  ): Promise<StructuredReport>;
}
