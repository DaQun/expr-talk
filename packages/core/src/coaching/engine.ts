import type { Issue, NextPractice, PracticeMode } from "@showtalk/shared";
import {
  MODE_PRACTICE_HINTS,
  normalizePracticeMode,
  PRACTICE_MODE_LABELS,
} from "@showtalk/shared";

/** 每次只给 1 个主要改进目标 */
export function buildNextPractice(
  issues: Issue[],
  originalTopicHint: string,
  mode: PracticeMode | string = "free",
): NextPractice {
  const m = normalizePracticeMode(mode);
  const primary = issues[0];
  const modeLabel = PRACTICE_MODE_LABELS[m];
  const modeHint = MODE_PRACTICE_HINTS[m];
  const topic =
    originalTopicHint?.trim() ||
    `请按「${modeLabel}」要求重新表达刚才的主题。`;

  if (!primary) {
    return {
      targetIssue: "unclear_structure",
      instruction: `【${modeLabel}】${modeHint}`,
      retryPrompt: topic,
      successCriteria: modeSuccessDefaults(m),
    };
  }

  // targetIssue 使用 IssueCode；无 issue 时的 fallback 上面用了临时值，这里正规处理
  switch (primary.code) {
    case "too_many_fillers":
      return {
        targetIssue: "too_many_fillers",
        instruction: `【${modeLabel}】下一轮把填充词控制在 3 个以内；卡壳用静默。同时注意：${modeHint}`,
        retryPrompt: topic,
        successCriteria: [
          "填充词少于 3 个",
          "表达完整覆盖原主题",
          ...modeSuccessDefaults(m).slice(0, 1),
        ],
      };
    case "hedging":
      return {
        targetIssue: "hedging",
        instruction: `【${modeLabel}】下一轮用明确判断开场，少用「可能/好像/应该」。${modeHint}`,
        retryPrompt: topic,
        successCriteria: [
          "开场 10 秒内给出明确立场",
          "犹豫词少于 2 个",
        ],
      };
    case "late_conclusion":
      return {
        targetIssue: "late_conclusion",
        instruction: `【${modeLabel}】下一轮请在前 10–15 秒说出结论或立场。${modeHint}`,
        retryPrompt: topic,
        successCriteria: [
          "前 15 秒出现明确判断",
          "后续有至少 2 个支撑点",
        ],
      };
    case "low_density":
      return {
        targetIssue: "low_density",
        instruction: `【${modeLabel}】下一轮每句一个信息点，删掉过渡废话。${modeHint}`,
        retryPrompt: topic,
        successCriteria: [
          "时长不超过上一轮或建议时长",
          "至少 3 个具体信息点",
        ],
      };
    default:
      return {
        targetIssue: primary.code,
        instruction:
          primary.suggestion ??
          `【${modeLabel}】针对主问题再练一轮。${modeHint}`,
        retryPrompt: topic,
        successCriteria: [
          "完成完整表达",
          "针对主问题有可观察改善",
          ...modeSuccessDefaults(m).slice(0, 1),
        ],
      };
  }
}

function modeSuccessDefaults(mode: PracticeMode): string[] {
  switch (mode) {
    case "free":
      return ["60–90 秒内说完", "有清晰结构、少填充词"];
    case "short_video":
      return ["前 3 秒有钩子", "结尾有行动号召", "约 45–60 秒"];
    case "debate":
      return ["立场一句说清", "两条可检验论据", "回应一个反方点"];
    case "feynman":
      return ["用大白话定义概念", "说明关键因果或步骤", "给出具体例子"];
    default:
      return ["完成完整表达"];
  }
}
