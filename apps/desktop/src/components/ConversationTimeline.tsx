import { useMemo, useState } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";
import {
  BrainCircuit,
  ChevronDown,
  ChevronUp,
  MessageCircleQuestion,
  Scale,
  UserRound,
} from "lucide-react";
import type { DebateState, DebateTurn, FeynmanCheckpoint } from "@showtalk/shared";
import { audioApi } from "@/ipc/audio";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

const CHECKPOINT_LABELS: Record<FeynmanCheckpoint["id"], string> = {
  definition: "定义",
  mechanism: "机制",
  example: "例子",
  boundary: "边界",
};

const CHECKPOINT_STATUS: Record<FeynmanCheckpoint["status"], string> = {
  not_started: "未开始",
  in_progress: "进行中",
  understood: "已理解",
};

type Props = {
  debate: DebateState;
  /** 顶层模式，用于 kind 缺失时的兜底文案 */
  mode?: "debate" | "feynman" | string;
  className?: string;
  /** 超过该轮数时默认收起正文，仅显示摘要 */
  collapseAfter?: number;
};

function isFeynman(debate: DebateState, mode?: string): boolean {
  return debate.kind === "feynman" || mode === "feynman";
}

function roleLabel(
  turn: DebateTurn,
  feynman: boolean,
): { name: string; detail: string } {
  if (feynman) {
    return turn.role === "user"
      ? { name: "我的讲解", detail: `第 ${turn.round} 轮` }
      : { name: "小白提问", detail: `第 ${turn.round} 轮` };
  }
  if (turn.role === "user") {
    return {
      name: "我方",
      detail: turn.round <= 1 ? `第 ${turn.round} 轮 · 立论` : `第 ${turn.round} 轮 · 回应`,
    };
  }
  return { name: "反方 AI", detail: `第 ${turn.round} 轮 · 质询` };
}

function turnAudioUrl(path: string | undefined): string | null {
  if (!path) return null;
  if (!audioApi.isTauri()) return null;
  try {
    return convertFileSrc(path);
  } catch {
    return null;
  }
}

export function ConversationTimeline({
  debate,
  mode,
  className,
  collapseAfter = 8,
}: Props) {
  const turns = debate.turns ?? [];
  const feynman = isFeynman(debate, mode);
  const [expanded, setExpanded] = useState(turns.length <= collapseAfter);
  const [audioErrorId, setAudioErrorId] = useState<string | null>(null);

  const summary = useMemo(() => {
    const userCount = turns.filter((t) => t.role === "user").length;
    const oppCount = turns.filter((t) => t.role === "opponent").length;
    if (feynman) {
      return `${userCount} 次讲解 · ${oppCount} 次追问`;
    }
    return `${userCount} 次发言 · ${oppCount} 次质询`;
  }, [turns, feynman]);

  const checkpoints = debate.feynman?.checkpoints ?? [];

  if (turns.length === 0) return null;

  return (
    <Card className={className}>
      <CardHeader className="pb-2">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <div className="text-muted-foreground text-xs font-semibold tracking-wider uppercase">
              对话时间线
            </div>
            <CardTitle className="mt-1 text-lg">
              {feynman ? "讲解与追问" : "立论与质询"}
            </CardTitle>
            <p className="text-muted-foreground mt-1 mb-0 text-sm">
              {summary} · 按轮回看，对照每段发言
            </p>
          </div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="shrink-0"
            onClick={() => setExpanded((v) => !v)}
            aria-expanded={expanded}
          >
            {expanded ? (
              <>
                收起 <ChevronUp className="size-3.5" />
              </>
            ) : (
              <>
                展开 {turns.length} 条 <ChevronDown className="size-3.5" />
              </>
            )}
          </Button>
        </div>
        {feynman && checkpoints.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {checkpoints.map((cp) => (
              <Badge
                key={cp.id}
                variant={
                  cp.status === "understood"
                    ? "success"
                    : cp.status === "in_progress"
                      ? "warning"
                      : "secondary"
                }
                title={cp.evidence}
              >
                {CHECKPOINT_LABELS[cp.id]} · {CHECKPOINT_STATUS[cp.status]}
              </Badge>
            ))}
          </div>
        )}
      </CardHeader>

      {expanded && (
        <CardContent className="pt-2">
          <ol className="m-0 flex list-none flex-col gap-3 p-0">
            {turns.map((turn, index) => {
              const isUser = turn.role === "user";
              const labels = roleLabel(turn, feynman);
              const audioUrl = isUser ? turnAudioUrl(turn.audioFile) : null;
              const Icon = feynman
                ? isUser
                  ? BrainCircuit
                  : MessageCircleQuestion
                : isUser
                  ? UserRound
                  : Scale;

              return (
                <li
                  key={turn.id}
                  className={cn(
                    "rounded-xl border px-3.5 py-3",
                    isUser
                      ? "border-primary/20 bg-primary/5"
                      : "border-border bg-muted/30",
                  )}
                >
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span
                      className={cn(
                        "grid size-7 place-items-center rounded-full",
                        isUser
                          ? "bg-primary/15 text-primary"
                          : "bg-muted text-muted-foreground",
                      )}
                    >
                      <Icon className="size-3.5" aria-hidden />
                    </span>
                    <span className="text-sm font-medium">{labels.name}</span>
                    <span className="text-muted-foreground text-xs">
                      {labels.detail}
                    </span>
                    {turn.source === "paste" && (
                      <Badge variant="secondary" className="text-[0.65rem]">
                        文字
                      </Badge>
                    )}
                    {typeof turn.durationSec === "number" &&
                      turn.durationSec > 0 && (
                        <span className="text-muted-foreground text-xs tabular-nums">
                          {Math.round(turn.durationSec)} 秒
                        </span>
                      )}
                    <span className="text-muted-foreground ml-auto text-[0.65rem] tabular-nums">
                      #{index + 1}
                    </span>
                  </div>

                  <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
                    {turn.text.trim() || (
                      <span className="text-muted-foreground">（无文字）</span>
                    )}
                  </p>

                  {audioUrl && (
                    <div className="mt-2.5">
                      <audio
                        controls
                        preload="metadata"
                        src={audioUrl}
                        className="h-9 w-full max-w-md"
                        onCanPlay={() =>
                          setAudioErrorId((id) => (id === turn.id ? null : id))
                        }
                        onError={() => setAudioErrorId(turn.id)}
                      />
                      {audioErrorId === turn.id && (
                        <p className="text-destructive mt-1 mb-0 text-xs">
                          本轮录音无法播放
                        </p>
                      )}
                    </div>
                  )}
                </li>
              );
            })}
          </ol>
        </CardContent>
      )}

      {!expanded && turns.length > 0 && (
        <CardContent className="pt-0">
          <p className="text-muted-foreground m-0 line-clamp-2 text-sm leading-relaxed">
            {turns[turns.length - 1]?.text}
          </p>
        </CardContent>
      )}
    </Card>
  );
}
