import type { DebateState, LLMConfig } from "@showtalk/shared";
import { chatCompletion } from "./openai_compatible";
import type { LLMRequestOptions } from "./types";

export type DebateTurnResult = {
  question: string;
  focus: string;
};

const SYSTEM = `你是一个严格、公平、简洁的中文辩论教练。用户正在进行立论训练。
根据题目和完整辩论记录，扮演反方提出一条最值得回答的质询，不要替用户回答。
质询必须具体、可回应，优先攻击论据的证据、边界条件、因果链或与题目要求的偏离。
不得重复之前任何一轮已经问过的论点、类比、句式或攻击角度；如果用户已回应过某个攻击点，必须换成新的、未被回应过的角度（新的证据、新的边界条件或新的因果链），换一个次优的新角度也比重复强。
最终响应必须是单个 JSON 对象（不要 Markdown、不要代码围栏、不要前言后语），字段：
{"question": string, "focus": string}
规则：question 最多两句、80 字；focus 不超过 20 字。是否结束辩论由用户决定。
若你有内部思考过程，思考中不要复述本条格式要求或出现「输出 JSON」之类的收尾语。`;

export async function generateDebateTurn(
  state: DebateState,
  topic: string,
  config: LLMConfig,
  options?: LLMRequestOptions,
): Promise<DebateTurnResult> {
  const raw = await chatCompletion(
    config,
    [
      { role: "system", content: SYSTEM },
      {
        role: "user",
        content: JSON.stringify({
          topic,
          currentRound: state.currentRound,
          turns: state.turns.map(({ role, round, text }) => ({
            role,
            round,
            text,
          })),
        }),
      },
    ],
    {
      responseFormatJson: true,
      temperature: 0.5,
      signal: options?.signal,
      stream: true,
      onProgress: options?.onProgress,
    },
  );

  return parseDebateTurnResult(raw);
}

export function parseDebateTurnResult(raw: string): DebateTurnResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(
      raw.trim().replace(/^```json\s*/i, "").replace(/\s*```$/i, ""),
    );
  } catch {
    throw new Error("反方质询不是合法 JSON");
  }
  if (!parsed || typeof parsed !== "object") throw new Error("反方质询格式错误");
  const obj = parsed as Record<string, unknown>;
  const question = typeof obj.question === "string" ? obj.question.trim() : "";
  if (!question) throw new Error("模型没有生成反方质询");
  return {
    question,
    focus: typeof obj.focus === "string" ? obj.focus.trim() : "",
  };
}
