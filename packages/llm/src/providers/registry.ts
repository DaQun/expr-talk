import type { LLMProviderInfo } from "@expr-talk/shared";
import type { LLMProvider } from "../types";
import { openaiLLMProvider } from "./openai";
import { deepseekLLMProvider } from "./deepseek";
import { ollamaLLMProvider } from "./ollama";
import { customLLMProvider } from "./custom";

const providers: LLMProvider[] = [
  openaiLLMProvider,
  deepseekLLMProvider,
  ollamaLLMProvider,
  customLLMProvider,
];

export function listLLMProviders(): LLMProviderInfo[] {
  return providers.map((p) => p.info());
}

export function getLLMProvider(id: string): LLMProvider | undefined {
  return providers.find((p) => p.id === id);
}
