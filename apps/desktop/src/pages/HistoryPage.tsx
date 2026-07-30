import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import {
  practiceModeLabel,
  type SessionStatus,
  type TrainingSession,
} from "@expr-talk/shared";
import { History, Trash2 } from "lucide-react";
import { api } from "@/ipc/client";
import { useSessionStore } from "@/state/sessionStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

const STATUS_LABELS: Record<SessionStatus, string> = {
  created: "已创建",
  recording: "录音中",
  transcribing: "转写中",
  analyzing: "分析中",
  debating: "辩论中",
  failed: "处理失败",
  reviewed: "已复盘",
  retrying: "复练中",
  completed: "已完成",
};

function formatTime(iso: string): string {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return iso;
  try {
    return new Date(t).toLocaleString(undefined, {
      month: "numeric",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
}

function statusVariant(
  status: string,
): "success" | "warning" | "secondary" {
  if (status === "reviewed" || status === "completed") return "success";
  if (
    status === "analyzing" ||
    status === "transcribing" ||
    status === "recording" ||
    status === "debating"
  )
    return "warning";
  if (status === "failed") return "warning";
  return "secondary";
}

export function HistoryPage() {
  const queryClient = useQueryClient();
  const [pendingDelete, setPendingDelete] = useState<TrainingSession | null>(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["history"],
    queryFn: () => api.listHistory({ limit: 30 }),
    staleTime: 60_000,
    placeholderData: (prev) => prev,
    refetchOnWindowFocus: false,
  });

  const showInitialLoading = isLoading && !data;
  const items = data ?? [];

  useEffect(() => {
    if (!pendingDelete) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !deleting) setPendingDelete(null);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [pendingDelete, deleting]);

  async function deleteSession() {
    if (!pendingDelete || deleting) return;
    const id = pendingDelete.id;
    setDeleting(true);
    setDeleteError(null);
    try {
      await api.deleteSession(id);
      queryClient.setQueryData<TrainingSession[]>(["history"], (previous) =>
        previous?.filter((session) => session.id !== id),
      );
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
      await queryClient.invalidateQueries({ queryKey: ["profile"] });
      setPendingDelete(null);
    } catch (e) {
      setDeleteError(e instanceof Error ? e.message : String(e));
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div>
      <PageHeader
        title="历史"
        description="本地训练记录。列表只加载摘要，点进去再看完整报告。"
        action={
          <Button
            variant="ghost"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            {isFetching ? "刷新中…" : "刷新"}
          </Button>
        }
      />

      {showInitialLoading && (
        <div className="flex flex-col gap-2" aria-busy="true" aria-label="加载中">
          {[0, 1, 2].map((i) => (
            <Skeleton key={i} className="h-[72px] w-full" />
          ))}
        </div>
      )}

      {error && (
        <div className="bg-destructive/10 text-destructive border-destructive/30 mb-3 rounded-lg border px-3.5 py-3 text-sm">
          {String(error)}
        </div>
      )}

      {deleteError && !pendingDelete && (
        <div className="bg-destructive/10 text-destructive border-destructive/30 mb-3 rounded-lg border px-3.5 py-3 text-sm">
          {deleteError}
        </div>
      )}

      {!showInitialLoading && items.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/15 text-primary border-primary/20 grid size-13 place-items-center rounded-2xl border">
              <History className="size-5" />
            </div>
            <h2 className="text-lg font-semibold">还没有练习记录</h2>
            <p className="text-muted-foreground max-w-md text-sm">
              完成一次录音分析后，摘要会出现在这里，方便回看与复练对比。
            </p>
            <Button asChild className="mt-1">
              <Link to="/practice">开始第一次练习</Link>
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((s) => {
            const statusLabel =
              STATUS_LABELS[s.status as SessionStatus] ?? s.status;
            const side =
              s.comparison != null
                ? s.comparison.improved
                  ? { variant: "success" as const, text: "复练有进步" }
                  : { variant: "warning" as const, text: "复练对比" }
                : s.metrics
                  ? { variant: "default" as const, text: `填充词 ${s.metrics.fillerCount}` }
                  : { variant: "secondary" as const, text: "无指标" };

            return (
              <div
                key={s.id}
                className={cn(
                  "bg-card hover:border-border group flex min-w-0 items-stretch rounded-lg border border-border transition-all hover:-translate-y-px",
                )}
              >
                <Link
                  to={
                    s.status === "debating"
                      ? `/practice?resume=${encodeURIComponent(s.id)}`
                      : `/review/${s.id}`
                  }
                  className="flex min-w-0 flex-1 items-start justify-between gap-3 px-4 py-3.5"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[0.95rem] font-semibold">
                      {s.topic || "未命名练习"}
                    </div>
                    <div className="text-muted-foreground mt-1 flex flex-wrap items-center gap-x-2.5 gap-y-1.5 text-xs">
                      <span>{practiceModeLabel(s.mode) ?? s.mode}</span>
                      <Badge variant={statusVariant(s.status)}>
                        {statusLabel}
                      </Badge>
                      {s.parentSessionId ? (
                        <Badge variant="warning">复练 R{s.round ?? "?"}</Badge>
                      ) : s.round && s.round > 1 ? (
                        <Badge variant="warning">R{s.round}</Badge>
                      ) : null}
                      <span className="text-muted-foreground/80">
                        {formatTime(s.startedAt)}
                      </span>
                    </div>
                  </div>
                  <Badge variant={side.variant} className="shrink-0">
                    {side.text}
                  </Badge>
                </Link>
                <div className="flex items-center border-l border-border px-2">
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon"
                    className="size-9 text-muted-foreground hover:text-destructive"
                    aria-label={`删除${s.topic || "未命名练习"}`}
                    title="删除记录"
                    onClick={() => {
                      setDeleteError(null);
                      setPendingDelete(s);
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {pendingDelete &&
        createPortal(
          <div
            className="fixed inset-0 z-50 grid place-items-center bg-black/35 p-4 backdrop-blur-[2px]"
            role="presentation"
            onMouseDown={(event) => {
              if (event.target === event.currentTarget && !deleting) {
                setPendingDelete(null);
              }
            }}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-history-title"
              aria-describedby="delete-history-description"
              className="bg-card w-full max-w-sm rounded-xl border border-border p-5 shadow-2xl"
            >
              <h2 id="delete-history-title" className="m-0 text-lg font-semibold">
                删除这条复盘记录？
              </h2>
              <p
                id="delete-history-description"
                className="text-muted-foreground mt-2 mb-0 text-sm leading-relaxed"
              >
                “{pendingDelete.topic || "未命名练习"}”的报告、逐字稿和本地录音将被永久删除，无法恢复。
              </p>
              {deleteError && (
                <p className="text-destructive mt-3 mb-0 text-sm" role="alert">
                  {deleteError}
                </p>
              )}
              <div className="mt-5 flex justify-end gap-2">
                <Button
                  variant="secondary"
                  disabled={deleting}
                  autoFocus
                  onClick={() => setPendingDelete(null)}
                >
                  取消
                </Button>
                <Button
                  variant="destructive"
                  disabled={deleting}
                  onClick={() => void deleteSession()}
                >
                  {deleting ? "删除中…" : "确认删除"}
                </Button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </div>
  );
}
