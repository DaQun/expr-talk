import type { PracticeMode, ScoreRubric, TrainingGoal } from "./mode";
import type { SessionMetrics } from "./metrics";
import type { StructuredReport } from "./report";
import type { FeynmanCheckpoint } from "./session";

export type LLMTask =
  | "realtime_hint"
  | "final_report"
  | "sentence_rewrite"
  | "coach_question"
  | "training_plan"
  | "progress_summary";

/** V1 默认启用的 LLM 任务 */
export const MVP_LLM_TASKS: LLMTask[] = [
  "final_report",
  "sentence_rewrite",
  "coach_question",
];

export type LLMConfig = {
  providerId: string;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  temperature?: number;
};

export type LLMProviderInfo = {
  id: string;
  name: string;
  local: boolean;
  supportsStructuredOutput: boolean;
};

export type LLMReportInput = {
  mode: PracticeMode;
  /** 用户实际看到并回答的完整题目/提示。 */
  topic: string;
  goal: TrainingGoal | string;
  transcript: string;
  metrics: SessionMetrics;
  userProfile?: Record<string, unknown>;
  rubric?: ScoreRubric;
  /** 费曼练习中已累计的检查点；复盘不得另起一套更严的清单。 */
  feynmanCheckpoints?: FeynmanCheckpoint[];
};

export type LLMTaskResultMap = {
  final_report: StructuredReport;
  sentence_rewrite: {
    examples: Array<{ original: string; rewritten: string; focus: string }>;
  };
  coach_question: { questions: string[] };
  realtime_hint: { hint: string };
  training_plan: { plan: string[] };
  progress_summary: { summary: string };
};
