import {
  ISSUE_CODE_LABELS,
  type AttemptComparison,
} from "@expr-talk/shared";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardFooter,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cn } from "@/lib/utils";

type Props = {
  comparison: AttemptComparison;
};

const DIMENSION_LABELS = {
  content: "内容质量",
  logic: "逻辑结构",
  expression: "表达质量",
  voice: "语音表现",
  scenario_task: "场景任务",
} as const;

function Delta({
  label,
  before,
  after,
  delta,
  betterWhen,
  beforeNumeric,
  afterNumeric,
}: {
  label: string;
  before: number | string;
  after: number | string;
  delta: number;
  betterWhen: "lower" | "higher" | "target-range";
  beforeNumeric?: number;
  afterNumeric?: number;
}) {
  const paceDistance = (value: number) =>
    value < 160 ? 160 - value : value > 280 ? value - 280 : 0;
  const good = betterWhen === "target-range"
    ? beforeNumeric == null || afterNumeric == null
      ? null
      : paceDistance(afterNumeric) === paceDistance(beforeNumeric)
        ? null
        : paceDistance(afterNumeric) < paceDistance(beforeNumeric)
    : delta === 0
      ? null
      : betterWhen === "lower"
        ? delta < 0
        : delta > 0;
  const sign = delta > 0 ? `+${delta}` : `${delta}`;

  return (
    <div className="bg-background flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <div className="text-muted-foreground min-w-[5em] text-sm">{label}</div>
      <div className="flex items-center gap-2 tabular-nums">
        <span className="text-muted-foreground">{before}</span>
        <span aria-hidden>→</span>
        <strong>{after}</strong>
        <span
          className={cn(
            "font-semibold",
            good === null && "text-muted-foreground",
            good === true && "text-success",
            good === false && "text-destructive",
          )}
        >
          {sign}
        </span>
      </div>
    </div>
  );
}

export function ComparisonCard({ comparison }: Props) {
  const { before, after, deltas } = comparison;
  const targetDimension = deltas.targetDimension;
  const beforeTargetScore = targetDimension
    ? before.dimensionScores?.[targetDimension]
    : undefined;
  const afterTargetScore = targetDimension
    ? after.dimensionScores?.[targetDimension]
    : undefined;

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between space-y-0">
        <CardTitle className="text-base">
          复练对比 · 第 {comparison.round} 轮
        </CardTitle>
        <Badge variant={comparison.improved ? "success" : "warning"}>
          {comparison.improved ? "有进步" : "再练一轮"}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {comparison.targetIssue ? (
          <p className="text-muted-foreground m-0 text-sm">
            本轮目标：
            {ISSUE_CODE_LABELS[
              comparison.targetIssue as keyof typeof ISSUE_CODE_LABELS
            ] ?? comparison.targetIssue}
          </p>
        ) : null}

        <div className="flex flex-col gap-2">
          {targetDimension &&
            deltas.targetDimensionDelta != null &&
            beforeTargetScore != null &&
            afterTargetScore != null && (
              <Delta
                label={`目标 · ${DIMENSION_LABELS[targetDimension]}`}
                before={beforeTargetScore}
                after={afterTargetScore}
                delta={deltas.targetDimensionDelta}
                betterWhen="higher"
              />
            )}
          <Delta
            label="填充词"
            before={before.fillerCount}
            after={after.fillerCount}
            delta={deltas.fillerDelta}
            betterWhen="lower"
          />
          <Delta
            label="犹豫词"
            before={before.hedgeCount}
            after={after.hedgeCount}
            delta={deltas.hedgeDelta}
            betterWhen="lower"
          />
          <Delta
            label="模糊词"
            before={before.vagueWordCount}
            after={after.vagueWordCount}
            delta={deltas.vagueDelta}
            betterWhen="lower"
          />
          <Delta
            label="信息密度"
            before={before.densityScore}
            after={after.densityScore}
            delta={deltas.densityDelta}
            betterWhen="higher"
          />
          {before.wordsPerMinute != null &&
            after.wordsPerMinute != null &&
            deltas.wpmDelta != null && (
              <Delta
                label="语速(字/分)"
                before={before.wordsPerMinute}
                after={after.wordsPerMinute}
                delta={deltas.wpmDelta}
                betterWhen="target-range"
                beforeNumeric={before.wordsPerMinute}
                afterNumeric={after.wordsPerMinute}
              />
            )}
          {before.clarity != null &&
            after.clarity != null &&
            deltas.clarityDelta != null && (
              <Delta
                label="清晰度"
                before={before.clarity}
                after={after.clarity}
                delta={deltas.clarityDelta}
                betterWhen="higher"
              />
            )}
        </div>

        <ul className="m-0 list-disc space-y-1 pl-5 text-sm">
          {comparison.notes.map((n) => (
            <li key={n}>{n}</li>
          ))}
        </ul>

        {comparison.successCriteriaMet.length > 0 && (
          <div>
            <div className="text-muted-foreground text-sm">达成的成功标准</div>
            <ul className="mt-1.5 list-disc space-y-1 pl-5 text-sm">
              {comparison.successCriteriaMet.map((c) => (
                <li key={c}>{c}</li>
              ))}
            </ul>
          </div>
        )}
      </CardContent>
      <CardFooter>
        {comparison.parentAvailable !== false ? (
          <Button variant="ghost" size="sm" asChild>
            <Link to={`/review/${comparison.parentSessionId}`}>查看上一轮</Link>
          </Button>
        ) : (
          <span className="text-muted-foreground text-sm">上一轮已删除，对比快照仍保留</span>
        )}
      </CardFooter>
    </Card>
  );
}
