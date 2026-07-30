import type { DebateState, LLMConfig } from "@expr-talk/shared";
import { chatCompletion } from "./openai_compatible";
import type { LLMRequestOptions } from "./types";

export type FeynmanTurnResult = {
  understood: boolean;
  question: string;
  focus: string;
};

const SYSTEM = `你是一个好奇、诚实的中文初学者。用户正用费曼学习法向你解释一个概念。
你只能根据用户在这场对话中已经说过的话判断，不能用自己已有知识补全缺失内容。
如果还不能理解，就只问一个最能暴露缺口的问题，优先问定义、因果机制、例子、边界或易混淆点；不要一次问多个问题，也不要替用户解释。
只有当你已经能用自己的话说明这个概念是什么、为什么或怎样运作，并能联系到用户给出的例子或适用边界时，才判定理解。
只输出合法 JSON，不要 Markdown：
{"understood": boolean, "question": string, "focus": string}
规则：understood 为 false 时 question 必须非空且最多两句、80 字；understood 为 true 时 question 必须为空，focus 用一句话概括你已经理解到的内容。`;

export async function generateFeynmanTurn(
  state: DebateState,
  topic: string,
  config: LLMConfig,
  options?: LLMRequestOptions,
): Promise<FeynmanTurnResult> {
  const raw = await chatCompletion(
    config,
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          concept: topic,
          currentRound: state.currentRound,
          explanations: state.turns.map(({ role, round, text }) => ({
            speaker: role === "user" ? "teacher" : "learner",
            round,
            text,
          })),
        }),
      },
    ],
    {
      responseFormatJson: true,
      temperature: 0.3,
      signal: options?.signal,
      stream: true,
      onProgress: options?.onProgress,
    },
  );

  return parseFeynmanTurnResult(raw);
}

export function parseFeynmanTurnResult(raw: string): FeynmanTurnResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      raw.trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, ""),
    );
  } catch {
    throw new Error("小白理解判断不是合法 JSON");
  }
  if (!parsed || typeof parsed !== "object") {
    throw new Error("小白理解判断格式错误");
  }

  const value = parsed as Record<string, unknown>;
  if (typeof value.understood !== "boolean") {
    throw new Error("小白理解判断缺少 understood 布尔值");
  }
  const understood = value.understood;
  const question = typeof value.question === "string" ? value.question.trim() : "";
  if (!understood && !question) {
    throw new Error("小白还未理解，但没有提出问题");
  }

  return {
    understood,
    question: understood ? "" : question,
    focus: typeof value.focus === "string" ? value.focus.trim() : "",
  };
}
