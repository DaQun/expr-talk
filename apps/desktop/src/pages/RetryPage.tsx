import { useEffect } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { RotateCcw } from "lucide-react";
import { useSessionStore } from "@/state/sessionStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { Skeleton } from "@/components/ui/skeleton";

export function RetryPage() {
  const { sessionId } = useParams();
  const navigate = useNavigate();
  const {
    current,
    report,
    loadSession,
    startRetry,
    analyzing,
    error,
  } = useSessionStore();

  useEffect(() => {
    if (sessionId) void loadSession(sessionId);
  }, [sessionId, loadSession]);

  if (!current && analyzing) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="复练" description="加载上一轮目标…" />
        <Skeleton className="h-40 w-full" />
      </div>
    );
  }

  if (!current) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="复练"
          description="针对一个主问题再练一轮，结束后自动与上一轮对比。"
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/15 text-primary border-primary/20 grid size-13 place-items-center rounded-2xl border">
              <RotateCcw className="size-5" />
            </div>
            <h2 className="text-lg font-semibold">未找到上一轮练习</h2>
            <p className="text-muted-foreground max-w-md text-sm">
              请从复盘页或历史记录进入复练。
            </p>
            <Button asChild className="mt-1">
              <Link to="/history">返回历史</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const next = report?.nextPractice;
  const round = (current.round ?? 1) + 1;

  return (
    <div>
      <PageHeader
        title="复练"
        description="针对一个主问题再练一轮，结束后自动与上一轮对比。"
      />

      <div className="flex flex-col gap-4">
        <Card className="surface-hero border-primary/25">
          <CardContent className="flex flex-col gap-4 pt-1">
            <div className="flex flex-wrap gap-2">
              <Badge>即将第 {round} 轮</Badge>
              {next?.targetIssue && (
                <Badge variant="warning">目标：{next.targetIssue}</Badge>
              )}
            </div>

            <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              本轮只改这一点
            </div>
            <h2 className="text-xl font-semibold tracking-tight">
              {next?.instruction ?? "请针对上一轮主要问题再练一次。"}
            </h2>

            <p className="text-muted-foreground m-0 text-sm">
              题目：{next?.retryPrompt ?? current.topic}
            </p>

            {next && next.successCriteria.length > 0 && (
              <div className="bg-background rounded-lg border border-border p-3.5">
                <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
                  成功标准
                </div>
                <ul className="mt-1.5 mb-0 list-disc space-y-1 pl-5 text-sm">
                  {next.successCriteria.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              <Button
                disabled={analyzing}
                onClick={() => {
                  void (async () => {
                    const started = await startRetry(current.id);
                    if (started) navigate("/practice");
                  })();
                }}
              >
                开始复练录音
              </Button>
              <Button variant="ghost" asChild>
                <Link to={`/review/${current.id}`}>返回复盘</Link>
              </Button>
            </div>
          </CardContent>
        </Card>

        {error && (
          <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border px-3.5 py-3 text-sm">
            {error}
          </div>
        )}
      </div>
    </div>
  );
}
