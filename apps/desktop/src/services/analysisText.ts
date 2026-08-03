import type { AnalysisCoverage } from "@expr-talk/shared";

export const MAX_ANALYSIS_CHARS = 8_000;

export type SelectedAnalysisText = {
  text: string;
  coverage: AnalysisCoverage;
};

/** 超长内容保留开头、中央和结尾，避免结论总被静默截掉。 */
export function selectAnalysisText(
  input: string,
  maxChars = MAX_ANALYSIS_CHARS,
): SelectedAnalysisText {
  if (input.length <= maxChars) {
    return {
      text: input,
      coverage: {
        strategy: "full",
        originalChars: input.length,
        analyzedChars: input.length,
      },
    };
  }

  const marker = "\n\n[中间内容节选]\n\n";
  const available = Math.max(300, maxChars - marker.length * 2);
  const headLength = Math.floor(available * 0.34);
  const middleLength = Math.floor(available * 0.28);
  const tailLength = available - headLength - middleLength;
  const middleStart = Math.max(
    headLength,
    Math.floor((input.length - middleLength) / 2),
  );
  const text = [
    input.slice(0, headLength),
    input.slice(middleStart, middleStart + middleLength),
    input.slice(-tailLength),
  ].join(marker);

  return {
    text,
    coverage: {
      strategy: "sampled",
      originalChars: input.length,
      analyzedChars: headLength + middleLength + tailLength,
      note: "内容较长，报告综合分析了开头、中段和结尾；客观指标仍按全文计算。",
    },
  };
}
