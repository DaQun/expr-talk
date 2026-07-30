/**
 * 结构分：确定性层只能给弱信号（句数、重复）。
 * 完整结构判断交给 LLM；此处返回「启发式占位分」。
 */
export function scoreStructureHeuristic(input: {
  utteranceCount: number;
  repetitionRate: number;
}): number {
  let score = 70;
  if (input.utteranceCount < 2) score -= 15;
  if (input.utteranceCount >= 3 && input.utteranceCount <= 8) score += 10;
  score -= Math.round(input.repetitionRate * 40);
  return Math.round(Math.max(0, Math.min(100, score)));
}
