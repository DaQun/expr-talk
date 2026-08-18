import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useInfiniteQuery, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  practiceModeLabel,
  type SessionStatus,
  type TrainingSession,
} from "@showtalk/shared";
import { Archive, History, Search, Trash2 } from "lucide-react";
import { api } from "@/ipc/client";
import { useSessionStore } from "@/state/sessionStore";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const PAGE_SIZE = 30;

const STATUS_LABELS: Record<SessionStatus, string> = {
  created: "已创建",
  recording: "录音中",
  transcribing: "转写中",
  analyzing: "分析中",
  debating: "辩论中",
  failed: "已中断/失败",
  reviewed: "已复盘",
  retrying: "复练中",
  completed: "已完成",
};

function formatTime(iso: string): string {
  const time = Date.parse(iso);
  if (!Number.isFinite(time)) return iso;
  const date = new Date(time);
  const sameYear = date.getFullYear() === new Date().getFullYear();
  return date.toLocaleString(undefined, {
    ...(sameYear ? {} : { year: "numeric" as const }),
    month: "numeric",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function statusVariant(status: string): "success" | "warning" | "secondary" {
  if (status === "reviewed" || status === "completed") return "success";
  if (["analyzing", "transcribing", "recording", "debating", "failed"].includes(status)) {
    return "warning";
  }
  return "secondary";
}

export function HistoryPage() {
  const queryClient = useQueryClient();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [pendingDelete, setPendingDelete] = useState<TrainingSession | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [clearText, setClearText] = useState("");
  const [deleting, setDeleting] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [exporting, setExporting] = useState(false);
  const [exportPath, setExportPath] = useState<string | null>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setSearch(searchInput.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const historyQuery = useInfiniteQuery({
    queryKey: ["history", search],
    initialPageParam: 0,
    queryFn: ({ pageParam }) =>
      api.listHistory({ limit: PAGE_SIZE, offset: pageParam, search: search || undefined }),
    getNextPageParam: (lastPage, pages) =>
      lastPage.length === PAGE_SIZE ? pages.length * PAGE_SIZE : undefined,
    staleTime: 60_000,
    refetchOnWindowFocus: false,
  });
  const statsQuery = useQuery({
    queryKey: ["history-storage"],
    queryFn: () => api.historyStorageStats(),
    staleTime: 30_000,
  });
  const items = useMemo(
    () => historyQuery.data?.pages.flat() ?? [],
    [historyQuery.data],
  );

  useEffect(() => {
    if (!pendingDelete && !confirmClear) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || deleting) return;
      setPendingDelete(null);
      setConfirmClear(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingDelete, confirmClear, deleting]);

  async function refreshProductData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["history"] }),
      queryClient.invalidateQueries({ queryKey: ["history-storage"] }),
      queryClient.invalidateQueries({ queryKey: ["profile"] }),
    ]);
  }

  async function deleteSession() {
    if (!pendingDelete || deleting) return;
    const id = pendingDelete.id;
    setDeleting(true);
    setOperationError(null);
    try {
      await api.deleteSession(id);
      if (useSessionStore.getState().current?.id === id) {
        const lastWavUrl = useSessionStore.getState().lastWavUrl;
        if (lastWavUrl) URL.revokeObjectURL(lastWavUrl);
        useSessionStore.setState({
          current: null,
          report: null,
          comparison: null,
          lastWavUrl: null,
          lastAudioPath: null,
          error: null,
          analyzeNote: null,
        });
      }
      setPendingDelete(null);
      await refreshProductData();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  }

  async function clearAll() {
    if (clearText !== "清空全部" || deleting) return;
    setDeleting(true);
    setOperationError(null);
    try {
      await api.deleteAllSessions();
      useSessionStore.setState({
        current: null,
        report: null,
        comparison: null,
        lastWavUrl: null,
        lastAudioPath: null,
        error: null,
        analyzeNote: null,
      });
      setConfirmClear(false);
      setClearText("");
      await refreshProductData();
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setDeleting(false);
    }
  }

  async function exportHistory() {
    setExporting(true);
    setOperationError(null);
    setExportPath(null);
    try {
      setExportPath(await api.exportHistory());
    } catch (error) {
      setOperationError(error instanceof Error ? error.message : String(error));
    } finally {
      setExporting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="历史"
        description="搜索、回看和管理保存在本机的练习记录。"
        action={
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" disabled={exporting} onClick={() => void exportHistory()}>
              <Archive data-icon="inline-start" />
              {exporting ? "备份中…" : "导出备份"}
            </Button>
            <Button
              variant="ghost"
              size="sm"
              disabled={historyQuery.isFetching}
              onClick={() => void refreshProductData()}
            >
              {historyQuery.isFetching ? "刷新中…" : "刷新"}
            </Button>
          </div>
        }
      />

      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-3">
          <div className="relative min-w-60 flex-1">
            <Search className="text-muted-foreground pointer-events-none absolute top-1/2 left-3 -translate-y-1/2" />
            <Input
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="搜索练习题目"
              aria-label="搜索练习题目"
              className="pl-9"
            />
          </div>
          {statsQuery.data && (
            <span className="text-muted-foreground text-sm">
              {statsQuery.data.sessionCount} 条记录 · {statsQuery.data.audioCount} 个录音 · {formatBytes(statsQuery.data.audioBytes)}
            </span>
          )}
          <Button
            variant="ghost"
            size="sm"
            className="text-destructive"
            disabled={!statsQuery.data?.sessionCount}
            onClick={() => {
              setOperationError(null);
              setConfirmClear(true);
            }}
          >
            <Trash2 data-icon="inline-start" /> 清空全部
          </Button>
        </div>

        {exportPath && (
          <Alert>
            <AlertTitle>备份已生成</AlertTitle>
            <AlertDescription className="break-all">{exportPath}</AlertDescription>
          </Alert>
        )}
        {operationError && !pendingDelete && !confirmClear && (
          <Alert variant="destructive">
            <AlertTitle>操作失败</AlertTitle>
            <AlertDescription>{operationError}</AlertDescription>
          </Alert>
        )}
      </div>

      {historyQuery.isLoading && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="加载中">
          {[0, 1, 2].map((index) => <Skeleton key={index} className="h-[72px] w-full" />)}
        </div>
      )}

      {historyQuery.error && (
        <Alert variant="destructive" className="mb-3">
          <AlertTitle>历史记录加载失败</AlertTitle>
          <AlertDescription>{String(historyQuery.error)}</AlertDescription>
        </Alert>
      )}

      {!historyQuery.isLoading && items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/15 text-primary border-primary/20 grid size-13 place-items-center rounded-lg border">
              <History />
            </div>
            <h2 className="text-lg font-semibold">{search ? "没有匹配的记录" : "还没有练习记录"}</h2>
            <p className="text-muted-foreground max-w-md text-sm">
              {search ? "换一个关键词试试。" : "完成一次练习后，摘要会出现在这里。"}
            </p>
            {!search && <Button asChild><Link to="/practice">开始第一次练习</Link></Button>}
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((session) => {
            const statusLabel = STATUS_LABELS[session.status as SessionStatus] ?? session.status;
            const comparisonBadge = session.comparison
              ? session.comparison.improved
                ? { variant: "success" as const, text: "有进步" }
                : { variant: "warning" as const, text: "再练一轮" }
              : null;
            return (
              <div key={session.id} className={cn("bg-card group flex min-w-0 items-stretch rounded-lg border border-border transition-all hover:-translate-y-px")}>
                <Link
                  to={session.status === "debating" ? `/practice?resume=${encodeURIComponent(session.id)}` : `/review/${session.id}`}
                  className="flex min-w-0 flex-1 items-start justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.95rem] font-semibold">{session.topic || "未命名练习"}</div>
                    <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
                      <span>{practiceModeLabel(session.mode) ?? session.mode}</span>
                      <Badge variant={statusVariant(session.status)}>{statusLabel}</Badge>
                      {session.round && session.round > 1 && <Badge variant="warning">复练 R{session.round}</Badge>}
                      <span>{formatTime(session.startedAt)}</span>
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1.5">
                    {comparisonBadge && (
                      <Badge variant={comparisonBadge.variant}>
                        {comparisonBadge.text}
                      </Badge>
                    )}
                    {session.metrics && (
                      <span className="text-muted-foreground text-xs tabular-nums">
                        填充词 {session.metrics.fillerCount}
                      </span>
                    )}
                  </div>
                </Link>
                <div className="flex items-center border-l border-border px-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="text-muted-foreground hover:text-destructive"
                    aria-label={`删除${session.topic || "未命名练习"}`}
                    title="删除记录"
                    onClick={() => {
                      setOperationError(null);
                      setPendingDelete(session);
                    }}
                  >
                    <Trash2 />
                  </Button>
                </div>
              </div>
            );
          })}
          {historyQuery.hasNextPage && (
            <Button variant="outline" disabled={historyQuery.isFetchingNextPage} onClick={() => void historyQuery.fetchNextPage()}>
              {historyQuery.isFetchingNextPage ? "加载中…" : "加载更多"}
            </Button>
          )}
        </div>
      )}

      {pendingDelete && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4 backdrop-blur-[2px]" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="delete-history-title" className="bg-card w-full max-w-sm rounded-lg border border-border p-5 shadow-2xl">
            <h2 id="delete-history-title" className="m-0 text-lg font-semibold">删除这条复盘记录？</h2>
            <p className="text-muted-foreground mt-2 mb-0 text-sm leading-relaxed">
              “{pendingDelete.topic || "未命名练习"}”的报告、逐字稿和本地录音将被永久删除。已有复练的对比快照会保留。
            </p>
            {operationError && <p className="text-destructive mt-3 mb-0 text-sm">{operationError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" disabled={deleting} onClick={() => setPendingDelete(null)}>取消</Button>
              <Button variant="destructive" disabled={deleting} onClick={() => void deleteSession()}>{deleting ? "删除中…" : "确认删除"}</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}

      {confirmClear && createPortal(
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4 backdrop-blur-[2px]" role="presentation">
          <div role="alertdialog" aria-modal="true" aria-labelledby="clear-history-title" className="bg-card w-full max-w-sm rounded-lg border border-border p-5 shadow-2xl">
            <h2 id="clear-history-title" className="m-0 text-lg font-semibold">清空所有本地训练数据？</h2>
            <p className="text-muted-foreground mt-2 mb-0 text-sm leading-relaxed">这会永久删除全部报告、逐字稿和录音。建议先导出备份。输入“清空全部”继续。</p>
            <Input className="mt-4" value={clearText} onChange={(event) => setClearText(event.target.value)} placeholder="清空全部" autoFocus />
            {operationError && <p className="text-destructive mt-3 mb-0 text-sm">{operationError}</p>}
            <div className="mt-5 flex justify-end gap-2">
              <Button variant="secondary" disabled={deleting} onClick={() => setConfirmClear(false)}>取消</Button>
              <Button variant="destructive" disabled={deleting || clearText !== "清空全部"} onClick={() => void clearAll()}>{deleting ? "清空中…" : "永久清空"}</Button>
            </div>
          </div>
        </div>,
        document.body,
      )}
    </div>
  );
}
