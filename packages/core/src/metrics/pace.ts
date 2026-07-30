/** 中文语速：字/分钟。正常口语参考 180–260 */
export function computeWordsPerMinute(
  totalWords: number,
  durationSec?: number,
): number | undefined {
  if (!durationSec || durationSec <= 0) return undefined;
  return Math.round((totalWords / durationSec) * 60);
}
