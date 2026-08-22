import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { ASRConfig, ASRProviderInfo, LLMConfig } from "@showtalk/shared";
import {
  ArrowUpRight,
  Check,
  Eye,
  EyeOff,
  Plus,
  RefreshCw,
  Trash2,
} from "lucide-react";
import { api } from "@/ipc/client";
import { audioApi, type AsrModelStatus } from "@/ipc/audio";
import { useSettingsStore } from "@/state/settingsStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import {
  ASR_DISPLAY_NAMES,
  asrDisplayName,
  asrSubtitle,
  builtinLlmProviders,
  filterUsableAsrProviders,
  isCustomLlmId,
  llmDisplayName,
  llmPlaceholders,
  llmSubtitle,
  USABLE_ASR_IDS,
  visibleCustomLlmEntries,
} from "./settingsChannels";

/** 在线 ASR 控制台入口（获取 Key / 开通服务） */
const ASR_CONSOLE_LINKS: Record<
  string,
  { label: string; short: string; href: string; hint: string }
> = {
  "aliyun-bailian": {
    label: "打开阿里云百炼控制台",
    short: "百炼控制台",
    href: "https://bailian.console.aliyun.com/",
    hint: "在「API-KEY 管理」创建密钥，并确认已开通实时语音识别（如 paraformer-realtime）权限。",
  },
  "tencent-asr": {
    label: "打开腾讯云语音识别控制台",
    short: "腾讯云控制台",
    href: "https://console.cloud.tencent.com/asr",
    hint: "开通实时语音识别后，在「访问管理 → API 密钥」获取 SecretId / SecretKey，并创建应用拿到 AppId。",
  },
  "volcengine-asr": {
    label: "打开火山引擎语音技术控制台",
    short: "火山控制台",
    href: "https://console.volcengine.com/speech/app",
    hint: "创建应用后获取 AppId 与 Access Token，并选择该应用实际开通的语音识别产品。",
  },
};

const ASR_DESCRIPTIONS: Record<string, string> = {
  "aliyun-bailian": "阿里云 DashScope 实时语音识别（Paraformer）",
  "tencent-asr": "腾讯云实时语音识别（WebSocket 流式）",
  "volcengine-asr": "火山引擎豆包流式语音识别模型 2.0",
  "local-sherpa": "本地 Sherpa streaming zipformer，离线可用，不上传音频",
};

const FALLBACK_ASR_PROVIDERS: ASRProviderInfo[] = USABLE_ASR_IDS.map((id) => ({
  id,
  name: ASR_DISPLAY_NAMES[id],
  local: id === "local-sherpa",
  capabilities: {
    streaming: true,
    batch: false,
    wordTimestamps: false,
    speakerDiarization: false,
    punctuation: id !== "local-sherpa",
  },
}));

/** 密码输入框，右侧带显示 / 隐藏切换 */
function SecretInput({
  value,
  onChange,
  onBlur,
  placeholder,
  id,
}: {
  value: string;
  onChange: (value: string) => void;
  onBlur?: () => void;
  placeholder?: string;
  id?: string;
}) {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <Input
        id={id}
        type={visible ? "text" : "password"}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onBlur}
        placeholder={placeholder}
        autoComplete="off"
        className="pr-11"
      />
      <button
        type="button"
        aria-label={visible ? "隐藏密钥" : "显示密钥"}
        onClick={() => setVisible((v) => !v)}
        className="text-muted-foreground hover:text-foreground absolute inset-y-0 right-2 my-auto flex size-8 items-center justify-center rounded-lg"
      >
        {visible ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

/** 左侧渠道列表条目：高亮表示正在查看，勾选表示当前用于练习 */
function ChannelItem({
  name,
  subtitle,
  selected,
  inUse,
  onSelect,
}: {
  name: string;
  subtitle: string;
  selected: boolean;
  inUse: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      aria-current={inUse ? "true" : undefined}
      className={cn(
        "flex w-full items-start gap-2.5 rounded-xl border px-3 py-2.5 text-left transition-colors",
        selected
          ? "border-primary/40 bg-primary/10"
          : "border-transparent hover:bg-muted/60",
      )}
    >
      <Check
        className={cn(
          "mt-0.5 size-4 shrink-0",
          inUse ? "text-success" : "opacity-0",
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{name}</span>
        <span className="text-muted-foreground mt-0.5 block truncate text-xs">
          {subtitle}
        </span>
      </span>
    </button>
  );
}

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
  const [savedFlash, setSavedFlash] = useState(false);
  const [modelStatus, setModelStatus] = useState<AsrModelStatus | null>(null);
  const [downloading, setDownloading] = useState(false);
  const [downloadMsg, setDownloadMsg] = useState<string | null>(null);
  const [asrFocusId, setAsrFocusId] = useState<string | null>(null);
  const [llmFocusId, setLlmFocusId] = useState<string | null>(null);

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

  const activeLlmId = settings.llm.provider;
  const viewingLlmId = llmFocusId ?? activeLlmId;
  const viewingLlmCfg = settings.llm.providers[viewingLlmId] ?? {};
  const llmHints = llmPlaceholders(viewingLlmId);

  useEffect(() => {
    modelRequestId.current += 1;
    setModelLoading(false);
    setModelOptions([]);
    setModelMsg(null);
  }, [viewingLlmId, viewingLlmCfg.baseUrl]);

  useEffect(() => {
    setTestMsg(null);
  }, [viewingLlmId]);

  const activeAsrId = settings.asr.realtimeProvider;
  const viewingAsrId = asrFocusId ?? activeAsrId;
  const viewingAsrCfg = settings.asr.providers[viewingAsrId] ?? {};

  useEffect(() => {
    setAsrTestMsg(null);
  }, [viewingAsrId]);

  const asrProviderList = filterUsableAsrProviders(
    asrProviders.data?.length ? asrProviders.data : FALLBACK_ASR_PROVIDERS,
    activeAsrId,
  );
  const asrMeta = asrProviderList.find((p) => p.id === viewingAsrId);
  const asrIsLocal = asrMeta?.local ?? viewingAsrId === "local-sherpa";
  const asrInUse = viewingAsrId === activeAsrId;

  const builtinLlmList = builtinLlmProviders(
    llmProviders.data?.length
      ? llmProviders.data
      : [
          {
            id: "deepseek",
            name: "DeepSeek",
            local: false,
            supportsStructuredOutput: true,
          },
          {
            id: "openai",
            name: "OpenAI Compatible",
            local: false,
            supportsStructuredOutput: true,
          },
        ],
  );
  const customLlmEntries = visibleCustomLlmEntries(
    settings.llm.providers,
    activeLlmId,
    viewingLlmId,
  );
  const activeLlmEntry =
    builtinLlmList.find((p) => p.id === viewingLlmId) ??
    customLlmEntries.find((p) => p.id === viewingLlmId);
  const isCustomChannel = isCustomLlmId(viewingLlmId);
  const llmInUse = viewingLlmId === activeLlmId;
  const viewingLlmName = isCustomChannel
    ? String(viewingLlmCfg.name ?? "").trim() ||
      activeLlmEntry?.name ||
      "自定义渠道"
    : llmDisplayName(viewingLlmId, activeLlmEntry?.name ?? viewingLlmId);

  function updateLlmField(field: string, value: string) {
    patch({
      llm: {
        ...settings.llm,
        providers: {
          ...settings.llm.providers,
          [viewingLlmId]: {
            ...settings.llm.providers[viewingLlmId],
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
          [viewingAsrId]: {
            ...(settings.asr.providers[viewingAsrId] ?? {}),
            [field]: value,
          },
        },
      },
    });
  }

  function updateVolcProduct(product: string) {
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
          [viewingAsrId]: {
            ...(settings.asr.providers[viewingAsrId] ?? {}),
            product,
            resourceId,
          },
        },
      },
    });
  }

  function activateViewingAsr() {
    if (viewingAsrId === activeAsrId) return;
    patch({
      asr: { ...settings.asr, realtimeProvider: viewingAsrId },
    });
  }

  function activateViewingLlm() {
    if (viewingLlmId === activeLlmId) return;
    patch({
      llm: { ...settings.llm, provider: viewingLlmId },
    });
  }

  function addCustomLlmProvider() {
    const id = `custom:${Date.now().toString(36)}`;
    patch({
      llm: {
        ...settings.llm,
        providers: {
          ...settings.llm.providers,
          [id]: { name: "自定义渠道", apiKey: "", baseUrl: "", model: "" },
        },
      },
    });
    setLlmFocusId(id);
  }

  function removeCustomLlmProvider() {
    if (!isCustomChannel) return;
    if (!window.confirm("删除该自定义渠道？已保存的密钥会一并移除。")) return;
    const providers = { ...settings.llm.providers };
    if (viewingLlmId === "custom") {
      providers.custom = { apiKey: "", baseUrl: "", model: "", name: "" };
    } else {
      delete providers[viewingLlmId];
    }
    const nextActive =
      settings.llm.provider === viewingLlmId
        ? "deepseek"
        : settings.llm.provider;
    patch({
      llm: { ...settings.llm, provider: nextActive, providers },
    });
    setLlmFocusId(nextActive);
  }

  async function testLlm() {
    setTesting(true);
    setTestMsg(null);
    try {
      const cfg: LLMConfig = {
        providerId: viewingLlmId,
        apiKey: String(viewingLlmCfg.apiKey ?? ""),
        baseUrl: String(viewingLlmCfg.baseUrl ?? ""),
        model: String(viewingLlmCfg.model ?? ""),
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
        providerId: viewingLlmId,
        apiKey: String(viewingLlmCfg.apiKey ?? ""),
        baseUrl: String(viewingLlmCfg.baseUrl ?? ""),
        model: String(viewingLlmCfg.model ?? ""),
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
        providerId: viewingAsrId,
        apiKey: String(
          viewingAsrCfg.apiKey ??
            viewingAsrCfg.secretId ??
            viewingAsrCfg.accessToken ??
            "",
        ),
        baseUrl: String(viewingAsrCfg.baseUrl ?? ""),
        model: String(viewingAsrCfg.model ?? ""),
        extra: { ...viewingAsrCfg },
        ...viewingAsrCfg,
      };
      const payload = {
        providerId: viewingAsrId,
        ...viewingAsrCfg,
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

  const localReady =
    modelStatus == null ? null : Boolean(modelStatus.ready);
  const asrHasOnlineForm =
    viewingAsrId === "aliyun-bailian" ||
    viewingAsrId === "tencent-asr" ||
    viewingAsrId === "volcengine-asr";

  return (
    <div>
      <PageHeader
        title="设置"
        description="点左侧查看并编辑渠道，点「设为当前使用」后才会用于练习。密钥自动写入本机。"
      />

      <div className="flex flex-col gap-4">
        <Card className="gap-0 overflow-hidden py-0">
          <div className="grid grid-cols-1 md:grid-cols-[248px_minmax(0,1fr)]">
            <aside className="border-border flex min-w-0 flex-col gap-1 border-b p-3 md:border-r md:border-b-0">
              <div className="text-muted-foreground px-2 pt-1 pb-2 text-sm font-semibold">
                语音渠道
              </div>
              {asrProviderList.map((p) => (
                <ChannelItem
                  key={p.id}
                  name={asrDisplayName(p.id, p.name)}
                  subtitle={asrSubtitle(
                    p.id,
                    settings.asr.providers[p.id] ?? {},
                    p.id === "local-sherpa" ? localReady : undefined,
                  )}
                  selected={p.id === viewingAsrId}
                  inUse={p.id === activeAsrId}
                  onSelect={() => setAsrFocusId(p.id)}
                />
              ))}
            </aside>

            <section className="flex min-w-0 flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="truncate text-lg font-semibold">
                    {asrDisplayName(viewingAsrId, asrMeta?.name ?? viewingAsrId)}
                  </h3>
                  {asrInUse ? (
                    <Badge variant="success">当前使用</Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={activateViewingAsr}
                    >
                      设为当前使用
                    </Button>
                  )}
                </div>
                {!asrIsLocal && ASR_CONSOLE_LINKS[viewingAsrId] && (
                  <a
                    href={ASR_CONSOLE_LINKS[viewingAsrId].href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-primary inline-flex shrink-0 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline"
                  >
                    {ASR_CONSOLE_LINKS[viewingAsrId].short}
                    <ArrowUpRight className="size-4" aria-hidden />
                  </a>
                )}
              </div>
              <p className="text-muted-foreground text-sm">
                {ASR_DESCRIPTIONS[viewingAsrId] ??
                  asrMeta?.name ??
                  "实时语音识别渠道"}
              </p>

              {asrIsLocal ? (
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
                    <p className="text-muted-foreground text-xs">
                      {downloadMsg}
                    </p>
                  )}
                </div>
              ) : asrHasOnlineForm ? (
                <>
                  {viewingAsrId === "aliyun-bailian" && (
                    <div className="flex flex-col gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="asr-apiKey">API Key</Label>
                        <SecretInput
                          id="asr-apiKey"
                          value={String(viewingAsrCfg.apiKey ?? "")}
                          onChange={(v) => updateAsrField("apiKey", v)}
                          placeholder="sk-…（百炼控制台）"
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="asr-base">接口地址（可选）</Label>
                        <Input
                          id="asr-base"
                          value={String(
                            viewingAsrCfg.baseUrl ??
                              "wss://dashscope.aliyuncs.com/api-ws/v1/inference",
                          )}
                          onChange={(e) =>
                            updateAsrField("baseUrl", e.target.value)
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="asr-model">模型</Label>
                        <Input
                          id="asr-model"
                          value={String(viewingAsrCfg.model ?? "")}
                          onChange={(e) =>
                            updateAsrField("model", e.target.value)
                          }
                          placeholder="paraformer-realtime-v2"
                        />
                      </div>
                    </div>
                  )}

                  {viewingAsrId === "tencent-asr" && (
                    <div className="flex flex-col gap-4">
                      <div className="space-y-2">
                        <Label htmlFor="tx-sid">SecretId</Label>
                        <Input
                          id="tx-sid"
                          value={String(viewingAsrCfg.secretId ?? "")}
                          onChange={(e) =>
                            updateAsrField("secretId", e.target.value)
                          }
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="tx-skey">SecretKey</Label>
                        <SecretInput
                          id="tx-skey"
                          value={String(viewingAsrCfg.secretKey ?? "")}
                          onChange={(v) => updateAsrField("secretKey", v)}
                        />
                      </div>
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="tx-app">AppId</Label>
                          <Input
                            id="tx-app"
                            value={String(viewingAsrCfg.appId ?? "")}
                            onChange={(e) =>
                              updateAsrField("appId", e.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="tx-engine">引擎模型</Label>
                          <Input
                            id="tx-engine"
                            value={String(
                              viewingAsrCfg.engineModelType ?? "16k_zh",
                            )}
                            onChange={(e) =>
                              updateAsrField("engineModelType", e.target.value)
                            }
                            placeholder="16k_zh"
                          />
                        </div>
                      </div>
                    </div>
                  )}

                  {viewingAsrId === "volcengine-asr" && (
                    <div className="flex flex-col gap-4">
                      <div className="grid gap-4 sm:grid-cols-2">
                        <div className="space-y-2">
                          <Label htmlFor="volc-app">AppId</Label>
                          <Input
                            id="volc-app"
                            value={String(viewingAsrCfg.appId ?? "")}
                            onChange={(e) =>
                              updateAsrField("appId", e.target.value)
                            }
                          />
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="volc-lang">Language</Label>
                          <Input
                            id="volc-lang"
                            value={String(viewingAsrCfg.language ?? "zh-CN")}
                            onChange={(e) =>
                              updateAsrField("language", e.target.value)
                            }
                          />
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="volc-token">Access Token</Label>
                        <SecretInput
                          id="volc-token"
                          value={String(viewingAsrCfg.accessToken ?? "")}
                          onChange={(v) => updateAsrField("accessToken", v)}
                        />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor="volc-product">已开通产品</Label>
                        <Select
                          value={String(
                            viewingAsrCfg.product || "seed-asr-2-duration",
                          )}
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
                    </div>
                  )}

                  {ASR_CONSOLE_LINKS[viewingAsrId] && (
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      在{" "}
                      <a
                        href={ASR_CONSOLE_LINKS[viewingAsrId].href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-primary underline-offset-4 hover:underline"
                      >
                        {ASR_CONSOLE_LINKS[viewingAsrId].short}
                      </a>{" "}
                      获取密钥。{ASR_CONSOLE_LINKS[viewingAsrId].hint}
                    </p>
                  )}

                  <Button
                    variant="secondary"
                    disabled={asrTesting}
                    onClick={() => void testAsr()}
                    className="w-full"
                  >
                    {asrTesting ? "检测中…" : "检验配置是否可用"}
                  </Button>
                  {asrTestMsg && (
                    <div
                      role="status"
                      className={cn(
                        "min-w-0 max-w-full rounded-lg border px-3 py-2 text-xs leading-relaxed whitespace-normal [overflow-wrap:anywhere]",
                        asrTestMsg.startsWith("✓")
                          ? "border-success/25 bg-success/10 text-success"
                          : "border-warning/30 bg-warning/10 text-warning-foreground",
                      )}
                    >
                      {asrTestMsg}
                    </div>
                  )}
                </>
              ) : (
                <p className="text-muted-foreground text-sm leading-relaxed">
                  该语音渠道尚未接入实时识别，请改用左侧其他渠道，并点「设为当前使用」。
                </p>
              )}
            </section>
          </div>
        </Card>

        <Card className="gap-0 overflow-hidden py-0">
          <div className="grid grid-cols-1 md:grid-cols-[248px_minmax(0,1fr)]">
            <aside className="border-border flex min-w-0 flex-col gap-1 border-b p-3 md:border-r md:border-b-0">
              <div className="text-muted-foreground px-2 pt-1 pb-2 text-sm font-semibold">
                大模型渠道
              </div>
              {builtinLlmList.map((p) => (
                <ChannelItem
                  key={p.id}
                  name={llmDisplayName(p.id, p.name)}
                  subtitle={llmSubtitle(settings.llm.providers[p.id] ?? {})}
                  selected={p.id === viewingLlmId}
                  inUse={p.id === activeLlmId}
                  onSelect={() => setLlmFocusId(p.id)}
                />
              ))}
              {customLlmEntries.map((entry) => (
                <ChannelItem
                  key={entry.id}
                  name={entry.name}
                  subtitle={llmSubtitle(entry.cfg)}
                  selected={entry.id === viewingLlmId}
                  inUse={entry.id === activeLlmId}
                  onSelect={() => setLlmFocusId(entry.id)}
                />
              ))}
              <button
                type="button"
                onClick={addCustomLlmProvider}
                className="text-muted-foreground hover:text-foreground hover:bg-muted/60 mt-1 flex w-full items-center gap-2 rounded-xl border border-dashed border-border px-3 py-2.5 text-sm font-medium transition-colors"
              >
                <Plus className="size-4" aria-hidden />
                添加自定义渠道
              </button>
            </aside>

            <section className="flex min-w-0 flex-col gap-4 p-5">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="flex min-w-0 flex-wrap items-center gap-2">
                  <h3 className="truncate text-lg font-semibold">
                    {viewingLlmName}
                  </h3>
                  {llmInUse ? (
                    <Badge variant="success">当前使用</Badge>
                  ) : (
                    <Button
                      variant="secondary"
                      size="sm"
                      onClick={activateViewingLlm}
                    >
                      设为当前使用
                    </Button>
                  )}
                </div>
                {isCustomChannel && (
                  <Button
                    variant="ghost"
                    size="sm"
                    className="text-destructive hover:text-destructive"
                    onClick={removeCustomLlmProvider}
                  >
                    <Trash2 className="size-4" aria-hidden />
                    删除该渠道
                  </Button>
                )}
              </div>
              <p className="text-muted-foreground text-sm">
                {isCustomChannel
                  ? "OpenAI 兼容的自定义渠道，可连接任意网关或本地服务。先填好再设为当前使用。"
                  : "OpenAI 兼容接口，用于练习评审与对话生成。"}
              </p>

              {isCustomChannel && (
                <div className="space-y-2">
                  <Label htmlFor="custom-name">渠道名称</Label>
                  <Input
                    id="custom-name"
                    value={String(viewingLlmCfg.name ?? "")}
                    onChange={(e) => updateLlmField("name", e.target.value)}
                    placeholder="例如：硅基流动 / 本地 vLLM"
                  />
                </div>
              )}

              <div className="space-y-2">
                <Label htmlFor="apiKey">API Key</Label>
                <SecretInput
                  id="apiKey"
                  value={String(viewingLlmCfg.apiKey ?? "")}
                  onChange={(v) => updateLlmField("apiKey", v)}
                  onBlur={() => void save()}
                  placeholder="sk-..."
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="baseUrl">接口地址（可选）</Label>
                <Input
                  id="baseUrl"
                  value={String(viewingLlmCfg.baseUrl ?? "")}
                  onChange={(e) => updateLlmField("baseUrl", e.target.value)}
                  placeholder={llmHints.baseUrl}
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <Label htmlFor="model">模型</Label>
                  <button
                    type="button"
                    className="text-primary inline-flex shrink-0 items-center gap-1 text-sm font-medium underline-offset-4 hover:underline disabled:pointer-events-none disabled:opacity-50"
                    disabled={modelLoading}
                    onClick={() => void loadLlmModels()}
                  >
                    <RefreshCw
                      className={
                        modelLoading ? "size-3.5 animate-spin" : "size-3.5"
                      }
                      aria-hidden
                    />
                    获取模型
                  </button>
                </div>
                <Input
                  id="model"
                  value={String(viewingLlmCfg.model ?? "")}
                  onChange={(e) => updateLlmField("model", e.target.value)}
                  placeholder={llmHints.model}
                />
                {modelOptions.length > 0 && (
                  <div className="max-h-40 overflow-y-auto rounded-xl border border-border">
                    {modelOptions.map((model) => {
                      const selected =
                        model === String(viewingLlmCfg.model ?? "");
                      return (
                        <button
                          type="button"
                          key={model}
                          onClick={() => updateLlmField("model", model)}
                          className={cn(
                            "hover:bg-muted/60 flex w-full px-3 py-1.5 text-left text-sm",
                            selected && "bg-primary/10 font-medium",
                          )}
                        >
                          {model}
                        </button>
                      );
                    })}
                  </div>
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

              <p className="text-muted-foreground text-xs leading-relaxed">
                可手输模型名，或点「获取模型」后从列表选取。密钥输入后自动保存到本机，失焦时立即落盘。
              </p>

              <Button
                variant="secondary"
                disabled={testing}
                onClick={() => void testLlm()}
                className="w-full"
              >
                {testing ? "测试中…" : "检验连接是否可用"}
              </Button>
              {testMsg && (
                <div
                  role="status"
                  className={cn(
                    "min-w-0 max-w-full rounded-lg border px-3 py-2 text-xs leading-relaxed whitespace-normal [overflow-wrap:anywhere]",
                    testMsg.startsWith("✓")
                      ? "border-success/25 bg-success/10 text-success"
                      : "border-warning/30 bg-warning/10 text-warning-foreground",
                  )}
                >
                  {testMsg}
                </div>
              )}
            </section>
          </div>
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
