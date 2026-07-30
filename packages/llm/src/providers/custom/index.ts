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

export const customLLMProvider: LLMProvider = {
  id: "custom",
  name: "Custom OpenAI Compatible",
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
    if (!config.baseUrl) return { ok: false, message: "缺少 baseUrl" };
    return testOpenAICompatible(config);
  },
  async finalReport(
    input: LLMReportInput,
    config: LLMConfig,
    options?: LLMRequestOptions,
  ): Promise<StructuredReport> {
    if (!config.baseUrl) throw new Error("缺少 baseUrl");
    return generateFinalReport(input, config, options);
  },
};
