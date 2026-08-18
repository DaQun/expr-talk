import {
  ISSUE_CODE_LABELS,
  normalizeIssueCode,
  type AttemptComparison,
} from "@showtalk/shared";
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
  paceRange?: [number, number];
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
  targetRange = [160, 280],
}: {
  label: string;
  before: number | string;
  after: number | string;
  delta: number;
  betterWhen: "lower" | "higher" | "target-range";
  beforeNumeric?: number;
  afterNumeric?: number;
  targetRange?: [number, number];
}) {
  const [rangeMin, rangeMax] = targetRange;
  const paceDistance = (value: number) =>
    value < rangeMin
      ? rangeMin - value
      : value > rangeMax
        ? value - rangeMax
        : 0;
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
  const value = Number.isInteger(delta) ? String(delta) : delta.toFixed(1);
  const sign = delta > 0 ? `+${value}` : value;

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

export function ComparisonCard({
  comparison,
  paceRange = [160, 280],
}: Props) {
  const { before, after, deltas } = comparison;
  const targetDimension = deltas.targetDimension;
  const normalizedTargetIssue = normalizeIssueCode(comparison.targetIssue);
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
        <Badge
          variant={
            comparison.conclusive === false
              ? "secondary"
              : comparison.improved
                ? "success"
                : "warning"
          }
        >
          {comparison.conclusive === false
            ? "结果不确定"
            : comparison.improved
              ? "有进步"
              : "未明显提升"}
        </Badge>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {comparison.targetIssue ? (
          <p className="text-muted-foreground m-0 text-sm">
            本轮目标：
            {normalizedTargetIssue
              ? ISSUE_CODE_LABELS[normalizedTargetIssue]
              : comparison.targetIssue}
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
            label={deltas.fillerRateDelta != null ? "填充词/百字" : "填充词"}
            before={before.fillerRate?.toFixed(1) ?? before.fillerCount}
            after={after.fillerRate?.toFixed(1) ?? after.fillerCount}
            delta={deltas.fillerRateDelta ?? deltas.fillerDelta}
            betterWhen="lower"
          />
          <Delta
            label={deltas.hedgeRateDelta != null ? "犹豫词/百字" : "犹豫词"}
            before={before.hedgeRate?.toFixed(1) ?? before.hedgeCount}
            after={after.hedgeRate?.toFixed(1) ?? after.hedgeCount}
            delta={deltas.hedgeRateDelta ?? deltas.hedgeDelta}
            betterWhen="lower"
          />
          <Delta
            label={deltas.vagueRateDelta != null ? "模糊词/百字" : "模糊词"}
            before={before.vagueRate?.toFixed(1) ?? before.vagueWordCount}
            after={after.vagueRate?.toFixed(1) ?? after.vagueWordCount}
            delta={deltas.vagueRateDelta ?? deltas.vagueDelta}
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
                targetRange={paceRange}
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
