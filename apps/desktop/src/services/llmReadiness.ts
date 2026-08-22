import type { AppSettings, LLMConfig } from "@showtalk/shared";
import { getLLMProvider } from "@showtalk/llm";

export type LlmReady =
  | { ok: true; config: LLMConfig; label: string }
  | { ok: false; reason: string };

/** 练习和复盘共用同一套就绪判断，避免录完后才发现无法生成报告。 */
export function resolveLlmConfig(settings: AppSettings): LlmReady {
  const providerId = settings.llm.provider || "deepseek";
  const providerCfg = settings.llm.providers[providerId] ?? {};
  const apiKey = String(providerCfg.apiKey ?? "").trim();
  const baseUrl = String(providerCfg.baseUrl ?? "").trim();
  const model = String(providerCfg.model ?? "").trim();
  const isLocal =
    providerId === "ollama" ||
    baseUrl.includes("localhost") ||
    baseUrl.includes("127.0.0.1");

  if (!getLLMProvider(providerId)) {
    return { ok: false, reason: `未知大模型 Provider：${providerId}` };
  }
  if (!isLocal && !apiKey) {
    return {
      ok: false,
      reason: `未配置 ${providerId} 的 API Key，开始练习前请先到设置中填写并测试。`,
    };
  }
  if (isLocal && !model) {
    return {
      ok: false,
      reason: "本地服务未填写 model 名称，开始练习前请先完成配置。",
    };
  }

  return {
    ok: true,
    label: `${String(providerCfg.name ?? "").trim() || providerId}${model ? ` · ${model}` : ""}`,
    config: {
      providerId,
      apiKey: apiKey || (isLocal ? "local" : undefined),
      baseUrl: baseUrl || undefined,
      model: model || undefined,
      temperature: 0.3,
    },
  };
}
