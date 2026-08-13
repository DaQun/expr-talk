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

/** 检查点未讲清时的兜底追问，按检查点补一个最能暴露缺口的问题。 */
const CHECKPOINT_QUESTION: Record<FeynmanCheckpoint["id"], string> = {
  definition: "你能用最简单的话说一下它到底是什么吗？",
  mechanism: "它为什么会这样运作？能讲讲背后的原理吗？",
  example: "能举一个具体的例子说明吗？",
  boundary: "什么情况下它不适用，或者容易和什么弄混？",
};

const CHECKPOINT_FOCUS: Record<FeynmanCheckpoint["id"], string> = {
  definition: "核心定义",
  mechanism: "原理与因果",
  example: "具体例子",
  boundary: "边界与误解",
};

/** 从题面抽出概念名。题库格式为 …解释「通货膨胀」：… */
export function extractFeynmanConcept(topic: string): string {
  const trimmed = topic.trim();
  if (!trimmed) return "";
  const quoted = trimmed.match(/[「『《]([^」』》]+)[」』》]/);
  if (quoted?.[1]?.trim()) return quoted[1].trim();
  const ascii = trimmed.match(/"([^"]+)"/);
  if (ascii?.[1]?.trim()) return ascii[1].trim();
  const withoutMode = trimmed.replace(/^【[^】]*】\s*/, "");
  const beforeColon = withoutMode.split(/[：:]/, 1)[0]?.trim() ?? "";
  if (beforeColon) return beforeColon.slice(0, 48);
  return withoutMode.slice(0, 48) || trimmed.slice(0, 48);
}

export function buildFeynmanTurnUserPayload(
  state: DebateState,
  topic: string,
): Record<string, unknown> {
  const learnerRole = state.feynman?.learnerRole ?? "outsider";
  const difficulty = state.feynman?.difficulty ?? "standard";
  return {
    concept: extractFeynmanConcept(topic),
    topicBrief: topic,
    currentRound: state.currentRound,
    learnerRole,
    learnerInstructions: ROLE_GUIDANCE[learnerRole],
    difficulty,
    difficultyInstructions: DIFFICULTY_GUIDANCE[difficulty],
    currentCheckpoints: state.feynman?.checkpoints ?? [],
    explanations: state.turns.map(({ role, round, text }) => ({
      speaker: role === "user" ? "user" : "assistant",
      round,
      text,
    })),
  };
}

const SYSTEM = `你是一个好奇、诚实、暂时还没完全听懂的中文初学者。用户正用费曼学习法向你解释一个概念。

身份（必须遵守）：
- explanations 里 speaker=user 是用户的讲解；speaker=assistant 是你之前的提问。
- 你只提问、不讲课、不替用户补定义或原理。
- 若用户反过来问你（例如「你能帮我讲讲吗」「这个你知道吗」），不要作答；用一句话把问题抛回去，请对方继续讲未讲清的那一项。
- concept 只是概念名称。topicBrief 是训练题面（目标清单），不是用户已经说过的话。禁止说「你提到了题面里的某项」。

判断：
- 只根据用户已经讲过的话判断，不要用自己的学科知识补全。
- 口误和识别噪音（如 SIL、同音错字）按上下文理解，不要抓住不放。
- 大白话讲到点子上即可；不得因为没说教科书术语（如「需求拉动」「购买力下降」）就判没讲清。
- 检查点跨轮累积：currentCheckpoints 里已经 understood 的不得降级。评估全部历史讲解，不要只看最后一轮。
- 用户任意一轮已经用自己的话讲清某项，就标 understood，不得要求换句复述。
- 还没听懂时，只问一个最能暴露缺口的问题（定义 / 因果 / 例子 / 边界），不要一次问多个，不要替用户解释。
- 四个检查点都 understood 时：understood=true，question 必须为空。
- 任一检查点未齐时：understood=false，question 必须非空。
- understood=true 只表示你听懂了，不代表结束练习。

最终响应必须是单个 JSON 对象（不要 Markdown、不要代码围栏、不要前言后语），字段：
{"understood": boolean, "question": string, "focus": string, "checkpoints": [{"id":"definition"|"mechanism"|"example"|"boundary","status":"not_started"|"in_progress"|"understood","evidence":string}]}
规则：understood 为 false 时 question 最多两句、80 字；understood 为 true 时 question 为空，focus 用一句话概括你听懂的内容。四个 checkpoints 必须全部给出，evidence 只写用户已讲清的内容或当前缺口，不要虚构。
若你有内部思考过程，思考中不要复述本条格式要求或出现「输出 JSON」之类的收尾语。`;

export async function generateFeynmanTurn(
  state: DebateState,
  topic: string,
  config: LLMConfig,
  options?: LLMRequestOptions,
): Promise<FeynmanTurnResult> {
  const messages = [
    { role: "system" as const, content: SYSTEM },
    {
      role: "user" as const,
      content: JSON.stringify(buildFeynmanTurnUserPayload(state, topic)),
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
  result = {
    ...result,
    checkpoints: mergeFeynmanCheckpoints(
      state.feynman?.checkpoints ?? [],
      result.checkpoints,
    ),
  };
  const allUnderstood = result.checkpoints.every(
    (checkpoint) => checkpoint.status === "understood",
  );
  if (result.understood && !allUnderstood) {
    // 模型过早确认理解：仍有检查点未讲清，强制回到追问，不许跳过缺口
    const missing =
      result.checkpoints.find(
        (checkpoint) => checkpoint.status !== "understood",
      ) ?? result.checkpoints[0];
    result = {
      ...result,
      understood: false,
      question: CHECKPOINT_QUESTION[missing.id],
      focus: CHECKPOINT_FOCUS[missing.id],
    };
  } else if (result.understood) {
    result = {
      ...result,
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
