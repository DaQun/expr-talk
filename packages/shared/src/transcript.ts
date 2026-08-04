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

export const ISSUE_CODES = [
  "late_conclusion",
  "too_many_fillers",
  "hedging",
  "vague_language",
  "repetition",
  "low_density",
  "long_pause",
  "unclear_structure",
  "weak_reasoning",
  "unsupported_claim",
  "logic_gap",
  "contradiction",
  "missing_conclusion",
  "missing_action",
  "weak_hook",
  "task_deviation",
  "insufficient_duration",
  "missing_thesis",
  "missing_example",
  "missing_definition",
  "audience_mismatch",
  "weak_response",
  "long_sentence",
] as const;

export type IssueCode = (typeof ISSUE_CODES)[number];

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
  task_deviation: "偏离题目要求",
  insufficient_duration: "表达时长不足",
  missing_thesis: "缺少明确观点",
  missing_example: "缺少具体例子",
  missing_definition: "关键概念解释不足",
  audience_mismatch: "没有匹配听众认知",
  weak_response: "回应质疑不充分",
  long_sentence: "句子过长",
};

const ISSUE_CODE_SET = new Set<string>(ISSUE_CODES);

const LEGACY_ISSUE_RULES: Array<[IssueCode, RegExp]> = [
  ["insufficient_duration", /duration|length_insufficient|时长|时间不足/],
  ["weak_hook", /weak_hook|missing_hook|hook|钩子|开头.{0,4}吸引/],
  ["missing_action", /missing_action|call_to_action|\bcta\b|行动号召|行动指引/],
  ["task_deviation", /off_topic|task_(deviation|mismatch)|missed_task|no_content|topic_deviation|偏离|跑题|未完成题目|违背.*要求|拒绝回答/],
  ["missing_thesis", /no_(thesis|stance|opinion|personal_stance)|missing_thesis|weak_thesis|观点不明确|立场不明确|缺乏.{0,4}(观点|立场|主题)|没有.{0,4}(观点|立场)/],
  ["missing_example", /(missing|no|lack|absent).{0,2}example|example_(missing|absent)|缺少.{0,4}例|没有.{0,4}例/],
  ["missing_definition", /(missing|no|lack).{0,2}definition|definition_(absent|missing)|boundary_omitted|缺少.{0,6}(定义|解释|机制)|未.{0,4}(定义|解释)/],
  ["audience_mismatch", /audience|听众|初学者|小白/],
  ["weak_response", /weak_response|poor_response|no_rebuttal|回应.{0,4}(不足|薄弱|无效)|未.{0,4}回应|反驳不足/],
  ["too_many_fillers", /filler|填充词|填充语|口头禅/],
  ["hedging", /hedg|犹豫|不够坚定/],
  ["vague_language", /vague|含糊|模糊|directness|不够直接/],
  ["repetition", /repeat|repetition|重复/],
  ["low_density", /low_density|density|信息密度|内容空洞/],
  ["long_pause", /pause|停顿/],
  ["late_conclusion", /late_conclusion|结论.{0,4}(太晚|滞后)/],
  ["missing_conclusion", /missing_conclusion|no_conclusion|缺少.{0,4}(结论|结尾)|没有.{0,4}(结论|总结)/],
  ["contradiction", /contradiction|矛盾|前后不一/],
  ["logic_gap", /logic_(gap|jump)|causality|推理.{0,4}(跳跃|断层)|因果.{0,4}(跳跃|不清)/],
  ["unsupported_claim", /unsupported|missing_arguments|论据|缺少.{0,4}(理由|支撑|证据)/],
  ["weak_reasoning", /weak_reasoning|logic_circular|论证.{0,4}(较弱|薄弱|循环)/],
  ["unclear_structure", /structure|flow|结构|层次|主线/],
  ["long_sentence", /run_on|long_sentence|句子.{0,4}(过长|冗长)/],
];

/** 将模型和历史报告中的自由编码收敛到稳定的问题分类。 */
export function normalizeIssueCode(
  value: unknown,
  context = "",
): IssueCode | undefined {
  if (typeof value !== "string") return undefined;
  const normalized = value.trim().toLowerCase();
  if (ISSUE_CODE_SET.has(normalized)) return normalized as IssueCode;
  const searchable = `${normalized} ${context.toLowerCase()}`;
  return LEGACY_ISSUE_RULES.find(([, pattern]) => pattern.test(searchable))?.[0];
}

export type Issue = {
  code: IssueCode;
  title: string;
  severity: "low" | "medium" | "high";
  evidence?: string;
  suggestion?: string;
};
