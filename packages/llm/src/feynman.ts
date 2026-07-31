import type {
  DebateState,
  FeynmanCheckpoint,
  FeynmanDifficulty,
  FeynmanLearnerRole,
  LLMConfig,
} from "@expr-talk/shared";
import { chatCompletion } from "./openai_compatible";
import type { LLMRequestOptions } from "./types";

export type FeynmanTurnResult = {
  understood: boolean;
  question: string;
  focus: string;
  checkpoints: FeynmanCheckpoint[];
};

export const FEYNMAN_MAX_ROUNDS = 6;

export function shouldCompleteFeynmanTurn(
  currentRound: number,
  understood: boolean,
): boolean {
  return understood || currentRound >= FEYNMAN_MAX_ROUNDS;
}

const CHECKPOINT_STATUS_RANK: Record<FeynmanCheckpoint["status"], number> = {
  not_started: 0,
  in_progress: 1,
  understood: 2,
};

const ROLE_GUIDANCE: Record<FeynmanLearnerRole, string> = {
  child: "你是 10 岁小学生。用日常词汇提问，优先确认最基础的定义和直观例子。",
  student: "你是有一点基础的中学生。会追问步骤、因果关系和例子是否真的对应。",
  outsider: "你是完全不熟悉这个领域的成年人。会要求术语换成普通话，并关注实际用途。",
  challenger: "你是认真但怀疑的学习者。会追问反例、边界条件和容易误解的地方。",
};

const DIFFICULTY_GUIDANCE: Record<FeynmanDifficulty, string> = {
  gentle: "优先确认核心定义和一个直观例子；解释基本听懂就可以确认理解。",
  standard: "依次确认定义、机制、例子和一个适用边界；缺哪项就只问最关键的一项。",
  challenge: "在标准要求外，必须确认边界或反例；不要因为用户只给了术语或结论就判定理解。",
};

const SYSTEM = `你是一个好奇、诚实的中文初学者。用户正用费曼学习法向你解释一个概念。
角色映射必须严格遵守：speaker=teacher 的文本全部是用户本人给你的讲解；speaker=learner 的文本是你之前提出的问题。不存在另一位老师，也不要把用户当成需要复述答案的学生。
你只能根据用户在这场对话中已经说过的话判断，不能用自己已有知识补全缺失内容。
你的任务是判断自己是否已经听懂用户的讲解。只要用户在任意一轮已经清楚说明某个检查点，就将它标为 understood；不得要求用户换句话复述自己已经讲清楚的相同内容。
检查点是跨轮累积的：currentCheckpoints 中已经 understood 的项目不得降级；评估所有历史讲解，不要只看最后一轮。
如果还不能理解，就只问一个最能暴露缺口的问题，优先问定义、因果机制、例子、边界或易混淆点；不要一次问多个问题，也不要替用户解释。
只有当你已经能用自己的话说明这个概念是什么、为什么或怎样运作，并能联系到用户给出的例子或适用边界时，才判定理解。
只输出合法 JSON，不要 Markdown：
{"understood": boolean, "question": string, "focus": string, "checkpoints": [{"id":"definition"|"mechanism"|"example"|"boundary","status":"not_started"|"in_progress"|"understood","evidence":string}]}
规则：understood 为 false 时 question 必须非空且最多两句、80 字；understood 为 true 时 question 必须为空，focus 用一句话概括你已经理解到的内容。四个 checkpoints 必须全部输出，evidence 只写用户已讲清的内容或当前缺口，不要虚构。`;

function needsInitialFollowup(state: DebateState): boolean {
  return !state.turns.some(
    (turn) =>
      turn.role === "opponent" && !turn.text.startsWith("我已经理解"),
  );
}

function systemPrompt(requireFollowup: boolean): string {
  if (!requireFollowup) return SYSTEM;
  return `${SYSTEM}
这是第一次评估用户的讲解。你必须先提出一个具体追问来检验理解；本次必须返回 understood=false，不能确认已经理解。`;
}

export async function generateFeynmanTurn(
  state: DebateState,
  topic: string,
  config: LLMConfig,
  options?: LLMRequestOptions,
): Promise<FeynmanTurnResult> {
  const learnerRole = state.feynman?.learnerRole ?? "outsider";
  const difficulty = state.feynman?.difficulty ?? "standard";
  const requireFollowup = needsInitialFollowup(state);
  const messages = [
    { role: "system" as const, content: systemPrompt(requireFollowup) },
    {
      role: "user" as const,
      content: JSON.stringify({
        concept: topic,
        currentRound: state.currentRound,
        learnerRole,
        learnerInstructions: ROLE_GUIDANCE[learnerRole],
        difficulty,
        difficultyInstructions: DIFFICULTY_GUIDANCE[difficulty],
        currentCheckpoints: state.feynman?.checkpoints ?? [],
        explanations: state.turns.map(({ role, round, text }) => ({
          speaker: role === "user" ? "teacher" : "learner",
          round,
          text,
        })),
      }),
    },
  ];
  const requestOptions = {
    responseFormatJson: true,
    temperature: 0.3,
    signal: options?.signal,
    stream: true,
    onProgress: options?.onProgress,
  };
  const raw = await chatCompletion(config, messages, requestOptions);

  let result = parseFeynmanTurnResult(raw);
  if (requireFollowup && result.understood) {
    const retryRaw = await chatCompletion(
      config,
      [
        {
          role: "system",
          content: `${systemPrompt(true)}\n你刚刚过早确认了理解。现在只返回一个具体追问。`,
        },
        messages[1],
      ],
      requestOptions,
    );
    result = parseFeynmanTurnResult(retryRaw);
    if (result.understood) {
      throw new Error("首轮讲解必须先由小白提出一个追问");
    }
  }
  result = {
    ...result,
    checkpoints: mergeFeynmanCheckpoints(
      state.feynman?.checkpoints ?? [],
      result.checkpoints,
    ),
  };
  if (
    !requireFollowup &&
    result.checkpoints.every((checkpoint) => checkpoint.status === "understood")
  ) {
    result = {
      ...result,
      understood: true,
      question: "",
      focus: result.focus || "定义、原理、例子和适用边界都已经讲清楚",
    };
  }
  return result;
}

export function mergeFeynmanCheckpoints(
  previous: FeynmanCheckpoint[],
  incoming: FeynmanCheckpoint[],
): FeynmanCheckpoint[] {
  const previousById = new Map(previous.map((checkpoint) => [checkpoint.id, checkpoint]));
  const incomingById = new Map(incoming.map((checkpoint) => [checkpoint.id, checkpoint]));

  return (["definition", "mechanism", "example", "boundary"] as const).map(
    (id) => {
      const oldCheckpoint = previousById.get(id);
      const newCheckpoint = incomingById.get(id);
      if (!oldCheckpoint) return newCheckpoint ?? { id, status: "not_started" };
      if (!newCheckpoint) return oldCheckpoint;
      if (
        CHECKPOINT_STATUS_RANK[oldCheckpoint.status] >
        CHECKPOINT_STATUS_RANK[newCheckpoint.status]
      ) {
        return oldCheckpoint;
      }
      return {
        ...newCheckpoint,
        evidence: newCheckpoint.evidence || oldCheckpoint.evidence,
      };
    },
  );
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
    checkpoints: parseCheckpoints(value.checkpoints),
  };
}

function parseCheckpoints(value: unknown): FeynmanCheckpoint[] {
  const validIds = new Set(["definition", "mechanism", "example", "boundary"]);
  const status = new Set(["not_started", "in_progress", "understood"]);
  const supplied = Array.isArray(value) ? value : [];
  const byId = new Map<FeynmanCheckpoint["id"], FeynmanCheckpoint>();

  for (const item of supplied) {
    if (!item || typeof item !== "object") continue;
    const record = item as Record<string, unknown>;
    if (
      typeof record.id !== "string" ||
      !validIds.has(record.id) ||
      typeof record.status !== "string" ||
      !status.has(record.status)
    ) {
      continue;
    }
    byId.set(record.id as FeynmanCheckpoint["id"], {
      id: record.id as FeynmanCheckpoint["id"],
      status: record.status as FeynmanCheckpoint["status"],
      evidence: typeof record.evidence === "string" ? record.evidence.trim() : undefined,
    });
  }

  return (["definition", "mechanism", "example", "boundary"] as const).map(
    (id) => byId.get(id) ?? { id, status: "not_started" },
  );
}
