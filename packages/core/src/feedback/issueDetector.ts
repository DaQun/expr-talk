import {
  REVIEW_METRIC_THRESHOLDS,
  type Issue,
  type SessionMetrics,
} from "@showtalk/shared";

export function detectIssues(metrics: SessionMetrics): Issue[] {
  const issues: Issue[] = [];

  if (metrics.fillerCount >= 5) {
    issues.push({
      code: "too_many_fillers",
      title: "填充词偏多",
      severity: metrics.fillerCount >= 10 ? "high" : "medium",
      evidence: `检测到 ${metrics.fillerCount} 个填充词`,
      suggestion: "停顿时先静默半秒，再继续，而不是用「嗯/那个」填空。",
    });
  }

  if (metrics.hedgeCount >= 4) {
    issues.push({
      code: "hedging",
      title: "犹豫表达较多",
      severity: "medium",
      evidence: `检测到 ${metrics.hedgeCount} 处犹豫词`,
      suggestion: "把「可能/好像」换成明确判断，必要时再补充限定条件。",
    });
  }

  if (metrics.vagueWordCount >= 4) {
    issues.push({
      code: "vague_language",
      title: "表述偏模糊",
      severity: "medium",
      evidence: `检测到 ${metrics.vagueWordCount} 处模糊词`,
      suggestion: "用具体数字、对象和动作替换「一些/东西/弄一下」。",
    });
  }

  if (metrics.repetitionRate >= REVIEW_METRIC_THRESHOLDS.repetitionRate) {
    issues.push({
      code: "repetition",
      title: "重复表述偏多",
      severity: "low",
      evidence: `重复率 ${(metrics.repetitionRate * 100).toFixed(1)}%`,
      suggestion: "同一观点只说一次，补充时换角度而不是复述原句。",
    });
  }

  if (metrics.densityScore < REVIEW_METRIC_THRESHOLDS.densityScore) {
    issues.push({
      code: "low_density",
      title: "信息密度偏低",
      severity: metrics.densityScore < 55 ? "high" : "medium",
      evidence: `密度分 ${metrics.densityScore}`,
      suggestion: "每句话尽量带一个事实或结论，删掉过渡废话。",
    });
  }

  if (
    (metrics.longPauseCount ?? 0) >=
    REVIEW_METRIC_THRESHOLDS.longPauseCount
  ) {
    issues.push({
      code: "long_pause",
      title: "长停顿较多",
      severity: "low",
      evidence: `长停顿 ${metrics.longPauseCount} 次`,
      suggestion: "用提纲关键词降低卡壳；必要时允许短暂停，但避免失联式沉默。",
    });
  }

  return issues.slice(0, 5);
}
