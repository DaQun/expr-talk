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

export const ollamaLLMProvider: LLMProvider = {
  id: "ollama",
  name: "Ollama (Local)",
  local: true,
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
      providerId: "ollama",
      baseUrl: config.baseUrl || "http://localhost:11434/v1",
      model: config.model || "qwen2.5:7b",
      apiKey: config.apiKey || "ollama",
    });
  },
  async finalReport(
    input: LLMReportInput,
    config: LLMConfig,
    options?: LLMRequestOptions,
  ): Promise<StructuredReport> {
    return generateFinalReport(input, {
      ...config,
      baseUrl: config.baseUrl || "http://localhost:11434/v1",
      model: config.model || "qwen2.5:7b",
      apiKey: config.apiKey || "ollama",
    }, options);
  },
};
