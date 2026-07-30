import type {
  LLMConfig,
  LLMReportInput,
  StructuredReport,
  TestResult,
} from "@expr-talk/shared";
import type { LLMProvider } from "../../types";
import type { LLMRequestOptions } from "../../types";
import { testOpenAICompatible } from "../../openai_compatible";
import { generateFinalReport } from "../../finalReport";

export const openaiLLMProvider: LLMProvider = {
  id: "openai",
  name: "OpenAI Compatible",
  local: false,
  supportsStructuredOutput: true,
  info() {
    return {
      id: this.id,
      name: this.name,
      local: this.local,
      supportsStructuredOutput: this.supportsStructuredOutput,
    };
  },
  async testConnection(config: LLMConfig): Promise<TestResult> {
    return testOpenAICompatible({
      ...config,
      providerId: config.providerId || "openai",
      baseUrl: config.baseUrl || "https://api.openai.com/v1",
    });
  },
  async finalReport(
    input: LLMReportInput,
    config: LLMConfig,
    options?: LLMRequestOptions,
  ): Promise<StructuredReport> {
    return generateFinalReport(input, {
      ...config,
      baseUrl: config.baseUrl || "https://api.openai.com/v1",
    }, options);
  },
};
