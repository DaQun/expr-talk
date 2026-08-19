import { useRef, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import {
  Clapperboard,
  MessageCircle,
  Mic,
  PanelRightClose,
  PanelRightOpen,
  Shuffle,
  Sparkles,
  X,
} from "lucide-react";
import type { PracticeMode, PracticeTopic, TrainingSession } from "@showtalk/shared";
import {
  MODE_SUGGESTED_DURATION_SEC,
  pickRandomTopic,
  PRACTICE_MODE_LABELS,
  PRACTICE_MODES,
} from "@showtalk/shared";
import {
  PracticeComposer,
  type DebateRecordingUi,
  type PracticeInputMode,
} from "@/components/PracticeComposer";
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
import { cn } from "@/lib/utils";

type SoloMode = Extract<PracticeMode, "free" | "short_video">;

const SOLO_COPY: Record<
  SoloMode,
  {
    title: string;
    blurb: string;
    llmTitle: string;
    cardTitle: string;
    cardIdle: string;
    emptyTitle: string;
    emptyBody: string;
    recordingTitle: string;
    recordingBody: string;
    analyzingFallback: string;
    topicLabel: string;
    categoryLabel: string;
    pickLabel: string;
    customPick: string;
    composer: {
      toggleAriaLabel: string;
      hint: string;
      textPlaceholder: string;
      sendAriaLabel: string;
      voiceHint: string;
      startLabel: string;
      recordingLabel: string;
      stopLabel: string;
    };
  }
> = {
  free: {
    title: "自由发挥",
    blurb: "题目可自拟，说完即停",
    llmTitle: "开始练习前需要配置大模型",
    cardTitle: "练习",
    cardIdle: "写下或选择一个题目，开始开口",
    emptyTitle: "准备好开始了吗？",
    emptyBody: "先写下或说出你想练的内容。说完即停，马上进入复盘。",
    recordingTitle: "正在练习…",
    recordingBody: "实时字幕会出现在下方输入区。说完后点「停止并复盘」。",
    analyzingFallback: "正在整理复盘…",
    topicLabel: "题目",
    categoryLabel: "提示库",
    pickLabel: "提示",
    customPick: "自定义题目",
    composer: {
      toggleAriaLabel: "练习输入方式",
      hint: "说完即停，进入复盘",
      textPlaceholder: "写下你要练的内容…",
      sendAriaLabel: "提交并复盘",
      voiceHint: "使用语音练习，实时字幕会显示在这里",
      startLabel: "开始练习",
      recordingLabel: "练习中",
      stopLabel: "停止并复盘",
    },
  },
  short_video: {
    title: "口播训练",
    blurb: "选题口播，钩子开头",
    llmTitle: "开始口播前需要配置大模型",
    cardTitle: "口播",
    cardIdle: "选一个主题，前 3 秒给钩子",
    emptyTitle: "准备好开始了吗？",
    emptyBody: "按主题口播：前 3 秒钩子，一句一个点，结尾行动号召。说完即停。",
    recordingTitle: "正在口播…",
    recordingBody: "实时字幕会出现在下方输入区。说完后点「停止并复盘」。",
    analyzingFallback: "正在整理复盘…",
    topicLabel: "主题",
    categoryLabel: "分类",
    pickLabel: "题库",
    customPick: "自定义主题",
    composer: {
      toggleAriaLabel: "口播输入方式",
      hint: "说完即停，进入复盘",
      textPlaceholder: "写下这段口播稿…",
      sendAriaLabel: "提交并复盘",
      voiceHint: "使用语音口播，实时字幕会显示在这里",
      startLabel: "开始口播",
      recordingLabel: "口播中",
      stopLabel: "停止并复盘",
    },
  },
};

type SoloWorkbenchProps = {
  draftTopic: string;
  draftMode: PracticeMode;
  topicCategory: string;
  topicCategories: string[];
  topicId: string | null;
  topics: PracticeTopic[];
  current: TrainingSession | null;
  recording: boolean;
  analyzing: boolean;
  analyzeNote: string | null;
  analyzeElapsed: number;
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
  onSubmitText: () => void;
  onAbandon: () => void;
};

function isSoloMode(mode: PracticeMode): mode is SoloMode {
  return mode === "free" || mode === "short_video";
}

export function SoloWorkbench({
  draftTopic,
  draftMode,
  topicCategory,
  topicCategories,
  topicId,
  topics,
  current,
  recording,
  analyzing,
  analyzeNote,
  analyzeElapsed,
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
  onSubmitText,
  onAbandon,
}: SoloWorkbenchProps) {
  const [inputMode, setInputMode] = useState<PracticeInputMode>("voice");
  const [detailsOpen, setDetailsOpen] = useState(true);
  const topicInputRef = useRef<HTMLTextAreaElement>(null);

  const soloMode: SoloMode = isSoloMode(draftMode) ? draftMode : "free";
  const copy = SOLO_COPY[soloMode];
  const Icon = soloMode === "short_video" ? Clapperboard : Mic;
  const active = recording || analyzing;
  const suggestedSec = MODE_SUGGESTED_DURATION_SEC[soloMode];
  const currentTopic = ((active ? current?.topic : draftTopic) ?? draftTopic).trim();
  const canAbandon =
    Boolean(current) &&
    current?.status !== "reviewed" &&
    current?.status !== "completed" &&
    current?.status !== "failed";
  const statusLabel = analyzing ? "处理中" : recording ? "录音中" : "准备开始";
  const retryRound = current?.parentSessionId ? current.round : null;

  function handleTopicSelect(id: string) {
    onTopicSelect(id);
    if (id === "custom") topicInputRef.current?.focus();
  }

  return (
    <div className="solo-workbench flex h-[calc(100dvh-5.5rem)] max-h-[calc(100dvh-5.5rem)] min-h-0 flex-col gap-3 overflow-hidden">
      {!llmReady && (
        <div className="border-destructive/25 bg-destructive/8 text-destructive flex shrink-0 items-start gap-3 rounded-xl border px-4 py-3 text-sm">
          <Sparkles className="mt-0.5 size-4 shrink-0" aria-hidden />
          <div className="min-w-0 flex-1">
            <p className="m-0 font-medium">{copy.llmTitle}</p>
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
            <Icon className="size-5" aria-hidden />
          </div>
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="m-0 truncate text-xl font-semibold tracking-tight">{copy.title}</h1>
              <Badge variant={active ? "success" : "secondary"}>{statusLabel}</Badge>
              {retryRound != null && (
                <Badge variant="warning">复练第 {retryRound} 轮</Badge>
              )}
            </div>
            <p className="text-muted-foreground m-0 mt-0.5 text-xs">
              {copy.blurb} · 建议 {suggestedSec} 秒
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
          "grid min-h-0 flex-1 items-stretch gap-4 overflow-hidden",
          detailsOpen && "lg:grid-cols-[minmax(0,1fr)_17rem]",
        )}
      >
        <Card
          className={cn(
            "flex h-full min-h-0 min-w-0 flex-col gap-0 overflow-hidden border-border/80 py-0 shadow-[0_8px_30px_oklch(0.28_0.02_255_/_5%)] transition-[border-color,box-shadow] duration-300",
            recording && "border-warning/35 shadow-[0_8px_30px_oklch(0.75_0.12_85_/_8%)]",
          )}
        >
          <CardHeader className="border-border/70 shrink-0 border-b px-5 py-4">
            <div className="flex min-w-0 items-center justify-between gap-3">
              <div className="min-w-0">
                <CardTitle className="text-sm font-semibold">{copy.cardTitle}</CardTitle>
                <p className="text-muted-foreground m-0 mt-1 truncate text-xs">
                  {currentTopic || copy.cardIdle}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {modelReady !== null && (
                  <span
                    className={cn(
                      "hidden items-center gap-1 text-xs sm:inline-flex",
                      modelReady ? "text-success" : "text-warning-foreground",
                    )}
                  >
                    <span
                      className={cn(
                        "size-1.5 rounded-full",
                        modelReady ? "bg-success" : "bg-warning",
                      )}
                    />
                    麦克风 {modelReady ? "就绪" : "未就绪"}
                  </span>
                )}
              </div>
            </div>
          </CardHeader>

          <CardContent className="flex min-h-0 flex-1 flex-col gap-5 overflow-y-auto px-5 py-6">
            {analyzing ? (
              <div className="flex flex-1 items-center justify-center py-10">
                <div className="max-w-sm text-center">
                  <div className="bg-primary/10 text-primary mx-auto mb-4 grid size-12 place-items-center rounded-2xl">
                    <Sparkles className="size-6" aria-hidden />
                  </div>
                  <h2 className="m-0 text-base font-semibold">{copy.analyzingFallback}</h2>
                  <p className="text-muted-foreground mt-2 mb-0 text-sm leading-relaxed">
                    {analyzeNote || "模型正在生成复盘报告"}
                    {analyzeElapsed > 0 ? ` · ${analyzeElapsed}s` : ""}
                  </p>
                </div>
              </div>
            ) : (
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
                    {recording ? copy.recordingTitle : copy.emptyTitle}
                  </h2>
                  <p className="text-muted-foreground mt-2 mb-0 text-sm leading-relaxed">
                    {recording ? copy.recordingBody : copy.emptyBody}
                  </p>
                </div>
              </div>
            )}
          </CardContent>

          <div className="border-border/70 bg-card/95 z-10 shrink-0 border-t p-4 shadow-[0_-8px_24px_oklch(0.28_0.02_255_/_5%)] backdrop-blur-sm">
            <PracticeComposer
              inputMode={inputMode}
              onInputModeChange={setInputMode}
              recording={recording}
              analyzing={analyzing}
              llmReady={llmReady}
              inputLocked={active}
              pasteText={pasteText}
              onPasteTextChange={onPasteTextChange}
              recordingUi={recordingUi}
              onStart={onStartVoice}
              onSubmitText={onSubmitText}
              onAbandon={onAbandon}
              labels={copy.composer}
            />

            {!recording && canAbandon && (
              <div className="mt-4 flex items-center justify-end gap-2 border-t pt-4">
                <Button variant="ghost" size="sm" disabled={analyzing} onClick={onAbandon}>
                  <X /> 放弃
                </Button>
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
                  <Label htmlFor="solo-mode" className="text-xs">
                    训练模式
                  </Label>
                  <Select
                    value={draftMode}
                    onValueChange={(value) => onModeChange(value as PracticeMode)}
                    disabled={active}
                  >
                    <SelectTrigger id="solo-mode" className="h-9 w-full text-xs">
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
                    <Label htmlFor="solo-category" className="text-xs">
                      {copy.categoryLabel}
                    </Label>
                    <Select
                      value={topicCategory}
                      onValueChange={onTopicCategoryChange}
                      disabled={active}
                    >
                      <SelectTrigger id="solo-category" className="h-9 w-full text-xs">
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
                    <Label htmlFor="solo-topic-pick" className="text-xs">
                      {copy.pickLabel}
                    </Label>
                    <Select
                      value={topicId ?? "custom"}
                      onValueChange={handleTopicSelect}
                      disabled={active}
                    >
                      <SelectTrigger id="solo-topic-pick" className="h-9 w-full text-xs">
                        <SelectValue placeholder="选择题目" />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="custom">{copy.customPick}</SelectItem>
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
                  <Label htmlFor="solo-topic" className="text-xs">
                    {copy.topicLabel}
                  </Label>
                  <Textarea
                    id="solo-topic"
                    ref={topicInputRef}
                    value={draftTopic}
                    onChange={(event) => onTopicChange(event.target.value)}
                    disabled={active}
                    rows={4}
                    className="min-h-24 resize-none text-xs leading-relaxed"
                  />
                </div>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="w-full"
                  disabled={active}
                  onClick={() => {
                    const next = pickRandomTopic(soloMode, topicCategory, topicId ?? undefined);
                    onTopicSelect(next.id);
                  }}
                >
                  <Shuffle className="size-3.5" /> 换一题
                </Button>
              </CardContent>
            </Card>

            <Card className="border-border/80">
              <CardHeader className="border-border/70 border-b px-4 py-3.5">
                <CardTitle className="text-sm">本场进度</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-3 px-4 py-4">
                <div className="flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">建议时长</span>
                  <span className="font-semibold tabular-nums">{suggestedSec} 秒</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="bg-primary h-full rounded-full transition-all"
                    style={{
                      width: recording
                        ? `${Math.min(100, (recordingUi.seconds / suggestedSec) * 100)}%`
                        : "0%",
                    }}
                  />
                </div>
                <div className="border-border border-t pt-3">
                  <p className="text-muted-foreground m-0 text-xs">评分重点</p>
                  <p className="mt-1.5 mb-0 text-xs leading-relaxed">{modeRubricLine}</p>
                </div>
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
