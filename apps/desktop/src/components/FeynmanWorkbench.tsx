import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUp,
  BrainCircuit,
  Check,
  CheckCircle2,
  CircleDashed,
  CircleStop,
  Keyboard,
  Lightbulb,
  MessageCircle,
  MessageCircleQuestion,
  Mic,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Sparkles,
  X,
} from "lucide-react";
import type {
  FeynmanCheckpoint,
  FeynmanCheckpointStatus,
  FeynmanDifficulty,
  FeynmanLearnerRole,
  PracticeMode,
  PracticeTopic,
  TrainingSession,
} from "@expr-talk/shared";
import {
  MODE_SUGGESTED_DURATION_SEC,
  PRACTICE_MODE_LABELS,
  PRACTICE_MODES,
} from "@expr-talk/shared";
import type { DebateRecordingUi } from "@/components/DebateWorkbench";
import { ReasoningBlock } from "@/components/ReasoningBlock";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

/** 距底部多少像素内视为「贴底」 */
const CONVERSATION_STICK_BOTTOM_PX = 64;

type InputMode = "text" | "voice";

type FeynmanWorkbenchProps = {
  draftTopic: string;
  draftMode: PracticeMode;
  topicCategory: string;
  topicCategories: string[];
  topicId: string | null;
  topics: PracticeTopic[];
  current: TrainingSession | null;
  recording: boolean;
  waiting: boolean;
  analyzing: boolean;
  analyzeNote: string | null;
  analyzeElapsed: number;
  streamedQuestion: string | null;
  streamedReasoning: string | null;
  pasteText: string;
  learnerRole: FeynmanLearnerRole;
  difficulty: FeynmanDifficulty;
  modelReady: boolean | null;
  llmReady: boolean;
  llmReason?: string;
  recordingUi: DebateRecordingUi;
  discardDialog?: ReactNode;
  error: string | null;
  onModeChange: (mode: PracticeMode) => void;
  onTopicCategoryChange: (category: string) => void;
  onTopicSelect: (id: string) => void;
  onTopicChange: (topic: string) => void;
  onPasteTextChange: (text: string) => void;
  onLearnerRoleChange: (role: FeynmanLearnerRole) => void;
  onDifficultyChange: (difficulty: FeynmanDifficulty) => void;
  onStartVoice: () => void;
  onStartResponse: () => void;
  onSubmitText: () => void;
  onRetryQuestion: () => void;
  onFinish: () => void;
  onAbandon: () => void;
  onOpenReview: () => void;
};

const CHECKPOINTS: Array<{
  id: FeynmanCheckpoint["id"];
  label: string;
  description: string;
}> = [
  { id: "definition", label: "概念定义", description: "它到底是什么" },
  { id: "mechanism", label: "原理与因果", description: "它为何这样运作" },
  { id: "example", label: "具体例子", description: "能否落到一个场景" },
  { id: "boundary", label: "边界与误解", description: "何时不适用，别把什么混为一谈" },
];

const ROLE_OPTIONS: Array<{ value: FeynmanLearnerRole; label: string }> = [
  { value: "child", label: "10 岁小学生" },
  { value: "student", label: "有基础的学生" },
  { value: "outsider", label: "领域外成年人" },
  { value: "challenger", label: "带着质疑的学习者" },
];

const DIFFICULTY_OPTIONS: Array<{
  value: FeynmanDifficulty;
  label: string;
  short: string;
}> = [
  { value: "gentle", label: "温和：先讲清核心", short: "温和" },
  { value: "standard", label: "标准：四项都要覆盖", short: "标准" },
  { value: "challenge", label: "挑战：追问边界与反例", short: "挑战" },
];

const CHECKPOINT_STATUS: Record<
  FeynmanCheckpointStatus,
  { label: string; className: string; Icon: typeof CircleDashed }
> = {
  not_started: {
    label: "待讲解",
    className: "border-border bg-muted text-muted-foreground",
    Icon: CircleDashed,
  },
  in_progress: {
    label: "正在澄清",
    className: "border-warning/35 bg-warning/10 text-warning-foreground",
    Icon: Lightbulb,
  },
  understood: {
    label: "已听懂",
    className: "border-success/30 bg-success/10 text-success",
    Icon: CheckCircle2,
  },
};

function formatTimer(totalSeconds: number) {
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

function turnLabel(role: "user" | "opponent") {
  return role === "user" ? "我的讲解" : "小白";
}

function roleLabel(role: FeynmanLearnerRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "领域外成年人";
}

function difficultyShort(difficulty: FeynmanDifficulty): string {
  return DIFFICULTY_OPTIONS.find((option) => option.value === difficulty)?.short ?? "标准";
}

export function FeynmanWorkbench({
  draftTopic,
  draftMode,
  topicCategory,
  topicCategories,
  topicId,
  topics,
  current,
  recording,
  waiting,
  analyzing,
  analyzeNote,
  analyzeElapsed,
  streamedQuestion,
  streamedReasoning,
  pasteText,
  learnerRole,
  difficulty,
  modelReady,
  llmReady,
  llmReason,
  recordingUi,
  discardDialog,
  error,
  onModeChange,
  onTopicCategoryChange,
  onTopicSelect,
  onTopicChange,
  onPasteTextChange,
  onLearnerRoleChange,
  onDifficultyChange,
  onStartVoice,
  onStartResponse,
  onSubmitText,
  onRetryQuestion,
  onFinish,
  onAbandon,
  onOpenReview,
}: FeynmanWorkbenchProps) {
  const [inputMode, setInputMode] = useState<InputMode>("voice");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const [newSessionFrom, setNewSessionFrom] = useState<string | null>(null);
  const conversationRef = useRef<HTMLDivElement>(null);
  const conversationAutoFollowRef = useRef(true);
  const captionScrollRef = useRef<HTMLDivElement>(null);
  const captionAutoFollowRef = useRef(true);

  const session = current?.mode === "feynman" ? current : null;
  const debate = session?.debate;
  const isComplete = session?.status === "reviewed";
  const replacingCompletedSession = isComplete && newSessionFrom === session?.id;
  const showingCompleted = isComplete && !replacingCompletedSession;
  const visibleDebate = replacingCompletedSession ? undefined : debate;

  const active = recording || waiting || analyzing;
  // 有可见会话（进行中或已结束）即进入对话态；新建时清空
  const hasSession = Boolean(visibleDebate);
  const hasStarted = hasSession && (active || showingCompleted || Boolean(visibleDebate?.turns.length));
  const settingsLocked = active || (hasSession && !showingCompleted && !replacingCompletedSession);

  const learningTopic = (visibleDebate ? session?.topic ?? "" : draftTopic).trim();
  const pendingQuestion = visibleDebate?.pendingQuestion;
  const checkpoints = visibleDebate?.feynman?.checkpoints ?? [];
  const activeRole = visibleDebate?.feynman?.learnerRole ?? learnerRole;
  const activeDifficulty = visibleDebate?.feynman?.difficulty ?? difficulty;

  const turns = useMemo(() => {
    const all = visibleDebate?.turns ?? [];
    return all.filter(
      (turn, index) =>
        !(pendingQuestion && turn.role === "opponent" && index === all.length - 1),
    );
  }, [visibleDebate, pendingQuestion]);

  const userTurnCount = turns.filter((turn) => turn.role === "user").length;
  const round = visibleDebate?.currentRound ?? (hasStarted ? 1 : 0);
  const latestTurn = visibleDebate?.turns[visibleDebate.turns.length - 1];
  const learnerUnderstood = Boolean(
    latestTurn?.role === "opponent" && latestTurn.text.startsWith("我已经理解"),
  );
  // 待答问题对应的思考过程：取自完整 turns 中最后一条小白回复（turns 列表已过滤掉它）。
  const pendingReasoning = pendingQuestion
    ? [...(visibleDebate?.turns ?? [])].reverse().find((turn) => turn.role === "opponent")
        ?.reasoning
    : undefined;
  const hasLiveCaption = Boolean(
    recordingUi.finalSegments.length > 0 || recordingUi.partialText.trim(),
  );
  const modelReplySignature = analyzing
    ? `stream:${streamedReasoning?.length ?? 0}:${streamedQuestion?.length ?? 0}`
    : `pending:${pendingQuestion ?? ""}:${pendingReasoning?.length ?? 0}`;

  const checkpointById = useMemo(
    () => new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint])),
    [checkpoints],
  );
  const understoodCount = checkpoints.filter((cp) => cp.status === "understood").length;

  const canAbandon =
    Boolean(session) &&
    session?.status !== "reviewed" &&
    session?.status !== "completed" &&
    session?.status !== "failed";
  const canFinish =
    canAbandon &&
    !recording &&
    Boolean(visibleDebate?.turns.some((turn) => turn.role === "user"));
  const sendDisabled = !pasteText.trim() || analyzing || !llmReady || recording || showingCompleted;

  const statusLabel = showingCompleted
    ? "已结束"
    : analyzing
      ? "处理中"
      : recording
        ? "讲解中"
        : waiting
          ? learnerUnderstood
            ? "小白已理解"
            : "等待回应"
          : hasStarted
            ? "进行中"
            : "准备开始";

  function isConversationNearBottom(node: HTMLElement) {
    return node.scrollHeight - node.scrollTop - node.clientHeight <= CONVERSATION_STICK_BOTTOM_PX;
  }

  function scrollConversationToBottom() {
    const node = conversationRef.current;
    if (!node) return;
    if (node.scrollHeight > node.clientHeight + 1) {
      node.scrollTop = node.scrollHeight;
      return;
    }
    const last = node.lastElementChild as HTMLElement | null;
    last?.scrollIntoView({ block: "end", behavior: "auto" });
  }

  useEffect(() => {
    conversationAutoFollowRef.current = true;
  }, [current?.id, userTurnCount, newSessionFrom]);

  useLayoutEffect(() => {
    const node = conversationRef.current;
    if (!node) return;
    const forceFollow =
      analyzing ||
      Boolean(pendingQuestion) ||
      Boolean(streamedQuestion) ||
      Boolean(streamedReasoning);
    if (!forceFollow && !conversationAutoFollowRef.current && !isConversationNearBottom(node)) {
      return;
    }
    conversationAutoFollowRef.current = true;
    let frame2 = 0;
    const frame1 = window.requestAnimationFrame(() => {
      scrollConversationToBottom();
      frame2 = window.requestAnimationFrame(scrollConversationToBottom);
    });
    return () => {
      window.cancelAnimationFrame(frame1);
      if (frame2) window.cancelAnimationFrame(frame2);
    };
  }, [
    turns.length,
    pendingQuestion,
    modelReplySignature,
    streamedQuestion,
    streamedReasoning,
    pendingReasoning,
    analyzing,
    recording,
    showingCompleted,
  ]);

  useEffect(() => {
    captionAutoFollowRef.current = true;
  }, [current?.id, recording]);

  useEffect(() => {
    const container = captionScrollRef.current;
    if (!container || !captionAutoFollowRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [recordingUi.finalSegments, recordingUi.partialText, recording]);

  return (
    <div className="feynman-workbench flex h-[calc(100dvh-5rem)] max-h-[calc(100dvh-5rem)] min-h-0 flex-col gap-2.5 overflow-hidden">
      {!llmReady && (
        <div className="border-destructive/25 bg-destructive/8 text-destructive flex shrink-0 items-start gap-3 rounded-xl border px-4 py-2.5 text-sm">
          <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="m-0 font-medium">开始讲解前需要配置大模型</p>
            <p className="mt-1 mb-0 text-xs opacity-85">{llmReason ?? "请先完成大模型配置。"}</p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings">去设置</Link>
          </Button>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <div className="bg-primary/12 text-primary grid size-9 shrink-0 place-items-center rounded-xl">
            <BrainCircuit className="size-4" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 truncate text-lg font-semibold tracking-tight">费曼学习</h1>
              <Badge variant={active || learnerUnderstood || showingCompleted ? "success" : "secondary"}>
                {statusLabel}
              </Badge>
            </div>
            <p className="text-muted-foreground m-0 mt-0.5 truncate text-xs">
              {learningTopic
                ? learningTopic
                : `把概念讲给小白听 · 建议 ${MODE_SUGGESTED_DURATION_SEC.feynman} 秒起`}
            </p>
          </div>
        </div>
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className="size-9 shrink-0"
          onClick={() => setDetailsOpen((open) => !open)}
          aria-label={detailsOpen ? "收起本场设定" : "展开本场设定"}
          title={detailsOpen ? "收起本场设定" : "展开本场设定"}
          aria-pressed={detailsOpen}
        >
          {detailsOpen ? <PanelRightClose /> : <PanelRightOpen />}
        </Button>
      </div>

      <div
        className={cn(
          "grid min-h-0 flex-1 items-stretch gap-3 overflow-hidden",
          detailsOpen && "lg:grid-cols-[minmax(0,1fr)_19rem]",
        )}
      >
        <Card
          className={cn(
            "feynman-chat-card flex h-full min-h-0 min-w-0 flex-col gap-0 overflow-hidden border-border/80 py-0 shadow-[0_8px_30px_oklch(0.28_0.02_255_/_5%)] transition-[border-color,box-shadow] duration-300",
            recording && "border-warning/35 shadow-[0_8px_30px_oklch(0.75_0.12_85_/_8%)]",
            learnerUnderstood && "border-success/30",
          )}
        >
          <CardHeader className="border-border/70 shrink-0 border-b px-5 py-3">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-sm font-semibold">讲解对话</CardTitle>
                <p className="text-muted-foreground m-0 mt-1 truncate text-xs">
                  {learningTopic
                    ? `${roleLabel(activeRole)} · ${difficultyShort(activeDifficulty)}`
                    : "选择一个概念，开始你的第一轮讲解"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {round > 0 && <Badge variant="outline">第 {round} 轮</Badge>}
                {hasSession && (
                  <Badge variant={understoodCount === 4 ? "success" : "secondary"}>
                    检查点 {understoodCount}/4
                  </Badge>
                )}
                {modelReady !== null && (
                  <span
                    className={cn(
                      "hidden items-center gap-1 text-xs sm:inline-flex",
                      modelReady ? "text-success" : "text-warning-foreground",
                    )}
                  >
                    <span className={cn("size-1.5 rounded-full", modelReady ? "bg-success" : "bg-warning")} />
                    麦克风 {modelReady ? "就绪" : "未就绪"}
                  </span>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent
            ref={conversationRef}
            className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6"
            onScroll={(event) => {
              conversationAutoFollowRef.current = isConversationNearBottom(event.currentTarget);
            }}
          >
            {!turns.length && !pendingQuestion && !analyzing && (
              <div className="flex flex-1 items-center justify-center py-10">
                <div className="max-w-sm text-center transition-opacity duration-300">
                  <div
                    className={cn(
                      "mx-auto mb-4 grid size-12 place-items-center rounded-2xl transition-colors duration-300",
                      recording ? "bg-warning/15 text-warning-foreground" : "bg-primary/10 text-primary",
                    )}
                  >
                    {recording ? (
                      <Mic className="size-6" aria-hidden />
                    ) : (
                      <MessageCircle className="size-6" aria-hidden />
                    )}
                  </div>
                  <h2 className="m-0 text-base font-semibold">
                    {recording ? "正在讲解…" : "准备好开始了吗？"}
                  </h2>
                  <p className="text-muted-foreground mt-2 mb-0 text-sm leading-relaxed">
                    {recording
                      ? "用自己的话讲清定义与因果，实时字幕会出现在下方。说完后点「停止本轮」。"
                      : "少术语、说清因果、给一个例子。小白会追问，直到真正听懂。"}
                  </p>
                </div>
              </div>
            )}

            {turns.map((turn) => {
              const isUser = turn.role === "user";
              const isUnderstood =
                !isUser && turn.text.startsWith("我已经理解");
              return (
                <div
                  key={turn.id}
                  className={cn("flex items-end gap-2.5", isUser ? "justify-end" : "justify-start")}
                >
                  {!isUser && (
                    <div
                      className={cn(
                        "grid size-8 shrink-0 place-items-center rounded-full",
                        isUnderstood
                          ? "bg-success/15 text-success"
                          : "bg-warning/15 text-warning-foreground",
                      )}
                    >
                      {isUnderstood ? (
                        <CheckCircle2 className="size-4" aria-hidden />
                      ) : (
                        <MessageCircleQuestion className="size-4" aria-hidden />
                      )}
                    </div>
                  )}
                  <div className={cn("max-w-[min(78%,38rem)]", isUser && "items-end")}>
                    <div
                      className={cn(
                        "mb-1 flex items-center gap-1.5 text-[0.68rem]",
                        isUser ? "justify-end text-muted-foreground" : "text-muted-foreground",
                      )}
                    >
                      {!isUser && <span>{turnLabel(turn.role)}</span>}
                      <span>第 {turn.round} 轮</span>
                      {isUser && <span>{turnLabel(turn.role)}</span>}
                      {isUnderstood && <span className="text-success">已理解</span>}
                    </div>
                    {!isUser && turn.reasoning && (
                      <ReasoningBlock reasoning={turn.reasoning} label="小白思考过程" />
                    )}
                    <div
                      className={cn(
                        "rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap",
                        isUser
                          ? "bg-primary text-primary-foreground rounded-br-md"
                          : isUnderstood
                            ? "border-success/30 bg-success/10 text-foreground rounded-bl-md border"
                            : "bg-muted/70 text-foreground rounded-bl-md",
                      )}
                    >
                      {turn.text}
                    </div>
                  </div>
                  {isUser && (
                    <div className="bg-primary/12 text-primary grid size-8 shrink-0 place-items-center rounded-full">
                      <BrainCircuit className="size-4" aria-hidden />
                    </div>
                  )}
                </div>
              );
            })}

            {pendingQuestion && (
              <div className="flex items-end gap-2.5">
                <div className="bg-warning/15 text-warning-foreground grid size-8 shrink-0 place-items-center rounded-full">
                  <MessageCircleQuestion className="size-4" aria-hidden />
                </div>
                <div className="max-w-[min(78%,38rem)]">
                  <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[0.68rem]">
                    <span>小白</span>
                    <span>正在追问</span>
                  </div>
                  {pendingReasoning && (
                    <ReasoningBlock reasoning={pendingReasoning} label="小白思考过程" />
                  )}
                  <div className="border-warning/30 bg-warning/8 rounded-2xl rounded-bl-md border px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap">
                    {pendingQuestion}
                  </div>
                </div>
              </div>
            )}

            {analyzing && !pendingQuestion && (
              <div className="flex items-end gap-2.5" role="status">
                <div className="bg-warning/15 text-warning-foreground grid size-8 shrink-0 place-items-center rounded-full">
                  <Sparkles className="size-4" aria-hidden />
                </div>
                <div className="max-w-[min(78%,38rem)]">
                  <div className="text-muted-foreground mb-1 text-[0.68rem]">小白</div>
                  {streamedReasoning && (
                    <ReasoningBlock
                      reasoning={streamedReasoning}
                      label="小白思考过程"
                      defaultOpen
                    />
                  )}
                  <div className="bg-muted/70 text-muted-foreground rounded-2xl rounded-bl-md px-4 py-3 text-sm">
                    {streamedQuestion || analyzeNote || "正在组织下一个问题…"}
                    <span
                      className="bg-warning ml-1.5 inline-block size-1.5 animate-pulse rounded-full align-middle"
                      aria-hidden
                    />
                    {analyzeElapsed > 0 && (
                      <span className="ml-2 text-xs opacity-65">{analyzeElapsed}s</span>
                    )}
                  </div>
                </div>
              </div>
            )}
          </CardContent>

          <div className="border-border/70 bg-card/95 z-10 shrink-0 border-t p-4 shadow-[0_-8px_24px_oklch(0.28_0.02_255_/_5%)] backdrop-blur-sm">
            {showingCompleted ? (
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-muted-foreground m-0 text-sm">
                  本次练习已结束，复盘报告已生成。
                </p>
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => setNewSessionFrom(session?.id ?? null)}
                  >
                    新建讲解
                  </Button>
                  <Button size="sm" onClick={onOpenReview}>
                    查看复盘
                  </Button>
                </div>
              </div>
            ) : (
              <>
                {waiting && !pendingQuestion && !learnerUnderstood && (
                  <Button
                    variant="secondary"
                    className="mb-3 w-full"
                    disabled={analyzing || !llmReady}
                    onClick={onRetryQuestion}
                  >
                    <RefreshCw /> 重新生成小白提问
                  </Button>
                )}

                <div className="flex flex-col gap-2.5">
                  <div
                    className={cn(
                      "grid transition-[grid-template-rows,opacity] duration-300 ease-out",
                      recording ? "grid-rows-[0fr] opacity-0" : "grid-rows-[1fr] opacity-100",
                    )}
                    aria-hidden={recording}
                  >
                    <div className="overflow-hidden">
                      <div className="mb-2.5 flex items-center justify-between gap-3">
                        <ToggleGroup
                          type="single"
                          value={inputMode}
                          onValueChange={(value) => value && setInputMode(value as InputMode)}
                          disabled={active || analyzing}
                          aria-label="讲解输入方式"
                          className="rounded-lg border border-border bg-muted/35 p-0.5"
                        >
                          <ToggleGroupItem
                            value="voice"
                            aria-label="语音输入"
                            className="h-8 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:shadow-sm"
                          >
                            <Mic className="size-3.5" /> 语音
                          </ToggleGroupItem>
                          <ToggleGroupItem
                            value="text"
                            aria-label="文字输入"
                            className="h-8 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:shadow-sm"
                          >
                            <Keyboard className="size-3.5" /> 文字
                          </ToggleGroupItem>
                        </ToggleGroup>
                        <span className="text-muted-foreground hidden text-xs sm:block">
                          {waiting
                            ? learnerUnderstood
                              ? "可继续补充，或结束复盘"
                              : "回应小白的追问"
                            : "先讲清概念"}
                        </span>
                      </div>
                    </div>
                  </div>

                  {inputMode === "text" && !recording ? (
                    <div className="flex items-end gap-2">
                      <Textarea
                        value={pasteText}
                        onChange={(event) => onPasteTextChange(event.target.value)}
                        placeholder={
                          pendingQuestion
                            ? "直接回答小白刚才的问题…"
                            : learnerUnderstood
                              ? "小白已理解，你仍可继续补充…"
                              : "用自己的话讲给小白听…"
                        }
                        disabled={analyzing || recording}
                        rows={2}
                        className="min-h-20 resize-none rounded-xl bg-card pr-3"
                        onKeyDown={(event) => {
                          if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                            event.preventDefault();
                            if (!sendDisabled) onSubmitText();
                          }
                        }}
                      />
                      <Button
                        size="icon"
                        className="size-10 shrink-0 rounded-xl"
                        disabled={sendDisabled}
                        onClick={onSubmitText}
                        aria-label={waiting ? "提交讲解" : "开始讲解"}
                        title={waiting ? "提交讲解" : "开始讲解"}
                      >
                        <ArrowUp />
                      </Button>
                    </div>
                  ) : (
                    <div
                      className={cn(
                        "rounded-xl border transition-[border-color,background-color,box-shadow,padding] duration-300 ease-out",
                        recording
                          ? "border-warning/35 bg-warning/6 shadow-[inset_0_0_0_1px_oklch(0.8_0.12_85_/_6%)] p-3.5"
                          : "border-dashed border-border bg-muted/25 px-3 py-2.5",
                      )}
                    >
                      {recording ? (
                        <div className="flex flex-col gap-3">
                          <div className="flex flex-wrap items-center justify-between gap-2">
                            <div className="flex min-w-0 items-center gap-2.5">
                              <span className="bg-warning size-2 shrink-0 animate-pulse rounded-full" aria-hidden />
                              <span
                                className="font-mono text-lg font-semibold tracking-wider tabular-nums"
                                aria-live="polite"
                              >
                                {formatTimer(recordingUi.seconds)}
                              </span>
                              <span className="text-muted-foreground text-xs">
                                {waiting || userTurnCount > 0 ? "本轮讲解中" : "首次讲解中"}
                              </span>
                            </div>
                            <span className="text-muted-foreground truncate text-xs">
                              {recordingUi.asrStatus || "采集中"}
                            </span>
                          </div>

                          <div className="space-y-1.5">
                            <div className="bg-muted/60 h-1.5 overflow-hidden rounded-full">
                              <div
                                className="bg-warning h-full rounded-full transition-[width] duration-150 ease-out"
                                style={{ width: `${Math.min(100, recordingUi.levelPct)}%` }}
                              />
                            </div>
                            <p className="text-muted-foreground m-0 text-[0.7rem]">
                              电平 {recordingUi.levelPct}%
                              {recordingUi.levelPct < 5 ? " · 请靠近麦克风" : ""}
                            </p>
                          </div>

                          <div
                            ref={captionScrollRef}
                            className="bg-background/70 max-h-[4.5rem] min-h-[2.75rem] overflow-y-auto rounded-lg border border-border/60 px-3 py-2 text-sm leading-relaxed"
                            onScroll={(event) => {
                              const container = event.currentTarget;
                              const distanceFromBottom =
                                container.scrollHeight - container.scrollTop - container.clientHeight;
                              captionAutoFollowRef.current = distanceFromBottom <= 8;
                            }}
                          >
                            {recordingUi.finalSegments.map((segment) => (
                              <div key={segment.id} className="mb-1 last:mb-0">
                                {segment.text}
                              </div>
                            ))}
                            {recordingUi.partialText && (
                              <div className="text-primary/90 mb-1 last:mb-0">
                                {recordingUi.partialText}
                              </div>
                            )}
                            {!hasLiveCaption && (
                              <span className="text-muted-foreground">
                                {recordingUi.levelPct < 5
                                  ? "请开始说话，电平应跳动…"
                                  : "正在识别…字幕会显示在这里"}
                              </span>
                            )}
                          </div>

                          <div className="flex flex-wrap items-center gap-2">
                            <Button size="sm" disabled={analyzing} onClick={recordingUi.onStop}>
                              <CircleStop className="size-3.5" />
                              {analyzing ? "分析中…" : "停止本轮讲解"}
                            </Button>
                            <Button
                              size="sm"
                              variant="secondary"
                              disabled={analyzing}
                              onClick={recordingUi.onRerecord}
                              title="丢弃当前录音与字幕，保留题目后重新开始"
                            >
                              <RefreshCw className="size-3.5" /> 重新录制
                            </Button>
                            <Button
                              size="sm"
                              variant="ghost"
                              disabled={analyzing}
                              onClick={onAbandon}
                              title="停止麦克风并放弃本次练习"
                            >
                              <X className="size-3.5" /> 放弃本次练习
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center justify-between gap-3">
                          <div className="flex min-w-0 items-center gap-2 text-sm">
                            <Mic className="text-primary size-4 shrink-0" />
                            <span className="truncate">
                              {waiting
                                ? "使用语音回应小白，实时字幕会显示在这里"
                                : "使用语音讲解，实时字幕会显示在这里"}
                            </span>
                          </div>
                          <Button
                            size="sm"
                            disabled={analyzing || !llmReady}
                            onClick={waiting || hasSession ? onStartResponse : onStartVoice}
                          >
                            <Mic className="size-3.5" />{" "}
                            {waiting || hasSession
                              ? pendingQuestion
                                ? "开始回应"
                                : "继续讲解"
                              : "开始讲解"}
                          </Button>
                        </div>
                      )}
                    </div>
                  )}
                </div>

                {!recording && (canFinish || canAbandon) && (
                  <div className="mt-3 flex items-center justify-between gap-2 border-t pt-3">
                    {canFinish && (
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={analyzing || !llmReady}
                        onClick={onFinish}
                      >
                        <Check /> 结束并复盘
                      </Button>
                    )}
                    {canAbandon && (
                      <Button
                        variant="ghost"
                        size="sm"
                        className="ml-auto"
                        disabled={analyzing}
                        onClick={onAbandon}
                      >
                        <X /> 放弃
                      </Button>
                    )}
                  </div>
                )}
              </>
            )}
          </div>
        </Card>

        {detailsOpen && (
          <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto lg:h-full">
            <Card className="shrink-0 gap-0 border-border/80 py-0">
              <CardHeader className="border-border/70 border-b px-4 py-3">
                <div className="flex items-center justify-between gap-2">
                  <CardTitle className="text-sm">理解检查点</CardTitle>
                  <span className="text-muted-foreground text-xs tabular-nums">
                    {understoodCount}/4
                    {userTurnCount > 0 ? ` · ${userTurnCount} 轮` : ""}
                  </span>
                </div>
              </CardHeader>
              <CardContent className="px-4 py-3">
                <div className="grid grid-cols-2 gap-2">
                  {CHECKPOINTS.map((definition) => {
                    const checkpoint = checkpointById.get(definition.id) ?? {
                      id: definition.id,
                      status: "not_started" as const,
                    };
                    const status = CHECKPOINT_STATUS[checkpoint.status];
                    const Icon = status.Icon;
                    return (
                      <div
                        key={definition.id}
                        title={checkpoint.evidence || definition.description}
                        className={cn(
                          "rounded-lg border px-2.5 py-2",
                          checkpoint.status === "understood" &&
                            "border-success/30 bg-success/8",
                          checkpoint.status === "in_progress" &&
                            "border-warning/35 bg-warning/8",
                          checkpoint.status === "not_started" &&
                            "border-border/70 bg-muted/25",
                        )}
                      >
                        <div className="flex items-center justify-between gap-1">
                          <span className="text-xs font-medium">{definition.label}</span>
                          <Icon className="size-3.5 shrink-0 opacity-80" aria-hidden />
                        </div>
                        <p className="text-muted-foreground mt-1 mb-0 text-[0.65rem] leading-snug">
                          {status.label}
                        </p>
                      </div>
                    );
                  })}
                </div>
                {hasSession && !showingCompleted && (
                  <p className="text-muted-foreground mt-3 mb-0 text-[0.7rem] leading-relaxed">
                    缺哪项，小白下一轮就问哪项。
                  </p>
                )}
              </CardContent>
            </Card>

            <Card className="min-h-0 gap-0 border-border/80 py-0">
              <CardHeader className="border-border/70 border-b px-4 py-3">
                <CardTitle className="text-sm">本场设定</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-4 py-3">
                {settingsLocked ? (
                  <div className="flex flex-col gap-2.5 text-sm">
                    <div>
                      <p className="text-muted-foreground m-0 text-xs">概念</p>
                      <p className="mt-1 mb-0 line-clamp-3 text-xs leading-relaxed">
                        {learningTopic || "未填写"}
                      </p>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div>
                        <p className="text-muted-foreground m-0 text-xs">小白</p>
                        <p className="mt-1 mb-0 text-xs">{roleLabel(activeRole)}</p>
                      </div>
                      <div>
                        <p className="text-muted-foreground m-0 text-xs">难度</p>
                        <p className="mt-1 mb-0 text-xs">{difficultyShort(activeDifficulty)}</p>
                      </div>
                    </div>
                    <p className="text-muted-foreground m-0 border-t border-border pt-2.5 text-[0.7rem] leading-relaxed">
                      角色和难度已锁定。
                    </p>
                  </div>
                ) : (
                  <>
                    <div className="space-y-1.5">
                      <Label htmlFor="feynman-mode" className="text-xs">
                        训练模式
                      </Label>
                      <Select
                        value={draftMode}
                        onValueChange={(value) => onModeChange(value as PracticeMode)}
                      >
                        <SelectTrigger id="feynman-mode" className="h-9 w-full text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {PRACTICE_MODES.map((mode) => (
                            <SelectItem key={mode} value={mode}>
                              {PRACTICE_MODE_LABELS[mode]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="feynman-category" className="text-xs">
                          分类
                        </Label>
                        <Select value={topicCategory} onValueChange={onTopicCategoryChange}>
                          <SelectTrigger id="feynman-category" className="h-9 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {topicCategories.map((category) => (
                              <SelectItem key={category} value={category}>
                                {category}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="feynman-topic-pick" className="text-xs">
                          题库
                        </Label>
                        <Select value={topicId ?? "custom"} onValueChange={onTopicSelect}>
                          <SelectTrigger id="feynman-topic-pick" className="h-9 w-full text-xs">
                            <SelectValue placeholder="选择概念" />
                          </SelectTrigger>
                          <SelectContent>
                            <SelectItem value="custom">自定义概念</SelectItem>
                            {topics
                              .filter(
                                (topic) =>
                                  topicCategory === "全部" || topic.category === topicCategory,
                              )
                              .map((topic) => (
                                <SelectItem key={topic.id} value={topic.id}>
                                  {topic.title}
                                </SelectItem>
                              ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="feynman-topic" className="text-xs">
                        我要讲的概念
                      </Label>
                      <Textarea
                        id="feynman-topic"
                        value={draftTopic}
                        onChange={(event) => onTopicChange(event.target.value)}
                        rows={2}
                        className="min-h-16 resize-none text-xs leading-relaxed"
                      />
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <div className="space-y-1.5">
                        <Label htmlFor="feynman-role" className="text-xs">
                          小白是谁
                        </Label>
                        <Select
                          value={learnerRole}
                          onValueChange={(value) =>
                            onLearnerRoleChange(value as FeynmanLearnerRole)
                          }
                        >
                          <SelectTrigger id="feynman-role" className="h-9 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {ROLE_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="feynman-difficulty" className="text-xs">
                          追问难度
                        </Label>
                        <Select
                          value={difficulty}
                          onValueChange={(value) =>
                            onDifficultyChange(value as FeynmanDifficulty)
                          }
                        >
                          <SelectTrigger id="feynman-difficulty" className="h-9 w-full text-xs">
                            <SelectValue />
                          </SelectTrigger>
                          <SelectContent>
                            {DIFFICULTY_OPTIONS.map((option) => (
                              <SelectItem key={option.value} value={option.value}>
                                {option.label}
                              </SelectItem>
                            ))}
                          </SelectContent>
                        </Select>
                      </div>
                    </div>
                  </>
                )}
              </CardContent>
            </Card>
          </aside>
        )}
      </div>

      {error && (
        <div className="border-destructive/30 bg-destructive/8 text-destructive shrink-0 rounded-xl border px-4 py-3 text-sm">
          {error}
        </div>
      )}
      {discardDialog}
    </div>
  );
}
