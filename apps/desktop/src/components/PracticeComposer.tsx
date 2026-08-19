import { useEffect, useRef } from "react";
import { ArrowUp, CircleStop, Keyboard, Mic, RefreshCw, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { cn } from "@/lib/utils";

export type PracticeInputMode = "text" | "voice";

/** 录音态所需的实时数据与操作；与闲置态共用底部输入壳，避免整块面板硬切换。 */
export type DebateRecordingUi = {
  seconds: number;
  levelPct: number;
  asrStatus: string | null;
  finalSegments: Array<{ id: string; text: string }>;
  partialText: string;
  onStop: () => void;
  onRerecord: () => void;
};

export type PracticeComposerLabels = {
  toggleAriaLabel: string;
  hint: string;
  textPlaceholder: string;
  sendAriaLabel: string;
  voiceHint: string;
  startLabel: string;
  recordingLabel: string;
  stopLabel: string;
};

type PracticeComposerProps = {
  inputMode: PracticeInputMode;
  onInputModeChange: (mode: PracticeInputMode) => void;
  recording: boolean;
  analyzing: boolean;
  llmReady: boolean;
  /** 锁定语音/文字切换（录音、分析、或交互模式等待中） */
  inputLocked?: boolean;
  pasteText: string;
  onPasteTextChange: (text: string) => void;
  recordingUi: DebateRecordingUi;
  onStart: () => void;
  onSubmitText: () => void;
  onAbandon: () => void;
  labels: PracticeComposerLabels;
};

function formatTimer(totalSeconds: number) {
  const mm = String(Math.floor(totalSeconds / 60)).padStart(2, "0");
  const ss = String(totalSeconds % 60).padStart(2, "0");
  return `${mm}:${ss}`;
}

export function PracticeComposer({
  inputMode,
  onInputModeChange,
  recording,
  analyzing,
  llmReady,
  inputLocked = false,
  pasteText,
  onPasteTextChange,
  recordingUi,
  onStart,
  onSubmitText,
  onAbandon,
  labels,
}: PracticeComposerProps) {
  const captionScrollRef = useRef<HTMLDivElement>(null);
  const captionAutoFollowRef = useRef(true);
  const hasLiveCaption = Boolean(
    recordingUi.finalSegments.length > 0 || recordingUi.partialText.trim(),
  );
  const sendDisabled = !pasteText.trim() || analyzing || !llmReady || recording;

  useEffect(() => {
    captionAutoFollowRef.current = true;
  }, [recording]);

  useEffect(() => {
    const container = captionScrollRef.current;
    if (!container || !captionAutoFollowRef.current) return;
    const frame = window.requestAnimationFrame(() => {
      container.scrollTop = container.scrollHeight;
    });
    return () => window.cancelAnimationFrame(frame);
  }, [recordingUi.finalSegments, recordingUi.partialText, recording]);

  return (
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
              onValueChange={(value) => value && onInputModeChange(value as PracticeInputMode)}
              disabled={inputLocked}
              aria-label={labels.toggleAriaLabel}
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
            <span className="text-muted-foreground hidden text-xs sm:block">{labels.hint}</span>
          </div>
        </div>
      </div>

      {inputMode === "text" && !recording ? (
        <div className="flex items-end gap-2">
          <Textarea
            value={pasteText}
            onChange={(event) => onPasteTextChange(event.target.value)}
            placeholder={labels.textPlaceholder}
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
            aria-label={labels.sendAriaLabel}
            title={labels.sendAriaLabel}
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
                  <span className="text-muted-foreground text-xs">{labels.recordingLabel}</span>
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
                <Button size="sm" disabled={analyzing} onClick={recordingUi.onStop}>
                  <CircleStop className="size-3.5" />
                  {analyzing ? "分析中…" : labels.stopLabel}
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
                <span className="truncate">{labels.voiceHint}</span>
              </div>
              {/* 主操作入口：waiting 时也必须可点（勿用含 waiting 的 active 禁用） */}
              <Button size="sm" disabled={analyzing || !llmReady} onClick={onStart}>
                <Mic className="size-3.5" /> {labels.startLabel}
              </Button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
