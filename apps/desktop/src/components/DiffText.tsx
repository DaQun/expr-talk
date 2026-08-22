import { cn } from "@/lib/utils";

export type DiffSegment =
  | { type: "equal"; text: string }
  | { type: "delete"; text: string }
  | { type: "insert"; text: string };

/**
 * 字符级 LCS diff：用于两句改写对照。
 * 长度超过 DIFF_LIMIT 时不做 diff，避免 O(n*m) 卡顿。
 */
const DIFF_LIMIT = 500;

export function computeDiff(original: string, rewritten: string): DiffSegment[] {
  const a = original;
  const b = rewritten;
  const n = a.length;
  const m = b.length;

  if (n > DIFF_LIMIT || m > DIFF_LIMIT) {
    return [{ type: "equal", text: rewritten }];
  }
  if (n === 0) return b ? [{ type: "insert", text: b }] : [];
  if (m === 0) return a ? [{ type: "delete", text: a }] : [];

  // dp[i][j]: a[i..] 与 b[j..] 的最长公共子序列长度
  const dp: Uint16Array[] = Array.from({ length: n + 1 }, () =>
    new Uint16Array(m + 1),
  );
  for (let i = n - 1; i >= 0; i--) {
    for (let j = m - 1; j >= 0; j--) {
      dp[i][j] =
        a[i] === b[j]
          ? dp[i + 1][j + 1] + 1
          : Math.max(dp[i + 1][j], dp[i][j + 1]);
    }
  }

  const result: DiffSegment[] = [];
  let i = 0;
  let j = 0;
  const push = (type: DiffSegment["type"], text: string) => {
    if (!text) return;
    const last = result[result.length - 1];
    if (last && last.type === type) {
      last.text += text;
    } else {
      result.push({ type, text });
    }
  };

  while (i < n && j < m) {
    if (a[i] === b[j]) {
      push("equal", a[i]);
      i++;
      j++;
    } else if (dp[i + 1][j] >= dp[i][j + 1]) {
      push("delete", a[i]);
      i++;
    } else {
      push("insert", b[j]);
      j++;
    }
  }
  while (i < n) {
    push("delete", a[i]);
    i++;
  }
  while (j < m) {
    push("insert", b[j]);
    j++;
  }
  return result;
}

type Props = {
  original: string;
  rewritten: string;
  className?: string;
};

/**
 * 改写对照 Diff：删除线为原文被改的部分，绿色高亮为新增改写。
 * 超长文本退化为仅展示改写句，不做字符级对比。
 */
export function DiffText({ original, rewritten, className }: Props) {
  if (!rewritten) {
    return (
      <p className={cn("m-0 whitespace-pre-wrap text-sm leading-relaxed", className)}>
        {original}
      </p>
    );
  }
  const segments = computeDiff(original, rewritten);
  const tooLong = original.length > DIFF_LIMIT || rewritten.length > DIFF_LIMIT;

  return (
    <div className={cn("space-y-1", className)}>
      {tooLong && (
        <p className="text-muted-foreground m-0 text-xs">文本较长，仅列出改写结果：</p>
      )}
      <p className="m-0 whitespace-pre-wrap text-sm leading-relaxed">
        {segments.map((segment, index) => {
          if (segment.type === "delete") {
            return (
              <del
                key={index}
                className="text-destructive/80 decoration-destructive"
              >
                {segment.text}
              </del>
            );
          }
          if (segment.type === "insert") {
            return (
              <ins
                key={index}
                className="bg-success/10 text-success font-medium rounded-sm px-0.5 no-underline"
              >
                {segment.text}
              </ins>
            );
          }
          return <span key={index}>{segment.text}</span>;
        })}
      </p>
    </div>
  );
}