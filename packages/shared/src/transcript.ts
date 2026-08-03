/** ASR 原始产物：边界由端点检测决定 */
export type TranscriptSegment = {
  id: string;
  startMs?: number;
  endMs?: number;
  text: string;
  isFinal: boolean;
  confidence?: number;
};

/**
 * 分析单元：由 Transcript Pipeline 对 final segment 切分/合并生成。
 * 一个 Utterance 可映射 1..N 个 segment。
 */
export type Utterance = {
  id: string;
  sessionId: string;
  text: string;
  startMs?: number;
  endMs?: number;
  segmentIds: string[];
  timeSource?: "segment" | "estimated" | "none";
  metrics?: UtteranceMetrics;
  feedback?: SentenceFeedback;
};

export type UtteranceMetrics = {
  charCount: number;
  fillerCount: number;
  hedgeCount: number;
  vagueWordCount: number;
};

/** 逐句诊断（规则或 LLM） */
export type SentenceFeedback = {
  utteranceId: string;
  issues: IssueCode[];
  comment: string;
  evidence?: string;
};

export type IssueCode =
  | "late_conclusion"
  | "too_many_fillers"
  | "hedging"
  | "vague_language"
  | "repetition"
  | "low_density"
  | "long_pause"
  | "unclear_structure"
  | "weak_reasoning"
  | "unsupported_claim"
  | "logic_gap"
  | "contradiction"
  | "missing_conclusion"
  | "missing_action"
  | "weak_hook";

export const ISSUE_CODE_LABELS: Record<IssueCode, string> = {
  late_conclusion: "结论出现太晚",
  too_many_fillers: "填充词过多",
  hedging: "表达过于犹豫",
  vague_language: "表达含糊",
  repetition: "内容重复",
  low_density: "信息密度偏低",
  long_pause: "长停顿较多",
  unclear_structure: "结构不清晰",
  weak_reasoning: "论证较弱",
  unsupported_claim: "观点缺少支撑",
  logic_gap: "推理存在跳跃",
  contradiction: "前后存在矛盾",
  missing_conclusion: "缺少明确结论",
  missing_action: "缺少行动指引",
  weak_hook: "开头吸引力不足",
};

export type Issue = {
  code: IssueCode;
  title: string;
  severity: "low" | "medium" | "high";
  evidence?: string;
  suggestion?: string;
};
