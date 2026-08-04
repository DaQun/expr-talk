import { Link } from "react-router-dom";
import {
  DEFAULT_MODE_RUBRICS,
  MODE_PRACTICE_HINTS,
  MODE_SUGGESTED_DURATION_SEC,
  PRACTICE_MODE_LABELS,
  PRACTICE_MODES,
  SCORE_DIMENSION_LABELS,
  type PracticeMode,
  type ScoreDimension,
} from "@expr-talk/shared";
import { ArrowRight, Mic, RefreshCw, Target } from "lucide-react";
import { useSessionStore } from "@/state/sessionStore";
import { ModeCard } from "@/components/ModeCard";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Separator } from "@/components/ui/separator";

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
    <div className="grid gap-4 md:min-h-[calc(100vh-4.5rem)] lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,0.85fr)]">
      <Card className="surface-hero overflow-hidden border-border/70 py-0">
        <div className="flex flex-1 items-center p-5 md:p-7">
          <div className="flex flex-col gap-5">
            <div className="flex flex-wrap gap-2">
              <Badge variant="default">本地优先</Badge>
              <Badge variant="secondary">可量化 · 可复练</Badge>
              <Badge variant="outline">隐私默认本机</Badge>
            </div>
            <div className="space-y-3">
              <h1 className="max-w-xl text-3xl font-semibold tracking-tight text-balance md:text-[2rem] md:leading-[1.15]">
                把一次表达，
                <span className="text-gradient-gold">变成可改进的闭环</span>
              </h1>
              <p className="text-muted-foreground max-w-lg text-[0.98rem] leading-relaxed">
                录音与转写默认留在本机；开始练习前配置大模型，用于生成结构化诊断与复练建议。
              </p>
            </div>
            <div className="flex flex-wrap gap-2.5">
              <Button size="lg" asChild>
                <Link to="/practice">
                  开始今日练习
                  <ArrowRight className="size-4" />
                </Link>
              </Button>
              <Button size="lg" variant="outline" asChild>
                <Link to="/history">查看历史</Link>
              </Button>
            </div>
          </div>
        </div>
        <Separator className="bg-border/60" />
        <div className="grid gap-0 lg:grid-cols-1 xl:grid-cols-3">
          {FLOW.map((step, i) => {
            const Icon = step.icon;
            return (
              <div
                key={step.title}
                className={
                  i < FLOW.length - 1
                    ? "border-border/60 flex gap-3 p-4 lg:border-b xl:border-r xl:border-b-0"
                    : "flex gap-3 p-4"
                }
              >
                <div className="border-primary/20 bg-primary/10 text-primary grid size-9 shrink-0 place-items-center rounded-xl border">
                  <Icon className="size-4" strokeWidth={1.75} />
                </div>
                <div className="space-y-1">
                  <div className="text-sm font-medium tracking-tight">
                    {step.title}
                  </div>
                  <div className="text-muted-foreground text-xs leading-snug">
                    {step.desc}
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </Card>

      <section className="flex flex-col gap-3 rounded-2xl border border-border bg-card p-4 surface-elevated">
        <div>
          <h2 className="text-sm font-medium tracking-tight">选择训练模式</h2>
          <p className="text-muted-foreground mt-0.5 text-xs">
            四种练法：自由开口 · 选题口播 · 多轮辩论 · 费曼追问
          </p>
        </div>
        <div className="grid gap-2.5">
          {PRACTICE_MODES.map((mode) => (
            <ModeCard
              key={mode}
              mode={mode}
              selected={draftMode === mode}
              onSelect={setDraftMode}
            />
          ))}
        </div>
        <div className="bg-muted/45 rounded-lg border border-border px-3.5 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-muted-foreground text-xs">当前选择</div>
              <strong className="mt-0.5 block text-sm">
                {PRACTICE_MODE_LABELS[draftMode]}
              </strong>
            </div>
            <Badge variant="outline">
              建议 {MODE_SUGGESTED_DURATION_SEC[draftMode]} 秒
            </Badge>
          </div>
          <p className="text-muted-foreground mt-2 mb-0 text-xs leading-relaxed">
            {MODE_PRACTICE_HINTS[draftMode]}
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {scoreLabels.map((label) => (
              <Badge key={label} variant="secondary">
                {label}
              </Badge>
            ))}
          </div>
          <Button asChild className="mt-3 w-full">
            <Link to="/practice">
              开始练习
              <ArrowRight className="size-4" />
            </Link>
          </Button>
        </div>
      </section>
    </div>
  );
}
