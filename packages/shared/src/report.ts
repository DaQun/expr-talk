import type { Issue, IssueCode } from "./transcript";
import type { ScoreDimension } from "./mode";

export const REPORT_SCHEMA_VERSION = 4;

export type EvaluationDimensionKey =
  | "content"
  | "logic"
  | "expression"
  | "voice"
  | "scenario_task";

export type EvaluationSource = "llm" | "objective" | "mixed";

export type DimensionReview = {
  score: number;
  verdict: string;
  evidence: string;
  source: EvaluationSource;
};

export type TaskCheckStatus = "met" | "partial" | "missed";

export type TaskCheck = {
  label: string;
  status: TaskCheckStatus;
  evidence?: string;
};

export type ReportSource = "rule" | "llm";

export type AnalysisCoverage = {
  strategy: "full" | "sampled";
  originalChars: number;
  analyzedChars: number;
  note?: string;
};

export type StructuredReport = {
  schemaVersion: number;
  summary: string;
  scores: Partial<Record<ScoreDimension, number>>;
  /** 面向复盘页的稳定一级维度；旧报告可能没有。 */
  dimensionReviews?: Partial<Record<EvaluationDimensionKey, DimensionReview>>;
  /** 题目或训练场景中的显式要求完成情况；旧报告可能没有。 */
  taskChecks?: TaskCheck[];
  /** 对整篇表达的论证链诊断；旧报告可能没有。 */
  logicReview?: LogicReview;
  topIssues: Issue[];
  sentenceFeedback: SentenceFeedbackItem[];
  rewriteExamples: RewriteExample[];
  nextPractice: NextPractice;
  /** 报告来源：规则引擎 / LLM（失败会降级为 rule） */
  source?: ReportSource;
  /** 送入模型的文本覆盖范围；客观指标始终按全文计算。 */
  analysisCoverage?: AnalysisCoverage;
};

export type LogicReview = {
  thesis: string;
  support: string;
  coherence: string;
  closure: string;
  verdict: string;
};

export type SentenceFeedbackItem = {
  utteranceId?: string;
  original: string;
  issues: IssueCode[];
  comment: string;
};

export type RewriteExample = {
  original: string;
  rewritten: string;
  focus: string;
};

export type NextPractice = {
  targetIssue: IssueCode;
  instruction: string;
  retryPrompt: string;
  successCriteria: string[];
};

export function emptyStructuredReport(): StructuredReport {
  return {
    schemaVersion: REPORT_SCHEMA_VERSION,
    summary: "",
    scores: {},
    topIssues: [],
    sentenceFeedback: [],
    rewriteExamples: [],
    nextPractice: {
      targetIssue: "too_many_fillers",
      instruction: "",
      retryPrompt: "",
      successCriteria: [],
    },
  };
}
