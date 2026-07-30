/**
 * 基于 2-4 字 n-gram 的重复占比。
 * 返回 0~1，越高表示重复越多。
 */
export function computeRepetitionRate(text: string): number {
  const chars = text.replace(/[^\u4e00-\u9fffA-Za-z0-9]/g, "");
  if (chars.length < 4) return 0;

  const grams = new Map<string, number>();
  let total = 0;
  for (let n = 2; n <= 4; n++) {
    for (let i = 0; i <= chars.length - n; i++) {
      const g = chars.slice(i, i + n);
      grams.set(g, (grams.get(g) ?? 0) + 1);
      total += 1;
    }
  }
  if (total === 0) return 0;

  let repeated = 0;
  for (const count of grams.values()) {
    if (count > 1) repeated += count - 1;
  }
  return Math.min(1, repeated / total);
}
