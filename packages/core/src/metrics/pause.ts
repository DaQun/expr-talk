/**
 * 长停顿次数：相邻 final segment 间隔 > thresholdMs。
 * 真实实现依赖时间戳；无时间戳时返回 undefined。
 */
export function countLongPauses(
  segments: Array<{ startMs?: number; endMs?: number; isFinal: boolean }>,
  thresholdMs = 2000,
): number | undefined {
  const finals = segments.filter(
    (s) => s.isFinal && s.endMs != null && s.startMs != null,
  );
  if (finals.length < 2) {
    return finals.length === 0 ? undefined : 0;
  }

  let count = 0;
  for (let i = 1; i < finals.length; i++) {
    const prevEnd = finals[i - 1].endMs!;
    const nextStart = finals[i].startMs!;
    if (nextStart - prevEnd > thresholdMs) count += 1;
  }
  return count;
}
