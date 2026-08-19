import {
  REPORT_SCHEMA_VERSION,
  type LLMConfig,
  type LLMReportInput,
  type StructuredReport,
  type Issue,
  type IssueCode,
  type NextPractice,
  type DimensionReview,
  type EvaluationDimensionKey,
  type ScoreDimension,
  type TaskCheck,
  DEFAULT_MODE_RUBRICS,
  ISSUE_CODES,
  freeTopicRequiresThesis,
  normalizeIssueCode,
  normalizePracticeMode,
  feynmanScenarioSummary,
  taskChecksFromFeynmanCheckpoints,
} from "@showtalk/shared";
import { chatCompletion } from "./openai_compatible";
import type { LLMRequestOptions } from "./types";

const SYSTEM = `你是表达训练教练。根据用户逐字稿、训练模式、目标与评分侧重，输出严格 JSON（不要 Markdown）。
schema:
{
  "schemaVersion": 4,
  "summary": string,
  "scores": { "clarity":0-100, "structure":0-100, "logic":0-100, "directness":0-100, "density":0-100, "rhythm":0-100, "persuasiveness":0-100, "actionability":0-100, "hook":0-100, "memorability":0-100 },
  "dimensionReviews": {
    "content":{"score":0-100,"verdict":string,"evidence":string},
    "logic":{"score":0-100,"verdict":string,"evidence":string},
    "expression":{"score":0-100,"verdict":string,"evidence":string},
    "scenario_task":{"score":0-100,"verdict":string,"evidence":string}
  },
  "taskChecks": [{"label":string,"status":"met"|"partial"|"missed","evidence"?:string}],
  "logicReview": { "thesis":string, "support":string, "coherence":string, "closure":string, "verdict":string },
  "topIssues": [{ "code": string, "title": string, "severity": "low"|"medium"|"high", "evidence"?: string, "suggestion"?: string }],
  "sentenceFeedback": [{ "original": string, "issues": string[], "comment": string }],
  "rewriteExamples": [{ "original": string, "rewritten": string, "focus": string }],
  "nextPractice": { "targetIssue": string, "instruction": string, "retryPrompt": string, "successCriteria": string[] }
}
规则：
- 必须对照 input.topic 和 input.mode 评价；summary 开头点明模式。不得只根据模式猜测题目要求，也不得把其他模式的标准套过来
- scores 只覆盖 input.rubric 里出现的维度；未出现的维度一律省略（自由发挥不要打 hook / persuasiveness / actionability / memorability）
- dimensionReviews 必须输出 content、logic、expression、scenario_task 四项。content 评主题契合与信息价值；expression 评文本可观察的流畅、完整、准确与节奏
- 非费曼：scenario_task 评 input.topic 中显式要求和模式目标的完成度；taskChecks 只从题目显式要求提取。没有明确要求时，按该模式基本任务判断，不得发明题面没有的检查项
- free 且题面未要求观点/结论（如「说完即可」）：基本任务是开口、能听清在讲什么、有大致顺序、少废话。logic 评主线清不清楚、有没有明显矛盾或乱跳，不评有没有核心主张。structure 评顺序和分层，不因没有「先结论后展开」扣分。taskChecks 禁止「开头点题 / 分层递进 / 结尾升华 / 核心观点 / 结论闭环」。topIssues 不得把 missing_thesis、missing_conclusion、late_conclusion 当作主问题；填充词多、结构散、超时仍可列为问题。nextPractice 对准填充词或结构，禁止「10 秒内给核心判断 / 结论先行」
- free 且题面明确要求观点（如「讲清观点、理由、例子」）：才按观点—理由—例子评价
- 费曼：不要自行从题面抽一套任务清单。若 input.feynmanCheckpoints 存在，taskChecks 必须且只能对应这四项（概念定义 / 原理与因果 / 具体例子 / 边界与误解）：understood→met，in_progress→partial，not_started→missed。scenario_task.score 按已讲清比例给分。题面冒号后的清单是训练目标，不是额外教科书标准；不得因用户没说「需求拉动」「购买力下降」等课外术语判 missed，也不得把已 understood 的检查点降为 missed。evidence 可指出仍可改进之处，但 status 以检查点为准
- 不输出 voice 分数：当前没有音高、能量、真实停顿等声学分析结果，语音表现必须留给页面显示“未评估”
- 每个 dimensionReview 必须给一句结论和一条可核对证据。仅有文本时不得声称评价了发音、音色、语调或真实停顿
- 口误和识别噪音（如 SIL、同音错字）按上下文理解，不要当成知识错误
- logic 必须评分，不得省略。structure 只评价内容组织和顺序。辩论/口播观点题：logic 评核心观点是否明确、论据是否支撑、结论是否由前文推出。自由发挥未要求观点时：logic 只评讲述主线是否清楚
- logicReview 必须从整篇逐字稿出发，不做逐句语病点评，每项都要引用具体内容，不得虚构。辩论/观点题：thesis=核心观点，support=论据支撑，coherence=推理衔接，closure=结论闭环。自由发挥未要求观点：thesis=讲述主线（不要求主张），support=关键细节是否撑起这条线，coherence=明显的时间/话题跳跃，closure=是否自然停住（不要求总结升华）；没有主线时写「叙事主线不清晰」，不要写「未形成观点—论据—结论链」
- 辩论模式的 transcript 可能包含“我方”和“反方质询”标签：只评价我方发言，反方内容仅作为回应是否切题的上下文；summary 要概括整场多轮表现
- 费曼学习法的 transcript 可能包含“讲解”和“小白提问”标签：只评价用户讲解。小白确认理解表示本轮学习通过，不等于表达没有改进空间
- topIssues 排序要符合该模式最致命的问题（口播优先钩子/密度，辩论优先立场/论据，自由发挥优先填充词/结构）
- topIssues.code 和 nextPractice.targetIssue 只能使用以下固定编码之一：${ISSUE_CODES.join(", ")}。不得创造新编码、使用中文标题或 F0/F1 等临时编号
- 每次 nextPractice 只聚焦 1 个主问题，instruction/retryPrompt 要贴合该模式
- rewriteExamples 1-2 个，改写风格符合模式（口播更短更钩，自由发挥少填充、结构更清楚，辩论立场更硬）
- 用简体中文
- scores 必须是数字`;

export async function generateFinalReport(
  input: LLMReportInput,
  config: LLMConfig,
  options?: LLMRequestOptions,
): Promise<StructuredReport> {
  const user = JSON.stringify(
    {
      mode: input.mode,
      topic: input.topic,
      goal: input.goal,
      metrics: input.metrics,
      rubric: input.rubric ?? null,
      transcript: input.transcript,
      feynmanCheckpoints: input.feynmanCheckpoints ?? null,
    },
    null,
    2,
  );

  const raw = await chatCompletion(
    config,
    [
      { role: "system", content: SYSTEM },
      { role: "user", content: user },
    ],
    {
      responseFormatJson: true,
      temperature: 0.3,
      signal: options?.signal,
      stream: true,
      onProgress: options?.onProgress,
    },
  );

  options?.onProgress?.({ phase: "parsing", receivedChars: raw.length });
  try {
    return alignModeReport(parseStructuredReport(raw), input);
  } catch {
    // 兼容接口有时忽略 response_format，补一轮更强约束的重试，避免格式波动中断整场练习。
    const retryRaw = await chatCompletion(
      config,
      [
        {
          role: "system",
          content: `${SYSTEM}\n额外要求：你的输出必须从 { 开始、以 } 结束；不要输出解释、前言、Markdown 或代码围栏。`,
        },
        { role: "user", content: user },
      ],
      {
        responseFormatJson: true,
        temperature: 0,
        signal: options?.signal,
        stream: true,
        onProgress: options?.onProgress,
      },
    );
    options?.onProgress?.({ phase: "parsing", receivedChars: retryRaw.length });
    try {
      return alignModeReport(parseStructuredReport(retryRaw), input);
    } catch (retryError) {
      const reason = retryError instanceof Error ? retryError.message : String(retryError);
      throw new Error(`模型连续两次未返回合法复盘 JSON：${reason}`);
    }
  }
}

function alignModeReport(
  report: StructuredReport,
  input: LLMReportInput,
): StructuredReport {
  return alignFreeReport(alignFeynmanReport(report, input), input);
}

const FREE_THESIS_ISSUE_CODES = new Set<IssueCode>([
  "missing_thesis",
  "missing_conclusion",
  "late_conclusion",
]);

const FREE_ESSAY_TASK_RE =
  /点题|分层递进|分层组织|开头明确|核心观点|结论闭环|结尾.{0,8}(总结|收束|升华)|论证链|明确立场|行动号召/;

const FREE_ARGUMENTATIVE_RETRY_RE =
  /结论先行|核心判断|核心观点|核心结论|前\s*\d+\s*秒|立场一句|两条.{0,6}论据/;

/** 空白自由发挥按叙事评，拿掉模型套用的议论文标准。 */
export function alignFreeReport(
  report: StructuredReport,
  input: Pick<LLMReportInput, "mode" | "topic" | "rubric">,
): StructuredReport {
  if (normalizePracticeMode(input.mode) !== "free") return report;
  if (freeTopicRequiresThesis(input.topic)) return report;

  const topIssues = report.topIssues.filter(
    (issue) => !FREE_THESIS_ISSUE_CODES.has(issue.code),
  );
  const taskChecks = report.taskChecks?.filter(
    (check) => !FREE_ESSAY_TASK_RE.test(check.label),
  );
  const scores = restrictScoresToRubric(
    report.scores,
    input.rubric ?? DEFAULT_MODE_RUBRICS.free,
  );

  const retryText = [
    report.nextPractice.instruction,
    report.nextPractice.retryPrompt,
    ...report.nextPractice.successCriteria,
  ].join(" ");
  const nextLooksLikeEssay =
    FREE_THESIS_ISSUE_CODES.has(report.nextPractice.targetIssue) ||
    FREE_ARGUMENTATIVE_RETRY_RE.test(retryText);

  return {
    ...report,
    scores,
    topIssues,
    taskChecks: taskChecks && taskChecks.length > 0 ? taskChecks : undefined,
    nextPractice: nextLooksLikeEssay
      ? freeModeRetryPractice(topIssues, input.topic)
      : {
          ...report.nextPractice,
          targetIssue: FREE_THESIS_ISSUE_CODES.has(
            report.nextPractice.targetIssue,
          )
            ? (topIssues[0]?.code ?? "unclear_structure")
            : report.nextPractice.targetIssue,
        },
  };
}

function restrictScoresToRubric(
  scores: StructuredReport["scores"],
  rubric: Partial<Record<ScoreDimension, number>>,
): StructuredReport["scores"] {
  const allowed = new Set(Object.keys(rubric));
  const next: StructuredReport["scores"] = {};
  for (const [key, value] of Object.entries(scores)) {
    if (allowed.has(key) && typeof value === "number") {
      next[key as ScoreDimension] = value;
    }
  }
  return next;
}

function freeModeRetryPractice(issues: Issue[], topic: string): NextPractice {
  const primary = issues[0];
  const retryPrompt =
    topic.trim() || "请按「自由发挥」要求重新表达刚才的主题。";
  if (primary?.code === "too_many_fillers") {
    return {
      targetIssue: "too_many_fillers",
      instruction:
        "【自由发挥】下一轮把填充词控制在 3 个以内；卡壳用静默。先开口、有结构即可。",
      retryPrompt,
      successCriteria: ["填充词少于 3 个", "60–90 秒内说完", "有清晰结构"],
    };
  }
  return {
    targetIssue: primary?.code ?? "unclear_structure",
    instruction:
      primary?.suggestion ??
      "【自由发挥】下一轮把内容收成 2–3 块，说完就停。先开口、有结构即可。",
    retryPrompt,
    successCriteria: ["60–90 秒内说完", "有清晰结构、少填充词"],
  };
}

/** 费曼复盘以练习中累计的检查点为准，避免另起一套更严的任务清单。 */
export function alignFeynmanReport(
  report: StructuredReport,
  input: Pick<LLMReportInput, "mode" | "feynmanCheckpoints">,
): StructuredReport {
  const checkpoints = input.feynmanCheckpoints;
  if (input.mode !== "feynman" || !checkpoints?.length) return report;
  const taskChecks = taskChecksFromFeynmanCheckpoints(checkpoints);
  const summary = feynmanScenarioSummary(checkpoints);
  return {
    ...report,
    taskChecks,
    dimensionReviews: {
      ...report.dimensionReviews,
      scenario_task: {
        score: summary.score,
        verdict: summary.verdict,
        evidence: summary.evidence,
        source: "mixed",
      },
    },
  };
}

export function parseStructuredReport(raw: string): StructuredReport {
  let data: unknown;
  try {
    data = parseJsonObject(raw);
  } catch {
    throw new Error("LLM 输出不是合法 JSON");
  }
  if (!data || typeof data !== "object") throw new Error("LLM JSON 根类型错误");
  const obj = data as Record<string, unknown>;

  const scoresRaw =
    obj.scores && typeof obj.scores === "object"
      ? (obj.scores as Record<string, unknown>)
      : {};
  const scores: StructuredReport["scores"] = {};
  for (const [k, v] of Object.entries(scoresRaw)) {
    if (typeof v === "number" && Number.isFinite(v)) {
      scores[k as keyof typeof scores] = Math.max(0, Math.min(100, Math.round(v)));
    }
  }

  const topIssues = Array.isArray(obj.topIssues)
    ? obj.topIssues
        .map(parseIssue)
        .filter((x): x is Issue => x != null)
    : [];

  const logicReview = parseLogicReview(obj.logicReview);
  const dimensionReviews = parseDimensionReviews(obj.dimensionReviews);
  const taskChecks = parseTaskChecks(obj.taskChecks);

  const sentenceFeedback = Array.isArray(obj.sentenceFeedback)
    ? obj.sentenceFeedback
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const s = item as Record<string, unknown>;
          if (typeof s.original !== "string" || typeof s.comment !== "string") {
            return null;
          }
          return {
            original: s.original,
            issues: Array.isArray(s.issues)
              ? s.issues.flatMap((issue) => {
                  const code = normalizeIssueCode(issue, String(s.comment));
                  return code ? [code] : [];
                })
              : [],
            comment: s.comment,
            utteranceId:
              typeof s.utteranceId === "string" ? s.utteranceId : undefined,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
    : [];

  const rewriteExamples = Array.isArray(obj.rewriteExamples)
    ? obj.rewriteExamples
        .map((item) => {
          if (!item || typeof item !== "object") return null;
          const s = item as Record<string, unknown>;
          if (
            typeof s.original !== "string" ||
            typeof s.rewritten !== "string" ||
            typeof s.focus !== "string"
          ) {
            return null;
          }
          return {
            original: s.original,
            rewritten: s.rewritten,
            focus: s.focus,
          };
        })
        .filter((x): x is NonNullable<typeof x> => x != null)
    : [];

  const nextPractice = parseNextPractice(obj.nextPractice, topIssues[0]?.code);

  return {
    schemaVersion:
      typeof obj.schemaVersion === "number"
        ? obj.schemaVersion
        : REPORT_SCHEMA_VERSION,
    summary: typeof obj.summary === "string" ? obj.summary : "（无摘要）",
    scores,
    dimensionReviews,
    taskChecks,
    logicReview,
    topIssues,
    sentenceFeedback,
    rewriteExamples,
    nextPractice,
  };
}

function parseJsonObject(raw: string): unknown {
  const cleaned = raw
    .trim()
    .replace(/^```json\s*/i, "")
    .replace(/^```\s*/i, "")
    .replace(/\s*```$/i, "");
  const candidates = [cleaned, ...extractJsonObjectCandidates(raw)];

  for (const candidate of candidates) {
    try {
      const value = JSON.parse(candidate);
      if (value && typeof value === "object" && !Array.isArray(value)) return value;
    } catch {
      // 尝试下一个可能被说明文字包裹的 JSON 对象。
    }
  }
  throw new Error("找不到完整 JSON 对象");
}

function extractJsonObjectCandidates(source: string): string[] {
  const candidates: string[] = [];
  let start = -1;
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = 0; index < source.length; index += 1) {
    const char = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "{") {
      if (depth === 0) start = index;
      depth += 1;
      continue;
    }
    if (char === "}" && depth > 0) {
      depth -= 1;
      if (depth === 0 && start >= 0) {
        candidates.push(source.slice(start, index + 1));
        start = -1;
      }
    }
  }

  return candidates;
}

const DIMENSION_KEYS: EvaluationDimensionKey[] = [
  "content",
  "logic",
  "expression",
  "scenario_task",
];

function parseDimensionReviews(
  item: unknown,
): StructuredReport["dimensionReviews"] {
  if (!item || typeof item !== "object") return undefined;
  const raw = item as Record<string, unknown>;
  const reviews: Partial<Record<EvaluationDimensionKey, DimensionReview>> = {};
  for (const key of DIMENSION_KEYS) {
    const value = raw[key];
    if (!value || typeof value !== "object") continue;
    const review = value as Record<string, unknown>;
    if (
      typeof review.score !== "number" ||
      !Number.isFinite(review.score) ||
      typeof review.verdict !== "string" ||
      typeof review.evidence !== "string"
    ) {
      continue;
    }
    reviews[key] = {
      score: Math.max(0, Math.min(100, Math.round(review.score))),
      verdict: review.verdict,
      evidence: review.evidence,
      source: "llm",
    };
  }
  // V3 compatibility: textual fluency must not be promoted to acoustic voice.
  const legacyContentLogic = parseDimensionReviewValue(raw.content_logic);
  if (legacyContentLogic) {
    reviews.content ??= legacyContentLogic;
    reviews.logic ??= legacyContentLogic;
  }
  const legacyTask = parseDimensionReviewValue(raw.task_completion);
  const legacyScenario = parseDimensionReviewValue(raw.scenario_fit);
  reviews.scenario_task ??= legacyTask ?? legacyScenario;
  return Object.keys(reviews).length > 0 ? reviews : undefined;
}

function parseDimensionReviewValue(value: unknown): DimensionReview | undefined {
  if (!value || typeof value !== "object") return undefined;
  const review = value as Record<string, unknown>;
  if (
    typeof review.score !== "number" ||
    !Number.isFinite(review.score) ||
    typeof review.verdict !== "string" ||
    typeof review.evidence !== "string"
  ) {
    return undefined;
  }
  return {
    score: Math.max(0, Math.min(100, Math.round(review.score))),
    verdict: review.verdict,
    evidence: review.evidence,
    source: "llm",
  };
}

function parseTaskChecks(item: unknown): TaskCheck[] | undefined {
  if (!Array.isArray(item)) return undefined;
  const checks = item
    .map((value): TaskCheck | null => {
      if (!value || typeof value !== "object") return null;
      const check = value as Record<string, unknown>;
      if (typeof check.label !== "string") return null;
      const status =
        check.status === "met" ||
        check.status === "partial" ||
        check.status === "missed"
          ? check.status
          : null;
      if (!status) return null;
      return {
        label: check.label,
        status,
        evidence: typeof check.evidence === "string" ? check.evidence : undefined,
      };
    })
    .filter((value): value is TaskCheck => value != null);
  return checks.length > 0 ? checks : undefined;
}

function parseLogicReview(item: unknown): StructuredReport["logicReview"] {
  if (!item || typeof item !== "object") return undefined;
  const value = item as Record<string, unknown>;
  const fields = ["thesis", "support", "coherence", "closure", "verdict"] as const;
  if (fields.some((field) => typeof value[field] !== "string")) return undefined;
  return {
    thesis: value.thesis as string,
    support: value.support as string,
    coherence: value.coherence as string,
    closure: value.closure as string,
    verdict: value.verdict as string,
  };
}

function parseIssue(item: unknown): Issue | null {
  if (!item || typeof item !== "object") return null;
  const s = item as Record<string, unknown>;
  if (typeof s.title !== "string") return null;
  const code = normalizeIssueCode(s.code, `${s.title} ${String(s.suggestion ?? "")}`);
  if (!code) return null;
  const severity =
    s.severity === "high" || s.severity === "medium" || s.severity === "low"
      ? s.severity
      : "medium";
  return {
    code,
    title: s.title,
    severity,
    evidence: typeof s.evidence === "string" ? s.evidence : undefined,
    suggestion: typeof s.suggestion === "string" ? s.suggestion : undefined,
  };
}

function parseNextPractice(
  item: unknown,
  fallbackIssue?: IssueCode,
): NextPractice {
  if (!item || typeof item !== "object") {
    return {
      targetIssue: fallbackIssue ?? "unclear_structure",
      instruction: "下一轮针对主要问题再练一轮。",
      retryPrompt: "请重新完整表达刚才的主题。",
      successCriteria: ["完成完整表达", "针对主问题有可观察改善"],
    };
  }
  const s = item as Record<string, unknown>;
  const targetIssue = normalizeIssueCode(
    s.targetIssue,
    `${String(s.instruction ?? "")} ${String(s.retryPrompt ?? "")}`,
  );
  return {
    targetIssue: targetIssue ?? fallbackIssue ?? "unclear_structure",
    instruction:
      typeof s.instruction === "string"
        ? s.instruction
        : "下一轮针对主要问题复练。",
    retryPrompt:
      typeof s.retryPrompt === "string"
        ? s.retryPrompt
        : "请重新完整表达刚才的主题。",
    successCriteria: Array.isArray(s.successCriteria)
      ? s.successCriteria.filter((x): x is string => typeof x === "string")
      : [],
  };
}
