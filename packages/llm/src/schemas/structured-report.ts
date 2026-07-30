/** 供 LLM 结构化输出参考的 JSON Schema 描述（运行时校验后续可接 zod/ajv） */
export const structuredReportJsonSchema = {
  type: "object",
  required: [
    "schemaVersion",
    "summary",
    "scores",
    "logicReview",
    "topIssues",
    "sentenceFeedback",
    "rewriteExamples",
    "nextPractice",
  ],
  properties: {
    schemaVersion: { type: "number" },
    summary: { type: "string" },
    scores: {
      type: "object",
      additionalProperties: { type: "number" },
    },
    logicReview: {
      type: "object",
      required: ["thesis", "support", "coherence", "closure", "verdict"],
      properties: {
        thesis: { type: "string" },
        support: { type: "string" },
        coherence: { type: "string" },
        closure: { type: "string" },
        verdict: { type: "string" },
      },
    },
    topIssues: {
      type: "array",
      items: {
        type: "object",
        required: ["code", "title", "severity"],
        properties: {
          code: { type: "string" },
          title: { type: "string" },
          severity: { type: "string", enum: ["low", "medium", "high"] },
          evidence: { type: "string" },
          suggestion: { type: "string" },
        },
      },
    },
    sentenceFeedback: { type: "array" },
    rewriteExamples: { type: "array" },
    nextPractice: {
      type: "object",
      required: ["targetIssue", "instruction", "retryPrompt", "successCriteria"],
      properties: {
        targetIssue: { type: "string" },
        instruction: { type: "string" },
        retryPrompt: { type: "string" },
        successCriteria: { type: "array", items: { type: "string" } },
      },
    },
  },
} as const;
