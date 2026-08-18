import { Link } from "react-router-dom";
import {
  APP_SLOGAN,
  DEFAULT_MODE_RUBRICS,
  MODE_PRACTICE_HINTS,
  MODE_SUGGESTED_DURATION_SEC,
  PRACTICE_MODE_LABELS,
  PRACTICE_MODES,
  SCORE_DIMENSION_LABELS,
  type PracticeMode,
  type ScoreDimension,
} from "@showtalk/shared";
import { ArrowRight, Mic, RefreshCw, Target } from "lucide-react";
import { useSessionStore } from "@/state/sessionStore";
import { ModeCard } from "@/components/ModeCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

const FLOW = [
  {
    icon: Mic,
    title: "说完就停",
    desc: "录音 + 实时字幕，说完立刻进入诊断",
  },
  {
    icon: Target,
    title: "只改一点",
    desc: "报告只突出一个主改进点与证据",
  },
  {
    icon: RefreshCw,
    title: "马上复练",
    desc: "同题再练一轮，自动对比进步",
  },
] as const;

export function HomePage() {
  const rawMode = useSessionStore((s) => s.draftMode);
  const setDraftMode = useSessionStore((s) => s.setDraftMode);
  const draftMode = (PRACTICE_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as PracticeMode)
    : ("free" as PracticeMode);
  const scoreLabels = Object.keys(DEFAULT_MODE_RUBRICS[draftMode]).map(
    (key) => SCORE_DIMENSION_LABELS[key as ScoreDimension],
  );

  return (
    <div className="flex flex-col gap-5">
      <PageHeader
        title="开始一次表达训练"
        description={
          <>
            <p className="text-foreground/80 mb-1 italic">{APP_SLOGAN}</p>
            选择训练模式，完成一次录音、诊断与同题复练。
          </>
        }
        className="mb-0"
        action={
          <Button variant="outline" asChild>
            <Link to="/history">查看历史</Link>
          </Button>
        }
      />

      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_minmax(320px,0.72fr)]">
        <Card className="surface-hero border-primary/25">
          <CardHeader className="gap-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Badge>当前模式</Badge>
              <Badge variant="outline">
                建议 {MODE_SUGGESTED_DURATION_SEC[draftMode]} 秒
              </Badge>
            </div>
            <div className="space-y-2">
              <CardTitle className="text-2xl leading-tight">
                {PRACTICE_MODE_LABELS[draftMode]}
              </CardTitle>
              <CardDescription className="max-w-2xl text-sm">
                {MODE_PRACTICE_HINTS[draftMode]}
              </CardDescription>
            </div>
          </CardHeader>
          <CardContent className="flex flex-col gap-5">
            <div>
              <div className="text-muted-foreground mb-2 text-xs font-medium">
                本轮重点观察
              </div>
              <div className="flex flex-wrap gap-2">
                {scoreLabels.map((label) => (
                  <Badge key={label} variant="secondary">
                    {label}
                  </Badge>
                ))}
              </div>
            </div>
            <div className="flex flex-wrap items-center gap-3 border-t border-border pt-4">
              <Button size="lg" asChild>
                <Link to="/practice">
                  开始练习
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <span className="text-muted-foreground text-xs">
                录音与指标默认保存在本机
              </span>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">选择训练模式</CardTitle>
            <CardDescription>
              自由开口、选题口播、多轮辩论或费曼追问
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-col gap-2" role="radiogroup" aria-label="训练模式">
              {PRACTICE_MODES.map((mode) => (
                <ModeCard
                  key={mode}
                  mode={mode}
                  selected={draftMode === mode}
                  onSelect={setDraftMode}
                />
              ))}
            </div>
          </CardContent>
        </Card>
      </div>

      <section
        className="grid overflow-hidden rounded-lg border border-border bg-card sm:grid-cols-3"
        aria-label="训练流程"
      >
        {FLOW.map((step, index) => {
          const Icon = step.icon;
          return (
            <div
              key={step.title}
              className={cn(
                "flex min-w-0 items-center gap-3 px-4 py-3.5",
                index > 0 && "border-t border-border sm:border-t-0 sm:border-l",
              )}
            >
              <Icon className="text-primary size-4 shrink-0" strokeWidth={1.8} />
              <div className="min-w-0">
                <div className="text-sm font-medium">{step.title}</div>
                <div className="text-muted-foreground mt-0.5 text-xs leading-relaxed">
                  {step.desc}
                </div>
              </div>
            </div>
          );
        })}
      </section>
    </div>
  );
}
