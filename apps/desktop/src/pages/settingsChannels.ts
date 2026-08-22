export const USABLE_ASR_IDS = [
  "local-sherpa",
  "aliyun-bailian",
  "tencent-asr",
  "volcengine-asr",
] as const;

export const ASR_DISPLAY_NAMES: Record<string, string> = {
  "local-sherpa": "本地 Sherpa-ONNX",
  "aliyun-bailian": "阿里云百炼",
  "tencent-asr": "腾讯云语音识别",
  "volcengine-asr": "火山引擎",
};

export const LLM_DISPLAY_NAMES: Record<string, string> = {
  openai: "OpenAI 兼容",
  deepseek: "DeepSeek",
  custom: "自定义渠道",
};

const LLM_PLACEHOLDERS: Record<string, { baseUrl: string; model: string }> = {
  deepseek: {
    baseUrl: "https://api.deepseek.com/v1",
    model: "deepseek-chat",
  },
  openai: {
    baseUrl: "https://api.openai.com/v1",
    model: "gpt-4o-mini",
  },
};

export function isCustomLlmId(id: string): boolean {
  return id === "custom" || id.startsWith("custom:");
}

export function llmPlaceholders(id: string): { baseUrl: string; model: string } {
  if (isCustomLlmId(id)) {
    return { baseUrl: "https://api.example.com/v1", model: "model-id" };
  }
  return (
    LLM_PLACEHOLDERS[id] ?? {
      baseUrl: "https://api.openai.com/v1",
      model: "model-id",
    }
  );
}

export function asrDisplayName(id: string, fallback: string): string {
  return ASR_DISPLAY_NAMES[id] ?? fallback;
}

export function llmDisplayName(id: string, fallback: string): string {
  return LLM_DISPLAY_NAMES[id] ?? fallback;
}

function hasText(cfg: Record<string, unknown>, key: string): boolean {
  return String(cfg[key] ?? "").trim().length > 0;
}

export function asrSubtitle(
  id: string,
  cfg: Record<string, unknown>,
  localReady?: boolean | null,
): string {
  if (id === "local-sherpa") {
    if (localReady === true) return "本地模型 · 已就绪";
    if (localReady === false) return "本地模型 · 未下载";
    return "本地模型";
  }
  if (id === "aliyun-bailian") {
    if (!hasText(cfg, "apiKey")) return "待配置";
    return hasText(cfg, "model") ? String(cfg.model).trim() : "已填密钥";
  }
  if (id === "tencent-asr") {
    if (
      !hasText(cfg, "secretId") ||
      !hasText(cfg, "secretKey") ||
      !hasText(cfg, "appId")
    ) {
      return "待配置";
    }
    return `AppId ${String(cfg.appId).trim()}`;
  }
  if (id === "volcengine-asr") {
    if (!hasText(cfg, "appId") || !hasText(cfg, "accessToken")) return "待配置";
    return `AppId ${String(cfg.appId).trim()}`;
  }
  return hasText(cfg, "model") ? String(cfg.model).trim() : "待配置";
}

export function llmSubtitle(cfg: Record<string, unknown>): string {
  const model = String(cfg.model ?? "").trim();
  const apiKey = String(cfg.apiKey ?? "").trim();
  const baseUrl = String(cfg.baseUrl ?? "").trim();
  const isLocal =
    baseUrl.includes("localhost") || baseUrl.includes("127.0.0.1");
  if (!isLocal && !apiKey) return "待配置";
  if (isLocal && !model) return "待配置";
  return model || "已配置";
}

export function customChannelConfigured(
  cfg: Record<string, unknown> | undefined,
): boolean {
  if (!cfg) return false;
  return ["name", "apiKey", "baseUrl", "model"].some((key) => hasText(cfg, key));
}

export function visibleCustomLlmEntries(
  providers: Record<string, Record<string, unknown>>,
  activeId: string,
  viewingId?: string,
): Array<{ id: string; name: string; cfg: Record<string, unknown> }> {
  return Object.entries(providers)
    .filter(([id, cfg]) => {
      if (id.startsWith("custom:")) return true;
      if (id !== "custom") return false;
      return (
        activeId === "custom" ||
        viewingId === "custom" ||
        customChannelConfigured(cfg)
      );
    })
    .map(([id, cfg]) => ({
      id,
      name: String(cfg.name ?? "").trim() || "自定义渠道",
      cfg,
    }));
}

export function filterUsableAsrProviders<T extends { id: string }>(
  providers: T[],
  activeId: string,
): T[] {
  const usable = new Set<string>(USABLE_ASR_IDS);
  return providers.filter((p) => usable.has(p.id) || p.id === activeId);
}

export function builtinLlmProviders<T extends { id: string }>(
  providers: T[],
): T[] {
  const order = ["deepseek", "openai"];
  return order
    .map((id) => providers.find((p) => p.id === id))
    .filter((p): p is T => Boolean(p));
}
