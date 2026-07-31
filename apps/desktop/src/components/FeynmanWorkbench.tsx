import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import {
  BrainCircuit,
  CheckCircle2,
  CircleDashed,
  Keyboard,
  Lightbulb,
  MessageCircleQuestion,
  Mic,
  RefreshCw,
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
import { PRACTICE_MODE_LABELS, PRACTICE_MODES } from "@expr-talk/shared";
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
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

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
  pasteText: string;
  learnerRole: FeynmanLearnerRole;
  difficulty: FeynmanDifficulty;
  modelReady: boolean | null;
  recorderPanel: ReactNode;
  discardDialog?: ReactNode;
  guidance: ReactNode;
  analyzeNote: string | null;
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

const DIFFICULTY_OPTIONS: Array<{ value: FeynmanDifficulty; label: string }> = [
  { value: "gentle", label: "温和：先讲清核心" },
  { value: "standard", label: "标准：四项都要覆盖" },
  { value: "challenge", label: "挑战：追问边界与反例" },
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

function roleLabel(role: FeynmanLearnerRole): string {
  return ROLE_OPTIONS.find((option) => option.value === role)?.label ?? "领域外成年人";
}

function difficultyLabel(difficulty: FeynmanDifficulty): string {
  return (
    DIFFICULTY_OPTIONS.find((option) => option.value === difficulty)?.label ??
    "标准：四项都要覆盖"
  );
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
  pasteText,
  learnerRole,
  difficulty,
  modelReady,
  recorderPanel,
  discardDialog,
  guidance,
  analyzeNote,
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
  onOpenReview,
}: FeynmanWorkbenchProps) {
  const [inputMode, setInputMode] = useState<InputMode>("text");
  const [newSessionFrom, setNewSessionFrom] = useState<string | null>(null);
  const [historyExpanded, setHistoryExpanded] = useState(false);
  const conversationRef = useRef<HTMLDivElement>(null);
  const session = current?.mode === "feynman" ? current : null;
  const debate = session?.debate;
  // 录音开始后状态会从 debating 切为 recording，但本轮仍需要看见小白的问题。
  const isComplete = session?.status === "reviewed";
  const replacingCompletedSession = isComplete && newSessionFrom === session?.id;
  const showingCompleted = isComplete && !replacingCompletedSession;
  const visibleDebate = replacingCompletedSession ? undefined : debate;
  const hasStarted = Boolean(visibleDebate) && (recording || waiting || analyzing);
  const pendingQuestion = visibleDebate?.pendingQuestion;
  const active = recording || waiting || analyzing;
  const checkpoints = visibleDebate?.feynman?.checkpoints ?? [];
  const activeRole = visibleDebate?.feynman?.learnerRole ?? learnerRole;
  const activeDifficulty = visibleDebate?.feynman?.difficulty ?? difficulty;

  const checkpointById = useMemo(
    () => new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint])),
    [checkpoints],
  );

  useEffect(() => {
    if (!conversationRef.current) return;
    conversationRef.current.scrollTop = conversationRef.current.scrollHeight;
  }, [visibleDebate?.turns.length, pendingQuestion, historyExpanded]);

  const showVoiceRecorder = recording || (!hasStarted && inputMode === "voice");
  const canSubmitText =
    Boolean(pasteText.trim()) &&
    !analyzing &&
    (!hasStarted || Boolean(pendingQuestion));
  const userTurns = visibleDebate?.turns.filter((turn) => turn.role === "user") ?? [];
  const conversationTurns =
    visibleDebate?.turns.filter(
      (turn, index, turns) =>
        !(
          pendingQuestion &&
          turn.role === "opponent" &&
          index === turns.length - 1
        ),
    ) ?? [];
  const latestConversationTurn = conversationTurns[conversationTurns.length - 1];

  return (
    <div className="feynman-workbench flex flex-col gap-4">
      <PageHeader
        title="费曼学习"
        description="把概念讲给小白听。小白只会根据你的讲解追问，直到能够自己复述。"
        action={
          <Badge variant={modelReady === false ? "warning" : "success"}>
            ASR {modelReady === false ? "未就绪" : "就绪"}
          </Badge>
        }
      />

      {guidance}

      <div className="grid items-start gap-3 lg:grid-cols-[minmax(0,1fr)_15.5rem]">
        <div className="flex min-w-0 flex-col gap-3">
          {!hasStarted && (
            <Card>
              <CardHeader>
                <CardTitle className="text-base">开始一场讲解</CardTitle>
              </CardHeader>
              <CardContent className="grid gap-4">
                <div className="grid gap-3 md:grid-cols-[minmax(9rem,0.7fr)_minmax(0,1.3fr)]">
                  <div className="space-y-2">
                    <Label htmlFor="feynman-mode">训练模式</Label>
                    <Select value={draftMode} onValueChange={(value) => onModeChange(value as PracticeMode)}>
                      <SelectTrigger id="feynman-mode">
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
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="feynman-topic-category">主题分类</Label>
                      <Select value={topicCategory} onValueChange={onTopicCategoryChange}>
                        <SelectTrigger id="feynman-topic-category">
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
                    <div className="space-y-2">
                      <Label htmlFor="feynman-topic-pick">推荐主题</Label>
                      <Select value={topicId ?? "custom"} onValueChange={onTopicSelect}>
                        <SelectTrigger id="feynman-topic-pick">
                          <SelectValue placeholder="选择概念" />
                        </SelectTrigger>
                        <SelectContent>
                          {topicId === null && <SelectItem value="custom" disabled>自定义概念</SelectItem>}
                          {topics
                            .filter((topic) => topicCategory === "全部" || topic.category === topicCategory)
                            .map((topic) => (
                              <SelectItem key={topic.id} value={topic.id}>
                                {topic.title}
                              </SelectItem>
                            ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="feynman-topic">我要讲的概念</Label>
                  <Textarea
                    id="feynman-topic"
                    value={draftTopic}
                    onChange={(event) => onTopicChange(event.target.value)}
                    rows={3}
                    className="min-h-24"
                  />
                </div>

                <div className="grid gap-3 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="feynman-role">小白是谁</Label>
                    <Select value={learnerRole} onValueChange={(value) => onLearnerRoleChange(value as FeynmanLearnerRole)}>
                      <SelectTrigger id="feynman-role">
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
                  <div className="space-y-2">
                    <Label htmlFor="feynman-difficulty">追问难度</Label>
                    <Select value={difficulty} onValueChange={(value) => onDifficultyChange(value as FeynmanDifficulty)}>
                      <SelectTrigger id="feynman-difficulty">
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
              </CardContent>
            </Card>
          )}

          <Card className="min-h-0">
            <CardHeader className="border-border border-b pb-4">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base">讲解对话</CardTitle>
                <div className="flex items-center gap-2">
                  {visibleDebate && <Badge variant="outline">第 {visibleDebate.currentRound} 轮</Badge>}
                  {recording && <Badge variant="warning">录音中</Badge>}
                  {showingCompleted && <Badge variant="success">小白已理解</Badge>}
                </div>
              </div>
            </CardHeader>
            <CardContent className="flex min-h-[22rem] flex-col gap-3 pt-4">
              {conversationTurns.length ? (
                <div className="border-border bg-muted/20 rounded-lg border px-3 py-2.5">
                  <div className="flex items-center justify-between gap-3">
                    <span className="text-muted-foreground text-xs">
                      {historyExpanded ? "此前对话" : "上一条对话"}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      onClick={() => setHistoryExpanded((expanded) => !expanded)}
                    >
                      {historyExpanded ? "收起记录" : `查看 ${conversationTurns.length} 条记录`}
                    </Button>
                  </div>
                  {historyExpanded ? (
                    <div
                      ref={conversationRef}
                      className="mt-2 max-h-[13rem] space-y-2 overflow-y-auto pr-1"
                    >
                      {conversationTurns.map((turn) => (
                        <div
                          key={turn.id}
                          className={cn(
                            "rounded-md border px-3 py-2 text-sm leading-relaxed",
                            turn.role === "user"
                              ? "border-primary/20 bg-primary/7"
                              : "border-warning/25 bg-warning/8",
                          )}
                        >
                          <div className="text-muted-foreground mb-1 flex items-center gap-1.5 text-xs">
                            {turn.role === "user" ? <BrainCircuit className="size-3.5" /> : <MessageCircleQuestion className="size-3.5" />}
                            {turn.role === "user" ? "我的讲解" : "小白提问"} · 第 {turn.round} 轮
                          </div>
                          {turn.text}
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-muted-foreground mt-1.5 mb-0 line-clamp-2 text-sm leading-relaxed">
                      {latestConversationTurn?.text}
                    </p>
                  )}
                </div>
              ) : (
                <div className="text-muted-foreground flex min-h-24 flex-1 items-center justify-center text-center text-sm leading-relaxed">
                  选择一个概念，用自己的话从定义开始讲。
                </div>
              )}

              {pendingQuestion && (
                <div className="border-warning/35 bg-warning/10 rounded-lg border px-3.5 py-3">
                  <div className="text-warning-foreground mb-1 flex items-center gap-1.5 text-xs font-medium">
                    <MessageCircleQuestion className="size-3.5" /> 小白正在追问
                  </div>
                  <p className="m-0 text-sm leading-relaxed">{pendingQuestion}</p>
                </div>
              )}

              {!showingCompleted && (
                <div className="border-border bg-muted/25 mt-auto rounded-lg border p-3">
                  <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                    <Label className="text-foreground">{inputMode === "text" ? "用文字讲解" : "用语音讲解"}</Label>
                    <div className="bg-background flex items-center gap-1 rounded-lg border border-border p-1" role="group" aria-label="讲解输入方式">
                      <Button
                        type="button"
                        size="sm"
                        variant={inputMode === "text" ? "default" : "ghost"}
                        disabled={recording}
                        onClick={() => setInputMode("text")}
                      >
                        <Keyboard /> 文字
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant={inputMode === "voice" ? "default" : "ghost"}
                        disabled={recording}
                        onClick={() => setInputMode("voice")}
                      >
                        <Mic /> 语音
                      </Button>
                    </div>
                  </div>

                  {inputMode === "text" ? (
                    <>
                      <Textarea
                        value={pasteText}
                        onChange={(event) => onPasteTextChange(event.target.value)}
                        placeholder={pendingQuestion ? "直接回答小白刚才的问题…" : "直接讲给小白听…"}
                        disabled={analyzing || recording || isComplete}
                        rows={5}
                        className="min-h-32"
                      />
                      <div className="mt-3 flex flex-wrap gap-2">
                        <Button disabled={!canSubmitText || recording} onClick={onSubmitText}>
                          {hasStarted ? "提交本轮讲解" : "开始文字讲解"}
                        </Button>
                      </div>
                    </>
                  ) : showVoiceRecorder ? (
                    recorderPanel
                  ) : pendingQuestion ? (
                    <Button disabled={analyzing} onClick={onStartResponse}>
                      <Mic /> 开始录音讲解
                    </Button>
                  ) : (
                    <Button disabled={active} onClick={onStartVoice}>
                      <Mic /> 开始录音讲解
                    </Button>
                  )}
                </div>
              )}

              {!pendingQuestion && !recording && hasStarted && !showingCompleted && (
                <Button variant="secondary" disabled={analyzing} onClick={onRetryQuestion}>
                  <RefreshCw /> 重新生成小白提问
                </Button>
              )}

              {showingCompleted && (
                <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                  <p className="text-muted-foreground m-0 text-sm">小白已经能根据你的讲解理解这个概念。</p>
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="secondary"
                      onClick={() => setNewSessionFrom(session?.id ?? null)}
                    >
                      新建讲解
                    </Button>
                    <Button onClick={onOpenReview}>查看复盘</Button>
                  </div>
                </div>
              )}
            </CardContent>
          </Card>
        </div>

        <aside className="flex min-w-0 flex-col gap-3 lg:sticky lg:top-6">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">理解检查点</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              {CHECKPOINTS.map((definition) => {
                const checkpoint = checkpointById.get(definition.id) ?? {
                  id: definition.id,
                  status: "not_started" as const,
                };
                const status = CHECKPOINT_STATUS[checkpoint.status];
                const Icon = status.Icon;
                return (
                  <div key={definition.id} className="border-border border-b pb-3 last:border-b-0 last:pb-0">
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <p className="m-0 text-sm font-medium">{definition.label}</p>
                        <p className="text-muted-foreground mt-0.5 mb-0 text-xs leading-relaxed">{definition.description}</p>
                      </div>
                      <span className={cn("inline-flex shrink-0 items-center gap-1 rounded-full border px-2 py-0.5 text-xs", status.className)}>
                        <Icon className="size-3" /> {status.label}
                      </span>
                    </div>
                    {checkpoint.evidence && (
                      <p className="text-muted-foreground mt-2 mb-0 text-xs leading-relaxed">{checkpoint.evidence}</p>
                    )}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-base">本场设定</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3 text-sm">
              <div>
                <p className="text-muted-foreground m-0 text-xs">小白角色</p>
                <p className="mt-1 mb-0">{roleLabel(activeRole)}</p>
              </div>
              <div>
                <p className="text-muted-foreground m-0 text-xs">追问难度</p>
                <p className="mt-1 mb-0">{difficultyLabel(activeDifficulty)}</p>
              </div>
              {hasStarted && userTurns.length > 0 && (
                <p className="text-muted-foreground m-0 border-t border-border pt-3 text-xs leading-relaxed">
                  角色和难度已锁定，避免模型在对话中改变理解标准。
                </p>
              )}
            </CardContent>
          </Card>
        </aside>
      </div>

      {analyzeNote && (
        <p className="text-muted-foreground m-0 text-sm" role="status">
          {analyzeNote}
        </p>
      )}
      {error && (
        <div className="border-destructive/30 bg-destructive/10 text-destructive rounded-lg border px-3.5 py-3 text-sm">
          {error}
        </div>
      )}
      {discardDialog}
    </div>
  );
}
