import type { LLMProviderInfo } from "@showtalk/shared";
import type { LLMProvider } from "../types";
import { openaiLLMProvider } from "./openai";
import { deepseekLLMProvider } from "./deepseek";
import { customLLMProvider } from "./custom";

const providers: LLMProvider[] = [
  openaiLLMProvider,
  deepseekLLMProvider,
  customLLMProvider,
];

export function listLLMProviders(): LLMProviderInfo[] {
  // custom 只作为 custom:<id> 的实现，不单独出现在渠道列表
  return providers.filter((p) => p.id !== "custom").map((p) => p.info());
}

export function getLLMProvider(id: string): LLMProvider | undefined {
  // 自定义渠道（custom:<slug>）复用 custom 实现
  const resolved = typeof id === "string" && id.startsWith("custom:")
    ? "custom"
    : id;
  return providers.find((p) => p.id === resolved);
}
