/**
 * 表达密度粗估：有效字数 / (有效字数 + 填充/犹豫/模糊惩罚)。
 * 返回 0~100。
 */
export function computeDensityScore(input: {
  totalChars: number;
  fillerCount: number;
  hedgeCount: number;
  vagueWordCount: number;
}): number {
  const { totalChars, fillerCount, hedgeCount, vagueWordCount } = input;
  if (totalChars <= 0) return 0;
  const penalty = fillerCount * 2 + hedgeCount * 1.5 + vagueWordCount * 1.5;
  const score = (totalChars / (totalChars + penalty)) * 100;
  return Math.round(Math.max(0, Math.min(100, score)));
}
