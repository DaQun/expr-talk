import type {
  LLMConfig,
  LLMProviderInfo,
  LLMReportInput,
  StructuredReport,
  TestResult,
} from "@expr-talk/shared";

export type LLMStreamProgress = {
  phase: "connecting" | "streaming" | "parsing";
  receivedChars: number;
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
