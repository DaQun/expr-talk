import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "react-router-dom";
import {
  PRACTICE_MODE_LABELS,
  SCORE_DIMENSION_LABELS,
  type ScoreDimension,
} from "@expr-talk/shared";
import {
  ArrowDown,
  ArrowRight,
  ArrowUp,
  CalendarDays,
  RefreshCw,
  Target,
} from "lucide-react";
import { api } from "@/ipc/client";
import { useSessionStore } from "@/state/sessionStore";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { MetricBadge } from "@/components/MetricBadge";
import { PageHeader } from "@/components/ui/page-header";
import { Progress } from "@/components/ui/progress";
import { Skeleton } from "@/components/ui/skeleton";

const TREND_LABELS = {
  improving: "正在改善",
  stable: "基本持平",
  worsening: "近期增加",
} as const;

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds} 秒`;
  const minutes = Math.round(seconds / 60);
  return minutes < 60 ? `${minutes} 分钟` : `${(minutes / 60).toFixed(1)} 小时`;
}

function formatDate(iso: string): string {
  const value = Date.parse(iso);
  return Number.isFinite(value)
    ? new Date(value).toLocaleDateString(undefined, {
        month: "numeric",
        day: "numeric",
      })
    : iso;
}

export function ProfilePage() {
  const navigate = useNavigate();
  const setDraftMode = useSessionStore((state) => state.setDraftMode);
  const { data, isLoading, error, isFetching, refetch } = useQuery({
    queryKey: ["profile"],
    queryFn: () => api.getProfile(),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });

  const startFocusedPractice = () => {
    if (data?.focus) setDraftMode(data.focus.recommendedMode);
    navigate("/practice");
  };

  if (isLoading || !data) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader title="能力画像" description="正在汇总历史练习…" />
        <div className="grid gap-3 sm:grid-cols-3">
          {[0, 1, 2].map((item) => (
            <Skeleton key={item} className="h-24" />
          ))}
        </div>
        <Skeleton className="h-48" />
      </div>
    );
  }

  if (data.reviewedSessionCount === 0) {
    return (
      <div className="flex flex-col gap-4">
        <PageHeader
          title="能力画像"
          description="长期趋势、高频问题与能力基线。"
        />
        <Card>
          <CardContent className="flex flex-col items-center gap-3 py-12 text-center">
            <div className="bg-primary/15 text-primary border-primary/20 grid size-13 place-items-center rounded-2xl border">
              <Target className="size-5" />
            </div>
            <h2 className="text-lg font-semibold">完成练习后生成画像</h2>
            <p className="text-muted-foreground max-w-md text-sm">
              完成至少 3 次带评审的练习，会形成初步画像；达到 6
              次后开始显示趋势。
            </p>
            <Button asChild>
              <Link to="/practice">开始练习</Link>
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const remaining = Math.max(
    0,
    (data.maturity === "insufficient" ? 3 : 6) - data.reviewedSessionCount,
  );
  const maturityLabel =
    data.maturity === "established"
      ? "稳定画像"
      : data.maturity === "preliminary"
        ? "初步画像"
        : "积累中";

  return (
    <div className="flex flex-col gap-4">
      <PageHeader
        title="能力画像"
        description="基于本机历史评审聚合，不会额外请求大模型。"
        action={
          <Button
            variant="ghost"
            size="sm"
            disabled={isFetching}
            onClick={() => void refetch()}
          >
            <RefreshCw className={isFetching ? "animate-spin" : ""} />
            刷新
          </Button>
        }
      />

      {error && (
        <div className="bg-destructive/10 text-destructive border-destructive/30 rounded-lg border px-3.5 py-3 text-sm">
          {String(error)}
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Badge
          variant={data.maturity === "established" ? "success" : "secondary"}
        >
          {maturityLabel}
        </Badge>
        <span className="text-muted-foreground text-xs">
          更新于 {formatDate(data.generatedAt)}
        </span>
        {remaining > 0 && (
          <span className="text-muted-foreground text-xs">
            再完成 {remaining} 次可获得
            {data.maturity === "insufficient" ? "初步画像" : "趋势判断"}
          </span>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <MetricBadge
          label="有效评审"
          value={`${data.reviewedSessionCount} 次`}
        />
        <MetricBadge
          label="复练成功率"
          value={
            data.retrySuccessRate == null ? "暂无" : `${data.retrySuccessRate}%`
          }
        />
        <MetricBadge
          label="累计练习"
          value={formatDuration(data.totalDurationSec)}
        />
        <MetricBadge label="近 30 天活跃" value={`${data.activeDays30} 天`} />
      </div>

      {(data.attemptCount > data.sessionCount || data.interruptedSessionCount > 0) && (
        <p className="text-muted-foreground mt-3 mb-0 text-xs">
          共开始 {data.attemptCount} 次，完成 {data.sessionCount} 次
          {data.interruptedSessionCount > 0
            ? `，其中 ${data.interruptedSessionCount} 次中断或失败未计入成长指标`
            : ""}
          。
        </p>
      )}

      <Card className="border-primary/25">
        <CardHeader>
          <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
            下一步训练
          </div>
          <CardTitle className="text-lg">
            {data.focus?.title ?? "继续稳定输出"}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(240px,0.5fr)]">
          <div className="flex flex-col gap-3">
            <p className="m-0 text-sm leading-relaxed">
              {data.focus?.suggestion ??
                "继续完成一次练习，积累足够样本后会自动生成针对性目标。"}
            </p>
            {data.strength && (
              <div className="rounded-lg border border-border px-3.5 py-2.5 text-sm">
                <span className="text-muted-foreground">相对优势：</span>
                {data.strength.label}
                <span className="text-success ml-2 font-semibold tabular-nums">
                  {data.strength.score}
                </span>
              </div>
            )}
          </div>
          <div className="flex flex-col items-start gap-3 md:items-end">
            {data.focus && (
              <Badge variant="outline">
                推荐模式：{PRACTICE_MODE_LABELS[data.focus.recommendedMode]}
              </Badge>
            )}
            <Button onClick={startFocusedPractice}>
              开始针对性练习 <ArrowRight />
            </Button>
          </div>
        </CardContent>
      </Card>

      {data.modeAbilities.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">分模式能力</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            {data.modeAbilities.map((ability) => (
              <div key={ability.mode}>
                <div className="mb-3 flex items-center justify-between gap-3">
                  <strong className="text-sm">
                    {PRACTICE_MODE_LABELS[ability.mode]}
                  </strong>
                  <span className="text-muted-foreground text-xs">
                    {ability.sessionCount} 次样本
                  </span>
                </div>
                <div className="grid gap-x-5 gap-y-3 sm:grid-cols-2">
                  {Object.entries(ability.scores).map(([key, value]) => (
                    <div key={key}>
                      <div className="mb-1.5 flex justify-between text-xs">
                        <span className="text-muted-foreground">
                          {SCORE_DIMENSION_LABELS[key as ScoreDimension]}
                        </span>
                        <span className="font-medium tabular-nums">
                          {value}
                        </span>
                      </div>
                      <Progress value={value} />
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </CardContent>
        </Card>
      )}

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">反复出现的问题</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.recurringIssues.length === 0 ? (
              <p className="text-muted-foreground m-0 text-sm">
                暂未识别出反复出现的问题。
              </p>
            ) : (
              data.recurringIssues.slice(0, 5).map((issue, index) => (
                <div
                  key={issue.code}
                  className="flex items-start gap-3 rounded-lg border border-border px-3.5 py-3"
                >
                  <span className="text-muted-foreground text-sm tabular-nums">
                    {index + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <strong className="text-sm">{issue.title}</strong>
                      <Badge
                        variant={
                          issue.trend === "improving"
                            ? "success"
                            : issue.trend === "worsening"
                              ? "warning"
                              : "secondary"
                        }
                      >
                        {TREND_LABELS[issue.trend]}
                      </Badge>
                    </div>
                    <p className="text-muted-foreground mt-1.5 mb-0 text-xs">
                      出现 {issue.count} 次 · 占有效练习 {issue.sessionRate}% ·
                      最近 {formatDate(issue.lastSeenAt)}
                    </p>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">近期趋势</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-2">
            {data.trends.length === 0 ? (
              <div className="flex flex-col items-center gap-2 py-8 text-center">
                <CalendarDays className="text-muted-foreground size-5" />
                <p className="text-muted-foreground m-0 max-w-sm text-sm">
                  至少需要 6 次有效评审，才能比较早期基线与最近表现。
                </p>
              </div>
            ) : (
              data.trends.map((trend) => (
                <div
                  key={trend.key}
                  className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 rounded-lg border border-border px-3.5 py-3"
                >
                  <div>
                    <div className="text-sm font-medium">{trend.label}</div>
                    <div className="text-muted-foreground mt-1 text-xs tabular-nums">
                      {trend.baseline} → {trend.recent}
                    </div>
                  </div>
                  <div
                    className={
                      trend.improved
                        ? "text-success flex items-center gap-1 text-sm font-semibold tabular-nums"
                        : "text-warning flex items-center gap-1 text-sm font-semibold tabular-nums"
                    }
                  >
                    {trend.delta >= 0 ? (
                      <ArrowUp className="size-4" />
                    ) : (
                      <ArrowDown className="size-4" />
                    )}
                    {Math.abs(trend.delta)}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
