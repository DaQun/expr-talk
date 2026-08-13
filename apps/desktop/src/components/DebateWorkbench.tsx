import { useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUp,
  Check,
  CircleStop,
  Keyboard,
  MessageCircle,
  Mic,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  Scale,
  Sparkles,
  UserRound,
  X,
} from "lucide-react";
import type { PracticeMode, PracticeTopic, TrainingSession } from "@expr-talk/shared";
import { MODE_SUGGESTED_DURATION_SEC, PRACTICE_MODE_LABELS, PRACTICE_MODES } from "@expr-talk/shared";
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
import { ReasoningBlock } from "@/components/ReasoningBlock";
import { cn } from "@/lib/utils";

/** 距底部多少像素内视为「贴底」，用于判断是否需要自动跟随 */
const CONVERSATION_STICK_BOTTOM_PX = 64;

type InputMode = "text" | "voice";

/** 辩论录音态所需的实时数据与操作；与闲置态共用底部输入壳，避免整块面板硬切换。 */
export type DebateRecordingUi = {
  seconds: number;
  levelPct: number;
  asrStatus: string | null;
  finalSegments: Array<{ id: string; text: string }>;
  partialText: string;
  onStop: () => void;
  onRerecord: () => void;
};

type DebateWorkbenchProps = {
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
  modelReady: boolean | null;
  llmReady: boolean;
  llmReason?: string;
  recordingUi: DebateRecordingUi;
  discardDialog?: ReactNode;
  error: string | null;
  modeRubricLine: string;
  onModeChange: (mode: PracticeMode) => void;
  onTopicCategoryChange: (category: string) => void;
  onTopicSelect: (id: string) => void;
  onTopicChange: (topic: string) => void;
  onPasteTextChange: (text: string) => void;
  onStartVoice: () => void;
  onStartResponse: () => void;
  onSubmitText: () => void;
  onRetryQuestion: () => void;
  onFinish: () => void;
  onAbandon: () => void;
};

function turnLabel(role: "user" | "opponent") {
  return role === "user" ? "我方" : "反方 AI";
}

function formatTimer(totalSeconds: number) {
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function DebateWorkbench({
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
  modelReady,
  llmReady,
  llmReason,
  recordingUi,
  discardDialog,
  error,
  modeRubricLine,
  onModeChange,
  onTopicCategoryChange,
  onTopicSelect,
  onTopicChange,
  onPasteTextChange,
  onStartVoice,
  onStartResponse,
  onSubmitText,
  onRetryQuestion,
  onFinish,
  onAbandon,
}: DebateWorkbenchProps) {
  const [inputMode, setInputMode] = useState<InputMode>("voice");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const conversationRef = useRef<HTMLDivElement>(null);
  const conversationAutoFollowRef = useRef(true);
  const captionScrollRef = useRef<HTMLDivElement>(null);
  const captionAutoFollowRef = useRef(true);
  const debate = current?.mode === "debate" ? current.debate : undefined;
  const active = recording || waiting || analyzing;
  const hasStarted = Boolean(debate) && active;
  const currentTopic = ((hasStarted ? current?.topic : draftTopic) ?? "").trim();
  const turns = useMemo(() => {
    const all = debate?.turns ?? [];
    return all.filter(
      (turn, index) =>
        !(debate?.pendingQuestion && turn.role === "opponent" && index === all.length - 1),
    );
  }, [debate]);
  const userTurnCount = turns.filter((turn) => turn.role === "user").length;
  const round = debate?.currentRound ?? (hasStarted ? 1 : 0);
  const pendingQuestion = debate?.pendingQuestion;
  // 待答问题对应的思考过程：取自完整 turns 中最后一条反方回复（turns 列表已过滤掉它）。
  const pendingReasoning = pendingQuestion
    ? [...(debate?.turns ?? [])].reverse().find((turn) => turn.role === "opponent")?.reasoning
    : undefined;
  const hasLiveCaption = Boolean(
    recordingUi.finalSegments.length > 0 || recordingUi.partialText.trim(),
  );
  // 模型侧内容长度：流式思考/正文或落盘后的质询，任一增长都应触发贴底滚动
  const modelReplySignature = analyzing
    ? `stream:${streamedReasoning?.length ?? 0}:${streamedQuestion?.length ?? 0}`
    : `pending:${pendingQuestion ?? ""}:${pendingReasoning?.length ?? 0}`;

  function isConversationNearBottom(node: HTMLElement) {
    return node.scrollHeight - node.scrollTop - node.clientHeight <= CONVERSATION_STICK_BOTTOM_PX;
  }

  function scrollConversationToBottom() {
    const node = conversationRef.current;
    if (!node) return;
    // 对话面板可滚动时只滚面板；否则滚到最后一条，避免整页卡住看不到新回复
    if (node.scrollHeight > node.clientHeight + 1) {
      node.scrollTop = node.scrollHeight;
      return;
    }
    const last = node.lastElementChild as HTMLElement | null;
    last?.scrollIntoView({ block: "end", behavior: "auto" });
  }

  // 新会话或用户发言后：重新贴底，避免上一轮手动上滑影响后续模型回复
  useEffect(() => {
    conversationAutoFollowRef.current = true;
  }, [current?.id, userTurnCount]);

  // 模型回复/流式输出时：强制贴底，保证最新质询可见
  useLayoutEffect(() => {
    const node = conversationRef.current;
    if (!node) return;
    // 模型输出中始终跟随；其它时候仅在用户仍贴底时跟随
    const forceFollow = analyzing || Boolean(pendingQuestion) || Boolean(streamedQuestion);
    if (!forceFollow && !conversationAutoFollowRef.current && !isConversationNearBottom(node)) {
      return;
    }

    conversationAutoFollowRef.current = true;
    // 双 rAF：等 flex 布局与气泡高度稳定后再滚，避免 scrollHeight 仍是旧值
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
    pendingReasoning,
    modelReplySignature,
    streamedQuestion,
    analyzing,
    recording,
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

  const sendDisabled = !pasteText.trim() || analyzing || !llmReady || recording;
  const canFinish = userTurnCount > 0 && waiting;
  const canAbandonSession =
    Boolean(current) &&
    current?.status !== "reviewed" &&
    current?.status !== "completed";
  const statusLabel = analyzing
    ? "处理中"
    : recording
      ? "录音中"
      : waiting
        ? "等待回应"
        : hasStarted
          ? "进行中"
          : "准备开始";

  // 固定视口高度，让对话区成为唯一滚动容器，模型回复才能可靠贴底
  return (
    <div className="debate-workbench flex h-[calc(100dvh-5.5rem)] max-h-[calc(100dvh-5.5rem)] min-h-0 flex-col gap-3 overflow-hidden">
      {!llmReady && (
        <div className="border-destructive/25 bg-destructive/8 text-destructive flex shrink-0 items-start gap-3 rounded-xl border px-4 py-3 text-sm">
          <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="m-0 font-medium">开始辩论前需要配置大模型</p>
            <p className="mt-1 mb-0 text-xs opacity-85">{llmReason ?? "请先完成大模型配置。"}</p>
          </div>
          <Button size="sm" variant="outline" asChild>
            <Link to="/settings">去设置</Link>
          </Button>
        </div>
      )}

      <div className="flex shrink-0 items-center justify-between gap-3 px-1">
        <div className="flex min-w-0 items-center gap-3">
          <div className="bg-primary/12 text-primary grid size-10 shrink-0 place-items-center rounded-xl">
            <Scale className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 truncate text-xl font-semibold tracking-tight">辩论训练</h1>
              <Badge variant={active ? "success" : "secondary"}>{statusLabel}</Badge>
            </div>
            <p className="text-muted-foreground m-0 mt-0.5 text-xs">
              先立论，再回应反方质询 · 建议 {MODE_SUGGESTED_DURATION_SEC.debate} 秒
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

      <div className={cn("grid min-h-0 flex-1 items-stretch gap-4 overflow-hidden", detailsOpen && "lg:grid-cols-[minmax(0,1fr)_17rem]")}>
        <Card
          className={cn(
            "debate-chat-card flex h-full min-h-0 min-w-0 flex-col gap-0 overflow-hidden py-0 border-border/80 shadow-[0_8px_30px_oklch(0.28_0.02_255_/_5%)] transition-[border-color,box-shadow] duration-300",
            recording && "border-warning/35 shadow-[0_8px_30px_oklch(0.75_0.12_85_/_8%)]",
          )}
        >
          <CardHeader className="border-border/70 shrink-0 border-b px-5 py-4">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-sm font-semibold">对话</CardTitle>
                <p className="text-muted-foreground m-0 mt-1 truncate text-xs">
                  {currentTopic || "选择一个辩题，开始你的第一轮立论"}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {round > 0 && <Badge variant="outline">第 {round} 轮</Badge>}
                {modelReady !== null && (
                  <span className={cn("hidden items-center gap-1 text-xs sm:inline-flex", modelReady ? "text-success" : "text-warning-foreground")}>
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
                    {recording ? "正在立论…" : "准备好开始了吗？"}
                  </h2>
                  <p className="text-muted-foreground mt-2 mb-0 text-sm leading-relaxed">
                    {recording
                      ? "直接说出你的立场，实时字幕会出现在下方输入区。说完后点「停止本轮」。"
                      : "先写下或说出你的立场。AI 会以反方身份追问，帮助你把论据讲得更有说服力。"}
                  </p>
                </div>
              </div>
            )}

            {turns.map((turn) => {
              const isUser = turn.role === "user";
              return (
                <div key={turn.id} className={cn("flex items-end gap-2.5", isUser ? "justify-end" : "justify-start")}>
                  {!isUser && (
                    <div className="bg-warning/15 text-warning-foreground grid size-8 shrink-0 place-items-center rounded-full">
                      <Scale className="size-4" aria-hidden />
                    </div>
                  )}
                  <div className={cn("max-w-[min(78%,38rem)]", isUser && "items-end")}>
                    <div className={cn("mb-1 flex items-center gap-1.5 text-[0.68rem]", isUser ? "justify-end text-muted-foreground" : "text-muted-foreground")}>
                      {!isUser && <span>{turnLabel(turn.role)}</span>}
                      <span>第 {turn.round} 轮</span>
                      {isUser && <span>{turnLabel(turn.role)}</span>}
                    </div>
                    {!isUser && turn.reasoning && (
                      <ReasoningBlock reasoning={turn.reasoning} label="反方思考过程" />
                    )}
                    <div className={cn("rounded-2xl px-4 py-3 text-sm leading-relaxed whitespace-pre-wrap", isUser ? "bg-primary text-primary-foreground rounded-br-md" : "bg-muted/70 text-foreground rounded-bl-md")}>
                      {turn.text}
                    </div>
                  </div>
                  {isUser && (
                    <div className="bg-primary/12 text-primary grid size-8 shrink-0 place-items-center rounded-full">
                      <UserRound className="size-4" aria-hidden />
                    </div>
                  )}
                </div>
              );
            })}

            {pendingQuestion && (
              <div className="flex items-end gap-2.5">
                <div className="bg-warning/15 text-warning-foreground grid size-8 shrink-0 place-items-center rounded-full">
                  <Scale className="size-4" aria-hidden />
                </div>
                <div className="max-w-[min(78%,38rem)]">
                  <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-[0.68rem]">
                    <span>反方 AI</span><span>正在质询</span>
                  </div>
                  {pendingReasoning && (
                    <ReasoningBlock reasoning={pendingReasoning} label="反方思考过程" />
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
                  <div className="text-muted-foreground mb-1 text-[0.68rem]">反方 AI</div>
                  {streamedReasoning && (
                    <ReasoningBlock
                      reasoning={streamedReasoning}
                      label="反方思考过程"
                      defaultOpen
                    />
                  )}
                  <div className="bg-muted/70 text-muted-foreground rounded-2xl rounded-bl-md px-4 py-3 text-sm">
                    {streamedQuestion || analyzeNote || "正在组织下一轮质询…"}
                    <span className="bg-warning ml-1.5 inline-block size-1.5 animate-pulse rounded-full align-middle" aria-hidden />
                    {analyzeElapsed > 0 && <span className="ml-2 text-xs opacity-65">{analyzeElapsed}s</span>}
                  </div>
                </div>
              </div>
            )}

          </CardContent>

          <div className="border-border/70 bg-card/95 z-10 shrink-0 border-t p-4 shadow-[0_-8px_24px_oklch(0.28_0.02_255_/_5%)] backdrop-blur-sm">
            {waiting && !pendingQuestion && (
              <Button variant="secondary" className="mb-3 w-full" disabled={analyzing || !llmReady} onClick={onRetryQuestion}>
                <RefreshCw /> 重新生成反方质询
              </Button>
            )}

            {/* 输入壳：闲置 / 录音共用同一容器，原地扩展，避免整块「录音台」硬切换导致跳动 */}
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
                      aria-label="辩论输入方式"
                      className="rounded-lg border border-border bg-muted/35 p-0.5"
                    >
                      <ToggleGroupItem value="voice" aria-label="语音输入" className="h-8 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:shadow-sm">
                        <Mic className="size-3.5" /> 语音
                      </ToggleGroupItem>
                      <ToggleGroupItem value="text" aria-label="文字输入" className="h-8 rounded-md px-2.5 text-xs data-[state=on]:bg-card data-[state=on]:shadow-sm">
                        <Keyboard className="size-3.5" /> 文字
                      </ToggleGroupItem>
                    </ToggleGroup>
                    <span className="text-muted-foreground hidden text-xs sm:block">
                      {waiting ? "回应反方质询" : "先提交你的立论"}
                    </span>
                  </div>
                </div>
              </div>

              {inputMode === "text" && !recording ? (
                <div className="flex items-end gap-2">
                  <Textarea
                    value={pasteText}
                    onChange={(event) => onPasteTextChange(event.target.value)}
                    placeholder={waiting ? "回应反方刚才的质询…" : "先写下你的立论…"}
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
                    aria-label={waiting ? "提交回应" : "提交立论"}
                    title={waiting ? "提交回应" : "提交立论"}
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
                            {waiting || userTurnCount > 0 ? "本轮回应中" : "立论中"}
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
                          <div className="text-primary/90 mb-1 last:mb-0">{recordingUi.partialText}</div>
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
                        <Button
                          size="sm"
                          disabled={analyzing}
                          onClick={recordingUi.onStop}
                        >
                          <CircleStop className="size-3.5" />
                          {analyzing
                            ? "分析中…"
                            : waiting || userTurnCount > 0
                              ? "停止本轮回应"
                              : "停止本轮立论"}
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
                            ? "使用语音回应，实时字幕会显示在这里"
                            : "使用语音立论，实时字幕会显示在这里"}
                        </span>
                      </div>
                      {/* 主操作入口：waiting 时也必须可点（勿用 active 禁用，active 含 waiting） */}
                      <Button
                        size="sm"
                        disabled={analyzing || !llmReady}
                        onClick={waiting || hasStarted ? onStartResponse : onStartVoice}
                      >
                        <Mic className="size-3.5" /> {waiting || hasStarted ? "开始回应" : "开始立论"}
                      </Button>
                    </div>
                  )}
                </div>
              )}
            </div>

            {!recording && (
              <div className="mt-4 flex items-center justify-between gap-2 border-t pt-4">
                {canFinish && (
                  <Button variant="outline" size="sm" disabled={analyzing || !llmReady} onClick={onFinish}>
                    <Check /> 结束并复盘
                  </Button>
                )}
                {canAbandonSession && (
                  <Button variant="ghost" size="sm" disabled={analyzing} onClick={onAbandon}>
                    <X /> 放弃
                  </Button>
                )}
              </div>
            )}
          </div>
        </Card>

        {detailsOpen && (
          <aside className="flex min-h-0 min-w-0 flex-col gap-3 overflow-y-auto lg:h-full">
            <Card className="border-border/80">
              <CardHeader className="border-border/70 border-b px-4 py-3.5">
                <CardTitle className="text-sm">本场设定</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3.5 px-4 py-4">
                <div className="space-y-1.5">
                  <Label htmlFor="debate-mode" className="text-xs">训练模式</Label>
                  <Select value={draftMode} onValueChange={(value) => onModeChange(value as PracticeMode)} disabled={active}>
                    <SelectTrigger id="debate-mode" className="h-9 w-full text-xs"><SelectValue /></SelectTrigger>
                    <SelectContent>{PRACTICE_MODES.map((mode) => <SelectItem key={mode} value={mode}>{PRACTICE_MODE_LABELS[mode]}</SelectItem>)}</SelectContent>
                  </Select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-1.5">
                    <Label htmlFor="debate-category" className="text-xs">分类</Label>
                    <Select value={topicCategory} onValueChange={onTopicCategoryChange} disabled={active}>
                      <SelectTrigger id="debate-category" className="h-9 w-full text-xs"><SelectValue /></SelectTrigger>
                      <SelectContent>{topicCategories.map((category) => <SelectItem key={category} value={category}>{category}</SelectItem>)}</SelectContent>
                    </Select>
                  </div>
                  <div className="space-y-1.5">
                    <Label htmlFor="debate-topic-pick" className="text-xs">题库</Label>
                    <Select value={topicId ?? "custom"} onValueChange={onTopicSelect} disabled={active}>
                      <SelectTrigger id="debate-topic-pick" className="h-9 w-full text-xs"><SelectValue placeholder="选择题目" /></SelectTrigger>
                      <SelectContent>
                        <SelectItem value="custom">自定义题目</SelectItem>
                        {topics.filter((topic) => topicCategory === "全部" || topic.category === topicCategory).map((topic) => (
                          <SelectItem key={topic.id} value={topic.id}>{topic.title}{topic.side === "pro" ? " · 正方" : topic.side === "con" ? " · 反方" : ""}</SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="debate-topic" className="text-xs">辩题</Label>
                  <Textarea id="debate-topic" value={draftTopic} onChange={(event) => onTopicChange(event.target.value)} disabled={active} rows={4} className="min-h-24 resize-none text-xs leading-relaxed" />
                </div>
                {!hasStarted && <Button className="w-full" disabled={!llmReady || active || analyzing} onClick={inputMode === "voice" ? onStartVoice : onSubmitText}>{inputMode === "voice" ? <><Mic /> 开始语音立论</> : <><ArrowUp /> 提交文字立论</>}</Button>}
              </CardContent>
            </Card>

            <Card className="border-border/80">
              <CardHeader className="border-border/70 border-b px-4 py-3.5"><CardTitle className="text-sm">本场进度</CardTitle></CardHeader>
              <CardContent className="flex flex-col gap-3 px-4 py-4">
                <div className="flex items-center justify-between text-sm"><span className="text-muted-foreground">已完成回应</span><span className="font-semibold tabular-nums">{userTurnCount} 轮</span></div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted"><div className="bg-primary h-full rounded-full transition-all" style={{ width: `${Math.min(100, userTurnCount * 20)}%` }} /></div>
                <div className="border-border border-t pt-3"><p className="text-muted-foreground m-0 text-xs">评分重点</p><p className="mt-1.5 mb-0 text-xs leading-relaxed">{modeRubricLine}</p></div>
              </CardContent>
            </Card>

            {hasStarted && (
              <div className="text-muted-foreground flex items-start gap-2 px-1 text-xs leading-relaxed"><CircleStop className="mt-0.5 size-3.5 shrink-0" /> 每轮回应后，AI 会根据你的论据继续追问。</div>
            )}
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
