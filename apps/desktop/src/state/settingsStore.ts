import { create } from "zustand";
import { DEFAULT_SETTINGS, type AppSettings } from "@showtalk/shared";
import { api } from "../ipc/client";

type SettingsState = {
  settings: AppSettings;
  loaded: boolean;
  /** 正在写入本机数据库 */
  saving: boolean;
  /** 最近一次成功落盘时间 */
  lastSavedAt: number | null;
  saveError: string | null;
  load: () => Promise<void>;
  save: (settings?: AppSettings) => Promise<void>;
  flush: () => Promise<void>;
  /** 改内存并防抖自动写入 SQLite */
  patch: (partial: Partial<AppSettings>) => void;
};

let saveTimer: ReturnType<typeof setTimeout> | null = null;
const SAVE_DEBOUNCE_MS = 450;

function mergeSettings(
  base: AppSettings,
  partial: Partial<AppSettings>,
): AppSettings {
  return {
    ...base,
    ...partial,
    asr: partial.asr
      ? {
          ...base.asr,
          ...partial.asr,
          providers: {
            ...base.asr.providers,
            ...(partial.asr.providers ?? {}),
          },
        }
      : base.asr,
    llm: partial.llm
      ? {
          ...base.llm,
          ...partial.llm,
          providers: {
            ...base.llm.providers,
            ...(partial.llm.providers ?? {}),
          },
        }
      : base.llm,
    privacy: partial.privacy
      ? { ...base.privacy, ...partial.privacy }
      : base.privacy,
  };
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  settings: DEFAULT_SETTINGS,
  loaded: false,
  saving: false,
  lastSavedAt: null,
  saveError: null,

  load: async () => {
    try {
      const settings = await api.getSettings();
      set({ settings, loaded: true, saveError: null });
    } catch (e) {
      set({
        loaded: true,
        saveError: e instanceof Error ? e.message : String(e),
      });
    }
  },

  save: async (settings) => {
    const next = settings ?? get().settings;
    set({ saving: true, saveError: null });
    try {
      await api.saveSettings(next);
      set({
        settings: next,
        saving: false,
        lastSavedAt: Date.now(),
        saveError: null,
      });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      set({ saving: false, saveError: msg });
      throw e;
    }
  },

  flush: async () => {
    if (saveTimer != null) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    await get().save(get().settings);
  },

  patch: (partial) => {
    const next = mergeSettings(get().settings, partial);
    set({ settings: next });

    if (saveTimer != null) clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      saveTimer = null;
      void get()
        .save(get().settings)
        .catch(() => {
          // saveError 已写入 store，设置页会展示
        });
    }, SAVE_DEBOUNCE_MS);
  },
}));
