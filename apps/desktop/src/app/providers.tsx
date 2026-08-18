import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { useSettingsStore } from "@/state/settingsStore";
import { getCurrentWindow } from "@tauri-apps/api/window";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 1,
    },
  },
});

/** 启动时从本机 SQLite 拉设置（含 API Key） */
function SettingsBootstrap({ children }: { children: ReactNode }) {
  const load = useSettingsStore((s) => s.load);
  const loaded = useSettingsStore((s) => s.loaded);
  const flush = useSettingsStore((s) => s.flush);

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  useEffect(() => {
    const persist = () => {
      if (useSettingsStore.getState().loaded) void flush().catch(() => undefined);
    };
    const onVisibilityChange = () => {
      if (document.visibilityState === "hidden") persist();
    };
    window.addEventListener("beforeunload", persist);
    document.addEventListener("visibilitychange", onVisibilityChange);
    return () => {
      window.removeEventListener("beforeunload", persist);
      document.removeEventListener("visibilitychange", onVisibilityChange);
    };
  }, [flush]);

  useEffect(() => {
    if (!("__TAURI_INTERNALS__" in window)) return;
    let unlisten: (() => void) | undefined;
    const appWindow = getCurrentWindow();
    void appWindow
      .onCloseRequested(async (event) => {
        event.preventDefault();
        try {
          // 尽量在关闭前落盘设置；但绝不阻塞关闭——最多等 1.5s，超时也强制销毁窗口
          await Promise.race([
            flush().catch(() => undefined),
            new Promise((resolve) => window.setTimeout(resolve, 1_500)),
          ]);
        } finally {
          await appWindow.destroy();
        }
      })
      .then((dispose) => {
        unlisten = dispose;
      });
    return () => unlisten?.();
  }, [flush]);

  return children;
}

function HistorySync({ children }: { children: ReactNode }) {
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["history"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    };
    window.addEventListener("showtalk:history-changed", refresh);
    return () => window.removeEventListener("showtalk:history-changed", refresh);
  }, []);

  return children;
}

export function AppProviders({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <SettingsBootstrap>
        <HistorySync>{children}</HistorySync>
      </SettingsBootstrap>
    </QueryClientProvider>
  );
}
