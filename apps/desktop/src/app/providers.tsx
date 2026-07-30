import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useEffect, type ReactNode } from "react";
import { useSettingsStore } from "@/state/settingsStore";

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

  useEffect(() => {
    if (!loaded) void load();
  }, [loaded, load]);

  return children;
}

function HistorySync({ children }: { children: ReactNode }) {
  useEffect(() => {
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: ["history"] });
      void queryClient.invalidateQueries({ queryKey: ["profile"] });
    };
    window.addEventListener("expr-talk:history-changed", refresh);
    return () => window.removeEventListener("expr-talk:history-changed", refresh);
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
