import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ASRConfig, LLMConfig } from "@expr-talk/shared";
import { ExternalLink, RefreshCw } from "lucide-react";
import { api } from "@/ipc/client";
import { audioApi, type AsrModelStatus } from "@/ipc/audio";
import { useSettingsStore } from "@/state/settingsStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { cn } from "@/lib/utils";

/** 在线 ASR 控制台入口（获取 Key / 开通服务） */
const ASR_CONSOLE_LINKS: Record<
  string,
  { label: string; href: string; hint: string }
> = {
  "aliyun-bailian": {
    label: "打开阿里云百炼控制台",
    href: "https://bailian.console.aliyun.com/",
    hint: "在「API-KEY 管理」创建密钥，并确认已开通实时语音识别（如 paraformer-realtime）权限。",
  },
  "tencent-asr": {
    label: "打开腾讯云语音识别控制台",
    href: "https://console.cloud.tencent.com/asr",
    hint: "开通实时语音识别后，在「访问管理 → API 密钥」获取 SecretId / SecretKey，并创建应用拿到 AppId。",
  },
  "volcengine-asr": {
    label: "打开火山引擎语音技术控制台",
    href: "https://console.volcengine.com/speech/app",
    hint: "创建应用后获取 AppId 与 Access Token，并选择该应用实际开通的语音识别产品。",
  },
};

export function SettingsPage() {
  const {
    settings,
    loaded,
    load,
    save,
    patch,
    saving,
    lastSavedAt,
    saveError,
  } = useSettingsStore();
  const [testMsg, setTestMsg] = useState<string | null>(null);
  const [testing, setTesting] = useState(false);
  const [modelLoading, setModelLoading] = useState(false);
  const [modelOptions, setModelOptions] = useState<string[]>([]);
  const [modelMsg, setModelMsg] = useState<string | null>(null);
  const modelRequestId = useRef(0);
  const [asrTestMsg, setAsrTestMsg] = useState<string | null>(null);
  const [asrTesting, setAsrTesting] = useState(false);
  const [volcProductOpen, setVolcProductOpen] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [modelStatus, setModelStatus] = useState<AsrModelStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    if (!audioApi.isTauri()) return;
    void audioApi.modelStatus().then(setModelStatus);
  }, []);

  const asrProviders = useQuery({
    queryKey: ["asr-providers"],
    queryFn: () => api.listAsrProviders(),
  });

  const llmProviders = useQuery({
    queryKey: ["llm-providers"],
    queryFn: () => api.listLlmProviders(),
  });

  const providerId = settings.llm.provider;
  const providerCfg = settings.llm.providers[providerId] ?? {};

  useEffect(() => {
    modelRequestId.current += 1;
    setModelLoading(false);
    setModelOptions([]);
    setModelMsg(null);
  }, [providerId, providerCfg.baseUrl]);

  const asrId = settings.asr.realtimeProvider;
  const asrCfg = settings.asr.providers[asrId] ?? {};
  const asrMeta = (asrProviders.data ?? []).find((p) => p.id === asrId);
  const asrIsLocal = asrMeta?.local ?? asrId === "local-sherpa";

  function updateLlmField(field: string, value: string) {
    patch({
      llm: {
        ...settings.llm,
        providers: {
          ...settings.llm.providers,
          [providerId]: {
            ...settings.llm.providers[providerId],
            [field]: value,
          },
        },
      },
    });
  }

  function updateAsrField(field: string, value: string) {
    patch({
      asr: {
        ...settings.asr,
        providers: {
          ...settings.asr.providers,
          [asrId]: {
            ...(settings.asr.providers[asrId] ?? {}),
            [field]: value,
          },
        },
      },
    });
  }

  function updateVolcProduct(product: string) {
    setVolcProductOpen(false);
    const resourceId =
      product === "seed-asr-2-concurrent"
        ? "volc.bigasr.sauc.concurrent"
        : product === "legacy-standard"
          ? ""
          : "volc.bigasr.sauc.duration";
    patch({
      asr: {
        ...settings.asr,
        providers: {
          ...settings.asr.providers,
          [asrId]: {
            ...(settings.asr.providers[asrId] ?? {}),
            product,
            resourceId,
          },
        },
      },
    });
  }

  async function testLlm() {
    setTesting(true);
    setTestMsg(null);
    try {
      const cfg: LLMConfig = {
        providerId,
        apiKey: String(providerCfg.apiKey ?? ""),
        baseUrl: String(providerCfg.baseUrl ?? ""),
        model: String(providerCfg.model ?? ""),
      };
      const result = await api.testLlm(cfg);
      setTestMsg(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
    } catch (e) {
      setTestMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setTesting(false);
    }
  }

  async function loadLlmModels() {
    const requestId = ++modelRequestId.current;
    setModelLoading(true);
    setModelOptions([]);
    setModelMsg(null);
    try {
      const models = await api.listLlmModels({
        providerId,
        apiKey: String(providerCfg.apiKey ?? ""),
        baseUrl: String(providerCfg.baseUrl ?? ""),
        model: String(providerCfg.model ?? ""),
      });
      if (requestId !== modelRequestId.current) return;
      setModelOptions(models);
      setModelMsg(`✓ 已获取 ${models.length} 个模型`);
    } catch (e) {
      if (requestId !== modelRequestId.current) return;
      setModelMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      if (requestId === modelRequestId.current) setModelLoading(false);
    }
  }

  async function testAsr() {
    setAsrTesting(true);
    setAsrTestMsg(null);
    try {
      const cfg: ASRConfig = {
        providerId: asrId,
        apiKey: String(
          asrCfg.apiKey ?? asrCfg.secretId ?? asrCfg.accessToken ?? "",
        ),
        baseUrl: String(asrCfg.baseUrl ?? ""),
        model: String(asrCfg.model ?? ""),
        extra: { ...asrCfg },
        ...asrCfg,
      };
      // 展开字段给 Rust test（secretId 等顶层）
      const payload = {
        providerId: asrId,
        ...asrCfg,
        apiKey: cfg.apiKey,
      };
      const result = await api.testAsr(payload as ASRConfig);
      setAsrTestMsg(result.ok ? `✓ ${result.message}` : `✗ ${result.message}`);
    } catch (e) {
      setAsrTestMsg(e instanceof Error ? e.message : String(e));
    } finally {
      setAsrTesting(false);
    }
  }

  async function downloadLocalModel() {
    if (!audioApi.isTauri()) {
      setDownloadMsg("请在桌面端（tauri:dev）下载本地模型");
      return;
    }
    setDownloading(true);
    setDownloadMsg("正在下载（约数百 MB，请耐心等待）…");
    try {
      const status = await audioApi.downloadModel();
      setModelStatus(status);
      setDownloadMsg(status.ready ? `✓ ${status.hint}` : `✗ ${status.hint}`);
    } catch (e) {
      setDownloadMsg(`✗ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setDownloading(false);
    }
  }

  async function handleSave() {
    try {
      await save(settings);
      setSavedFlash(true);
      window.setTimeout(() => setSavedFlash(false), 1800);
    } catch {
      // saveError 已在 store
    }
  }

  const savedHint = saving
    ? "正在写入本机…"
    : saveError
      ? `保存失败：${saveError}`
      : lastSavedAt
        ? `已自动保存到本机 ${new Date(lastSavedAt).toLocaleTimeString()}`
        : loaded
          ? "修改后会自动保存到本机数据库"
          : "正在加载设置…";

  return (
    <div>
      <PageHeader
        title="设置"
        description="语音识别（本地 / 在线）、大模型报告与隐私。API Key 等凭证自动写入本机 SQLite，重启后仍保留。"
      />

      <div className="flex flex-col gap-4">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">语音识别</CardTitle>
            <CardDescription>
              支持本地 Sherpa
              与在线：阿里百炼、腾讯云、火山引擎。本地模型默认不附带，需手动下载。
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="realtime">实时 Provider</Label>
              <Select
                value={settings.asr.realtimeProvider}
                onValueChange={(v) =>
                  patch({
                    asr: { ...settings.asr, realtimeProvider: v },
                  })
                }
              >
                <SelectTrigger id="realtime" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(asrProviders.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.local ? " · 本地" : " · 在线"}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {asrIsLocal && (
              <div className="bg-muted/60 space-y-3 rounded-xl border border-border p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-medium">本地模型</span>
                  <Badge variant={modelStatus?.ready ? "success" : "warning"}>
                    {modelStatus == null
                      ? "检测中…"
                      : modelStatus.ready
                        ? "已就绪"
                        : "未下载"}
                  </Badge>
                  {modelStatus?.ready && modelStatus.sizeLabel ? (
                    <Badge variant="secondary">
                      占用 {modelStatus.sizeLabel}
                    </Badge>
                  ) : modelStatus && !modelStatus.ready ? (
                    <Badge variant="outline">
                      约{" "}
                      {modelStatus.expectedArchiveLabel ??
                        modelStatus.expectedSizeLabel ??
                        "210 MB"}{" "}
                      下载
                    </Badge>
                  ) : null}
                </div>
                <div className="text-muted-foreground space-y-1 text-xs leading-relaxed">
                  <p>
                    {modelStatus?.hint ??
                      "本地 streaming zipformer 需手动下载后才能实时字幕。未下载时可改用在线 ASR 或粘贴稿。"}
                  </p>
                  <p>
                    模型：streaming zipformer 中英双语
                    {modelStatus?.ready && modelStatus.sizeLabel
                      ? ` · 核心文件 ${modelStatus.sizeLabel}`
                      : ` · 压缩包约 ${modelStatus?.expectedArchiveLabel ?? "210 MB"}，解压后约 ${modelStatus?.expectedSizeLabel ?? "280 MB"}`}
                  </p>
                </div>
                {modelStatus?.modelDir && (
                  <p className="text-muted-foreground font-mono text-[0.7rem] break-all">
                    {modelStatus.modelDir}
                  </p>
                )}
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    disabled={downloading || Boolean(modelStatus?.ready)}
                    onClick={() => void downloadLocalModel()}
                  >
                    {downloading
                      ? "下载中…"
                      : modelStatus?.ready
                        ? "模型已下载"
                        : `下载本地模型（约 ${modelStatus?.expectedArchiveLabel ?? "210 MB"}）`}
                  </Button>
                  {modelStatus?.ready && (
                    <Button
                      variant="ghost"
                      size="sm"
                      disabled={downloading}
                      onClick={() => void downloadLocalModel()}
                    >
                      重新下载
                    </Button>
                  )}
                </div>
                {downloadMsg && (
                  <p className="text-muted-foreground text-xs">{downloadMsg}</p>
                )}
              </div>
            )}

            {!asrIsLocal && ASR_CONSOLE_LINKS[asrId] && (
              <div className="bg-primary/5 border-primary/20 space-y-2 rounded-xl border p-3.5">
                <p className="text-muted-foreground text-xs leading-relaxed">
                  {ASR_CONSOLE_LINKS[asrId].hint}
                </p>
                <a
                  href={ASR_CONSOLE_LINKS[asrId].href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-primary inline-flex items-center gap-1.5 text-sm font-medium underline-offset-4 hover:underline"
                >
                  {ASR_CONSOLE_LINKS[asrId].label}
                  <ExternalLink className="size-3.5 opacity-80" aria-hidden />
                </a>
              </div>
            )}

            {asrId === "aliyun-bailian" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="asr-apiKey">API Key</Label>
                  <Input
                    id="asr-apiKey"
                    type="password"
                    value={String(asrCfg.apiKey ?? "")}
                    onChange={(e) => updateAsrField("apiKey", e.target.value)}
                    placeholder="sk-…（百炼控制台）"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asr-model">Model</Label>
                  <Input
                    id="asr-model"
                    value={String(asrCfg.model ?? "paraformer-realtime-v2")}
                    onChange={(e) => updateAsrField("model", e.target.value)}
                    placeholder="paraformer-realtime-v2"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="asr-base">WebSocket URL</Label>
                  <Input
                    id="asr-base"
                    value={String(
                      asrCfg.baseUrl ??
                        "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
                    )}
                    onChange={(e) => updateAsrField("baseUrl", e.target.value)}
                  />
                </div>
              </div>
            )}

            {asrId === "tencent-asr" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="tx-sid">SecretId</Label>
                  <Input
                    id="tx-sid"
                    value={String(asrCfg.secretId ?? "")}
                    onChange={(e) => updateAsrField("secretId", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tx-skey">SecretKey</Label>
                  <Input
                    id="tx-skey"
                    type="password"
                    value={String(asrCfg.secretKey ?? "")}
                    onChange={(e) =>
                      updateAsrField("secretKey", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tx-app">AppId</Label>
                  <Input
                    id="tx-app"
                    value={String(asrCfg.appId ?? "")}
                    onChange={(e) => updateAsrField("appId", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="tx-engine">引擎</Label>
                  <Input
                    id="tx-engine"
                    value={String(asrCfg.engineModelType ?? "16k_zh")}
                    onChange={(e) =>
                      updateAsrField("engineModelType", e.target.value)
                    }
                    placeholder="16k_zh"
                  />
                </div>
              </div>
            )}

            {asrId === "volcengine-asr" && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="volc-app">AppId</Label>
                  <Input
                    id="volc-app"
                    value={String(asrCfg.appId ?? "")}
                    onChange={(e) => updateAsrField("appId", e.target.value)}
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="volc-token">Access Token</Label>
                  <Input
                    id="volc-token"
                    type="password"
                    value={String(asrCfg.accessToken ?? "")}
                    onChange={(e) =>
                      updateAsrField("accessToken", e.target.value)
                    }
                  />
                </div>
                <div className="space-y-2 sm:col-span-2">
                  <Label htmlFor="volc-product">已开通产品</Label>
                  <Select
                    open={volcProductOpen}
                    onOpenChange={setVolcProductOpen}
                    value={String(asrCfg.product || "seed-asr-2-duration")}
                    onValueChange={updateVolcProduct}
                  >
                    <SelectTrigger id="volc-product" className="w-full">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="seed-asr-2-duration">
                        豆包流式语音识别模型 2.0 · 小时版
                      </SelectItem>
                      <SelectItem value="seed-asr-2-concurrent">
                        豆包流式语音识别模型 2.0 · 并发版
                      </SelectItem>
                      <SelectItem value="legacy-standard">
                        旧流式语音识别标准版（兼容）
                      </SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="volc-lang">Language</Label>
                  <Input
                    id="volc-lang"
                    value={String(asrCfg.language ?? "zh-CN")}
                    onChange={(e) => updateAsrField("language", e.target.value)}
                  />
                </div>
              </div>
            )}

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={asrTesting}
                onClick={() => void testAsr()}
              >
                {asrTesting ? "检测中…" : "检测 ASR 配置"}
              </Button>
              {asrTestMsg && (
                <div
                  role="status"
                  className={cn(
                    "min-w-0 max-w-full rounded-lg border px-3 py-2 text-xs leading-relaxed whitespace-normal [overflow-wrap:anywhere]",
                    asrTestMsg.startsWith("✓")
                      ? "border-success/25 bg-success/10 text-success"
                      : "border-warning/30 bg-warning/10 text-warning-foreground basis-full",
                  )}
                >
                  {asrTestMsg}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">大模型报告</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            <div className="space-y-2">
              <Label htmlFor="llm">Provider</Label>
              <Select
                value={settings.llm.provider}
                onValueChange={(v) =>
                  patch({
                    llm: { ...settings.llm, provider: v },
                  })
                }
              >
                <SelectTrigger id="llm" className="w-full">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {(llmProviders.data ?? []).map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      {p.name}
                      {p.local ? "（本地）" : ""}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <div className="space-y-2">
                <Label htmlFor="baseUrl">Base URL</Label>
                <Input
                  id="baseUrl"
                  value={String(providerCfg.baseUrl ?? "")}
                  onChange={(e) => updateLlmField("baseUrl", e.target.value)}
                  placeholder="https://api.deepseek.com/v1"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="model">Model</Label>
                <div className="flex gap-2">
                  <Input
                    id="model"
                    className="min-w-0"
                    value={String(providerCfg.model ?? "")}
                    onChange={(e) => updateLlmField("model", e.target.value)}
                    placeholder="deepseek-chat"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={modelLoading}
                    onClick={() => void loadLlmModels()}
                  >
                    <RefreshCw className={modelLoading ? "animate-spin" : ""} />
                    {modelLoading ? "获取中…" : "获取模型"}
                  </Button>
                </div>
                {modelOptions.length > 0 && (
                  <Select
                    value={
                      modelOptions.includes(String(providerCfg.model ?? ""))
                        ? String(providerCfg.model ?? "")
                        : undefined
                    }
                    onValueChange={(value) => updateLlmField("model", value)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="选择已获取的模型" />
                    </SelectTrigger>
                    <SelectContent>
                      {modelOptions.map((model) => (
                        <SelectItem key={model} value={model}>
                          {model}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {modelMsg && (
                  <p
                    role="status"
                    className={cn(
                      "text-xs leading-relaxed [overflow-wrap:anywhere]",
                      modelMsg.startsWith("✓")
                        ? "text-success"
                        : "text-warning-foreground",
                    )}
                  >
                    {modelMsg}
                  </p>
                )}
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="apiKey">API Key</Label>
              <Input
                id="apiKey"
                type="password"
                value={String(providerCfg.apiKey ?? "")}
                onChange={(e) => updateLlmField("apiKey", e.target.value)}
                onBlur={() => void save()}
                placeholder="sk-..."
                autoComplete="off"
              />
              <p className="text-muted-foreground text-xs">
                输入后自动保存到本机；失焦时立即落盘。重启应用不会丢失。
              </p>
            </div>

            <div className="flex min-w-0 flex-wrap items-center gap-2">
              <Button
                variant="secondary"
                disabled={testing}
                onClick={() => void testLlm()}
              >
                {testing ? "测试中…" : "测试连接"}
              </Button>
              {testMsg && (
                <div
                  role="status"
                  className={cn(
                    "min-w-0 max-w-full rounded-lg border px-3 py-2 text-xs leading-relaxed whitespace-normal [overflow-wrap:anywhere]",
                    testMsg.startsWith("✓")
                      ? "border-success/25 bg-success/10 text-success"
                      : "border-warning/30 bg-warning/10 text-warning-foreground basis-full",
                  )}
                >
                  {testMsg}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">隐私</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="bg-card flex items-start justify-between gap-4 rounded-lg border border-border p-3.5">
              <div className="space-y-1">
                <Label htmlFor="keep-audio" className="text-foreground">
                  保存录音到本地
                </Label>
                <p className="text-muted-foreground text-xs leading-snug">
                  在线 ASR / LLM 会上传音频流或逐字稿。本地规则分析不联网。
                </p>
              </div>
              <Switch
                id="keep-audio"
                checked={settings.privacy.keepAudio}
                onCheckedChange={(checked) =>
                  patch({
                    privacy: { ...settings.privacy, keepAudio: checked },
                  })
                }
              />
            </div>
          </CardContent>
        </Card>

        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => void handleSave()} disabled={saving}>
            {savedFlash ? "已保存" : saving ? "保存中…" : "立即保存"}
          </Button>
          <span
            className={
              saveError
                ? "text-destructive text-sm"
                : "text-muted-foreground text-sm"
            }
          >
            {savedFlash ? "已写入本机数据库" : savedHint}
          </span>
        </div>
      </div>
    </div>
  );
}
