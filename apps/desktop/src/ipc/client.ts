import { invoke } from "@tauri-apps/api/core";
import type {
  AppSettings,
  ASRConfig,
  ASRProviderInfo,
  CreateSessionInput,
  HistoryQuery,
  LLMConfig,
  LLMProviderInfo,
  StructuredReport,
  TestResult,
  TrainingSession,
  TranscriptSegment,
  UserProfile,
} from "@showtalk/shared";
import { DEFAULT_SETTINGS } from "@showtalk/shared";
import { getASRProvider, listASRProviders } from "@showtalk/asr";
import { getLLMProvider, listLLMProviders } from "@showtalk/llm";
import type { LLMStreamProgress } from "@showtalk/llm";
import {
  InMemoryDb,
  SessionRepository,
  SettingsRepository,
} from "@showtalk/storage";
import {
  analyzeSession,
  generateDebateQuestion,
  generateFeynmanQuestion,
} from "../services/analyze";
import { buildUserProfile } from "@showtalk/core";
import { withTimeout } from "../utils/timeout";

const memoryDb = new InMemoryDb();
const memorySessions = new SessionRepository(memoryDb);
const memorySettings = new SettingsRepository(memoryDb);

function isTauri(): boolean {
  return typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;
}

async function tryInvoke<T>(
  cmd: string,
  args?: Record<string, unknown>,
  timeoutMs = 5_000,
): Promise<T | undefined> {
  if (!isTauri()) return undefined;
  try {
    return await withTimeout(invoke<T>(cmd, args), timeoutMs, `IPC ${cmd}`);
  } catch (e) {
    console.warn(`invoke ${cmd} failed`, e);
    return undefined;
  }
}

function createId(): string {
  return `ses_${Math.random().toString(36).slice(2, 12)}`;
}

/** 始终写入内存；完整报告默认等待 SQLite，保证历史能读到 */
async function persistSession(
  session: TrainingSession,
  opts?: { awaitSqlite?: boolean },
): Promise<TrainingSession> {
  const local = await memorySessions.update(session);
  if (!isTauri()) return local;

  // 有 report/metrics 的完整 session 默认等写入；临时录音中可 fire-and-forget
  const shouldAwait =
    opts?.awaitSqlite ??
    Boolean(local.report || local.metrics || local.comparison || local.debate);

  if (shouldAwait) {
    const saved = await withTimeout(
      invoke<TrainingSession>("session_upsert", { session: local }),
      5_000,
      "保存练习记录",
    );
    return saved;
  }

  void tryInvoke("session_upsert", { session: local }, 3_000);
  return local;
}

export type StopRecordingOptions = {
  finalTranscript?: string;
  audioFile?: string;
  /** null 表示纯文本输入，明确没有可用口述时长。 */
  durationSec?: number | null;
  liveTranscript?: TranscriptSegment[];
};

export type HistoryStorageStats = {
  sessionCount: number;
  audioCount: number;
  audioBytes: number;
};

export const api = {
  isTauri,

  async createSession(input: CreateSessionInput): Promise<TrainingSession> {
    const session: TrainingSession = {
      id: createId(),
      mode: input.mode,
      topic: input.topic,
      goal: input.goal,
      status: "created",
      startedAt: new Date().toISOString(),
      liveTranscript: [],
      parentSessionId: input.parentSessionId,
      round: input.round,
    };
    return persistSession(session);
  },

  async startRecording(id: string): Promise<void> {
    const s = (await memorySessions.get(id)) ?? (await api.getSession(id));
    if (!s) throw new Error(`session not found: ${id}`);
    s.status = "recording";
    s.startedAt = new Date().toISOString();
    await persistSession(s);
  },

  async stopRecording(
    id: string,
    options: StopRecordingOptions = {},
  ): Promise<TrainingSession> {
    let s =
      (await memorySessions.get(id)) ??
      (await tryInvoke<TrainingSession | null>("history_get", { id }, 3_000)) ??
      null;
    if (!s) {
      // 分析路径允许用最小 session
      s = {
        id,
        mode: "free",
        topic: "",
        goal: "",
        status: "analyzing",
        startedAt: new Date().toISOString(),
        liveTranscript: options.liveTranscript ?? [],
      };
    }
    const endedAt = new Date().toISOString();
    const fallbackDuration = Math.max(
      1,
      Math.round((Date.parse(endedAt) - Date.parse(s.startedAt)) / 1000),
    );
    s.status = "analyzing";
    s.endedAt = endedAt;
    if (options.durationSec === null) {
      s.durationSec = undefined;
    } else {
      s.durationSec =
        options.durationSec !== undefined
          ? Math.max(1, Math.round(options.durationSec))
          : fallbackDuration;
    }
    if (options.audioFile) s.audioFile = options.audioFile;
    if (options.liveTranscript) s.liveTranscript = options.liveTranscript;
    if (options.finalTranscript != null && options.finalTranscript.length > 0) {
      s.finalTranscript = options.finalTranscript;
    } else {
      s.finalTranscript = s.liveTranscript
        .filter((seg) => seg.isFinal)
        .map((seg) => seg.text)
        .join("");
    }
    return persistSession(s);
  },

  /**
   * 分析：强制大模型评审。未配置或失败时抛错，不写规则报告。
   */
  async analyze(
    id: string,
    override?: Partial<TrainingSession>,
    onProgress?: (progress: LLMStreamProgress) => void,
  ): Promise<StructuredReport> {
    let s =
      (await memorySessions.get(id)) ??
      (await tryInvoke<TrainingSession | null>("history_get", { id }, 3_000)) ??
      null;

    if (!s && override) {
      s = {
        id,
        mode: "free",
        topic: "",
        goal: "",
        status: "analyzing",
        startedAt: new Date().toISOString(),
        liveTranscript: [],
        ...override,
      } as TrainingSession;
    }
    if (!s) throw new Error(`session not found: ${id}`);
    if (override) s = { ...s, ...override };

    const settings = await api.getSettings();
    // 仅大模型；失败抛给上层（不降级规则报告）
    const result = await analyzeSession(s, settings, onProgress);

    s.metrics = result.metrics;
    s.report = result.report;
    s.status = "reviewed";
    await persistSession(s);
    window.dispatchEvent(new Event("showtalk:history-changed"));
    return result.report;
  },

  async generateDebateQuestion(
    session: TrainingSession,
    onProgress?: (progress: LLMStreamProgress) => void,
  ) {
    if (!session.debate) throw new Error("缺少辩论上下文");
    const settings = await api.getSettings();
    return generateDebateQuestion(session, session.debate, settings, onProgress);
  },

  async generateFeynmanQuestion(
    session: TrainingSession,
    onProgress?: (progress: LLMStreamProgress) => void,
  ) {
    if (!session.debate) throw new Error("缺少费曼学习上下文");
    const settings = await api.getSettings();
    return generateFeynmanQuestion(session, session.debate, settings, onProgress);
  },

  async listHistory(query?: HistoryQuery): Promise<TrainingSession[]> {
    // 1) 内存先出，保证首屏不空等
    const mem = await memorySessions.list(query);

    if (!isTauri()) return mem;

    // 2) SQLite 摘要列表（轻量）；失败则回落内存
    const q = {
      limit: query?.limit ?? 30,
      offset: query?.offset ?? 0,
      mode: query?.mode ?? null,
      search: query?.search ?? null,
    };
    try {
      const remote = await withTimeout(
        invoke<TrainingSession[]>("history_list", { query: q }),
        2_000,
        "history_list",
      );
      // 合并：远端为主，内存里更新的补充进去
      if (Array.isArray(remote)) {
        const map = new Map<string, TrainingSession>();
        for (const s of remote) map.set(s.id, s);
        for (const s of mem) {
          const prev = map.get(s.id);
          // 内存若有更完整 metrics/report，保留展示用摘要字段
          if (!prev) map.set(s.id, s);
          else if (s.metrics && !prev.metrics) {
            map.set(s.id, {
              ...prev,
              metrics: s.metrics,
              comparison: s.comparison ?? prev.comparison,
            });
          }
        }
        return [...map.values()].sort((a, b) =>
          b.startedAt.localeCompare(a.startedAt),
        );
      }
    } catch (e) {
      console.warn("history_list slow/fail, use memory", e);
    }
    return mem;
  },

  async getProfile(): Promise<UserProfile> {
    const memory = await memorySessions.list({ limit: 500 });
    if (!isTauri()) return buildUserProfile(memory);
    const persisted = await tryInvoke<TrainingSession[]>(
      "profile_sessions",
      undefined,
      5_000,
    );
    if (!persisted) return buildUserProfile(memory);
    const merged = new Map(persisted.map((session) => [session.id, session]));
    for (const session of memory) merged.set(session.id, session);
    return buildUserProfile([...merged.values()]);
  },

  async getSession(id: string): Promise<TrainingSession | null> {
    const mem = await memorySessions.get(id);
    if (mem) return mem;
    if (isTauri()) {
      const remote = await tryInvoke<TrainingSession | null>(
        "history_get",
        { id },
        3_000,
      );
      if (remote) {
        await memorySessions.update(remote);
        return remote;
      }
    }
    return null;
  },

  async listAsrProviders(): Promise<ASRProviderInfo[]> {
    const remote = await tryInvoke<ASRProviderInfo[]>(
      "asr_list_providers",
      undefined,
      3_000,
    );
    if (remote) return remote;
    return listASRProviders();
  },

  async testAsr(config: ASRConfig): Promise<TestResult> {
    // Rust 侧读取 providerId + 扁平字段（apiKey/secretId/...）
    const providerFields = config as ASRConfig & Record<string, unknown>;
    const remote = await tryInvoke<TestResult>(
      "asr_test_provider",
      {
        config: {
          ...providerFields,
          providerId: config.providerId,
          ...(config.extra ?? {}),
          apiKey: config.apiKey,
          baseUrl: config.baseUrl,
          model: config.model,
        },
      },
      10_000,
    );
    if (remote) return remote;
    const p = getASRProvider(config.providerId);
    if (p) return p.testConnection(config);
    return { ok: false, message: "浏览器模式下无法测试 ASR" };
  },

  async listLlmProviders(): Promise<LLMProviderInfo[]> {
    return listLLMProviders();
  },

  async listLlmModels(config: LLMConfig): Promise<string[]> {
    const baseUrl = config.baseUrl?.trim();
    if (!baseUrl) throw new Error("请先填写 LLM Base URL");

    if (isTauri()) {
      return withTimeout(
        invoke<string[]>("llm_list_models", {
          baseUrl,
          apiKey: config.apiKey || null,
        }),
        35_000,
        "获取模型列表",
      );
    }

    const url = `${baseUrl.replace(/\/+$/, "")}/models`;
    const headers: Record<string, string> = {};
    if (config.apiKey?.trim()) {
      headers.Authorization = `Bearer ${config.apiKey.trim()}`;
    }
    const response = await fetch(url, { headers });
    const body: unknown = await response.json().catch(() => null);
    if (!response.ok) {
      throw new Error(`获取模型列表失败（HTTP ${response.status}）`);
    }
    const items = Array.isArray(body)
      ? body
      : body && typeof body === "object"
        ? ((body as { data?: unknown[]; models?: unknown[] }).data ??
          (body as { models?: unknown[] }).models)
        : undefined;
    if (!Array.isArray(items)) {
      throw new Error("模型列表响应缺少 data 或 models 数组");
    }
    const models = items
      .map((item) => {
        if (typeof item === "string") return item;
        if (!item || typeof item !== "object") return "";
        const model = item as { id?: unknown; name?: unknown; model?: unknown };
        const id = model.id ?? model.name ?? model.model;
        return typeof id === "string" ? id : "";
      })
      .map((id) => id.trim())
      .filter(Boolean)
      .sort();
    const uniqueModels = [...new Set(models)];
    if (uniqueModels.length === 0) throw new Error("接口未返回可用模型");
    return uniqueModels;
  },

  async testLlm(config: LLMConfig): Promise<TestResult> {
    const provider = getLLMProvider(config.providerId);
    if (!provider) return { ok: false, message: "未知 LLM provider" };
    try {
      return await withTimeout(
        provider.testConnection(config),
        10_000,
        "LLM 连接测试",
      );
    } catch (e) {
      return {
        ok: false,
        message: e instanceof Error ? e.message : String(e),
      };
    }
  },

  async getSettings(): Promise<AppSettings> {
    if (isTauri()) {
      // 不要吞错：读库失败应抛出，避免误以为「没有配置」
      const remote = await withTimeout(
        invoke<AppSettings | null>("settings_get"),
        3_000,
        "读取设置",
      );
      if (remote && typeof remote === "object") {
        const merged: AppSettings = {
          ...DEFAULT_SETTINGS,
          ...remote,
          asr: {
            ...DEFAULT_SETTINGS.asr,
            ...(remote.asr ?? {}),
            providers: {
              ...DEFAULT_SETTINGS.asr.providers,
              ...(remote.asr?.providers ?? {}),
            },
          },
          llm: {
            ...DEFAULT_SETTINGS.llm,
            ...(remote.llm ?? {}),
            providers: {
              ...DEFAULT_SETTINGS.llm.providers,
              ...(remote.llm?.providers ?? {}),
            },
          },
          privacy: {
            ...DEFAULT_SETTINGS.privacy,
            ...(remote.privacy ?? {}),
          },
        };
        // 同步一份到内存，供非 Tauri 路径兜底
        await memorySettings.save(merged);
        return merged;
      }
    }
    return memorySettings.get();
  },

  async saveSettings(settings: AppSettings): Promise<void> {
    await memorySettings.save(settings);
    if (isTauri()) {
      // 必须真正写入 SQLite；失败要抛给上层，不能只 console.warn
      await withTimeout(
        invoke("settings_save", { settings }),
        4_000,
        "保存设置",
      );
    }
  },

  async injectPasteTranscript(
    id: string,
    text: string,
  ): Promise<TrainingSession> {
    let s = await memorySessions.get(id);
    if (!s) {
      s = {
        id,
        mode: "free",
        topic: "",
        goal: "",
        status: "created",
        startedAt: new Date().toISOString(),
        liveTranscript: [],
      };
    }
    const timing = s.durationSec
      ? { startMs: 0, endMs: s.durationSec * 1000 }
      : {};
    s.liveTranscript = [
      {
        id: `seg_${Date.now()}`,
        text,
        isFinal: true,
        ...timing,
      },
    ];
    s.finalTranscript = text;
    s.inputSource = "paste";
    return persistSession(s);
  },

  async updateSession(session: TrainingSession): Promise<TrainingSession> {
    return persistSession(session);
  },

  async deleteSession(id: string): Promise<void> {
    if (isTauri()) {
      await withTimeout(
        invoke("session_delete_complete", { id }),
        15_000,
        "删除练习记录和录音",
      );
    }
    await memorySessions.delete(id);
    const cached = await memorySessions.list({ limit: 10_000 });
    await Promise.all(
      cached
        .filter((session) => session.parentSessionId === id)
        .map((session) =>
          memorySessions.update({
            ...session,
            parentSessionId: undefined,
            comparison: session.comparison
              ? { ...session.comparison, parentAvailable: false }
              : undefined,
          }),
        ),
    );
  },

  async deleteAllSessions(): Promise<void> {
    if (isTauri()) {
      await withTimeout(
        invoke("session_delete_complete", { id: null }),
        30_000,
        "清空练习记录和录音",
      );
    }
    const sessions = await memorySessions.list({ limit: 10_000 });
    await Promise.all(sessions.map((session) => memorySessions.delete(session.id)));
  },

  async historyStorageStats(): Promise<HistoryStorageStats> {
    if (!isTauri()) {
      const sessions = await memorySessions.list({ limit: 10_000 });
      return { sessionCount: sessions.length, audioCount: 0, audioBytes: 0 };
    }
    return withTimeout(
      invoke<HistoryStorageStats>("history_storage_stats"),
      5_000,
      "读取存储占用",
    );
  },

  async exportHistory(): Promise<string> {
    if (!isTauri()) throw new Error("完整备份仅桌面端可用");
    return withTimeout(
      invoke<string>("history_export"),
      120_000,
      "导出练习备份",
    );
  },
};
