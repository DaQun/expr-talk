/** 训练模式（自由/口播为单轮；辩论与费曼学习法支持模型多轮交互） */
export type PracticeMode = "free" | "short_video" | "debate" | "feynman";

/** 历史 session 可能仍存旧 mode id */
export type LegacyPracticeMode =
  | PracticeMode
  | "impromptu"
  | "meeting"
  | "interview"
  | "presentation"
  | "retelling"
  | "emotion_expression";

/** 首页 / 练习页展示顺序 */
export const PRACTICE_MODES: PracticeMode[] = [
  "free",
  "short_video",
  "debate",
  "feynman",
];

/** 评分维度（跨模式统一枚举，权重按 mode 配置） */
export type ScoreDimension =
  | "clarity"
  | "structure"
  | "logic"
  | "directness"
  | "density"
  | "rhythm"
  | "persuasiveness"
  | "actionability"
  | "hook"
  | "memorability";

export type ScoreRubric = Partial<Record<ScoreDimension, number>>;

export const PRACTICE_MODE_LABELS: Record<PracticeMode, string> = {
  free: "自由发挥",
  short_video: "口播 · 按主题",
  debate: "辩论",
  feynman: "费曼学习法",
};

export const PRACTICE_MODE_BLURBS: Record<PracticeMode, string> = {
  free: "自定题目，练开口、结构与少废话",
  short_video: "选题口播，练钩子、密度与行动号召",
  debate: "给定立场，练立论、论据与预判反驳",
  feynman: "向小白讲清概念，直到对方真正听懂",
};

/** 旧 mode → 新 mode（历史列表、分析兜底） */
const LEGACY_MODE_MAP: Record<string, PracticeMode> = {
  free: "free",
  short_video: "short_video",
  debate: "debate",
  feynman: "feynman",
  impromptu: "free",
  meeting: "free",
  interview: "free",
  presentation: "free",
  retelling: "free",
  emotion_expression: "free",
};

export function normalizePracticeMode(
  mode: string | null | undefined,
): PracticeMode {
  if (!mode) return "free";
  return LEGACY_MODE_MAP[mode] ?? "free";
}

export function practiceModeLabel(mode: string | null | undefined): string {
  return PRACTICE_MODE_LABELS[normalizePracticeMode(mode)];
}

export const SCORE_DIMENSION_LABELS: Record<ScoreDimension, string> = {
  clarity: "清晰",
  structure: "结构",
  logic: "逻辑性",
  directness: "直接",
  density: "密度",
  rhythm: "节奏",
  persuasiveness: "说服",
  actionability: "可执行",
  hook: "钩子",
  memorability: "记忆点",
};

/** 各模式默认权重（总和应约等于 1） */
export const DEFAULT_MODE_RUBRICS: Record<PracticeMode, ScoreRubric> = {
  free: {
    logic: 0.3,
    structure: 0.25,
    clarity: 0.2,
    directness: 0.15,
    density: 0.1,
  },
  short_video: {
    hook: 0.25,
    logic: 0.2,
    density: 0.2,
    rhythm: 0.2,
    memorability: 0.15,
  },
  debate: {
    logic: 0.35,
    persuasiveness: 0.25,
    structure: 0.2,
    directness: 0.1,
    clarity: 0.1,
  },
  feynman: {
    clarity: 0.35,
    structure: 0.25,
    logic: 0.2,
    density: 0.1,
    directness: 0.1,
  },
};

export type TrainingGoal =
  | "state_conclusion_first"
  | "reduce_fillers"
  | "improve_structure"
  | "increase_density"
  | "better_rhythm"
  | "custom";

export const TRAINING_GOAL_LABELS: Record<TrainingGoal, string> = {
  state_conclusion_first: "先说结论",
  reduce_fillers: "减少填充词",
  improve_structure: "结构更清晰",
  increase_density: "提高信息密度",
  better_rhythm: "改善节奏与停顿",
  custom: "自定义目标",
};

/** 题库条目（口播 / 辩论） */
export type PracticeTopic = {
  id: string;
  /** 列表短标题 */
  title: string;
  /** 写入练习草稿的完整提示 */
  prompt: string;
  category: string;
  /** 辩论用：正/反方提示 */
  side?: "pro" | "con" | "either";
};

/** 口播主题分类 */
export const SHORT_VIDEO_CATEGORIES = [
  "观点",
  "知识",
  "生活",
  "职场",
  "产品",
] as const;

export const SHORT_VIDEO_TOPICS: PracticeTopic[] = [
  {
    id: "sv_view_phone",
    title: "手机让人更孤独？",
    category: "观点",
    prompt:
      "【口播 · 45–60 秒】主题：手机让人更孤独还是更连接？前 3 秒给钩子，讲清你的立场 + 一个生活例子 + 结尾行动号召。",
  },
  {
    id: "sv_view_ai",
    title: "AI 会取代你的工作吗",
    category: "观点",
    prompt:
      "【口播 · 45–60 秒】主题：AI 会不会取代你的工作？开头抛反常识一句，给 2 个判断标准，结尾告诉观众「今天可以做的一件事」。",
  },
  {
    id: "sv_know_pomodoro",
    title: "番茄钟为什么有用",
    category: "知识",
    prompt:
      "【口播 · 45–60 秒】用大白话讲清番茄工作法：是什么、为什么有效、怎么开始。前 3 秒钩子，结尾给可执行的第一步。",
  },
  {
    id: "sv_know_compound",
    title: "复利思维 60 秒",
    category: "知识",
    prompt:
      "【口播 · 45–60 秒】解释「复利」：不只是钱，学习/习惯也可以复利。一个例子 + 一个误区 + 一句行动号召。",
  },
  {
    id: "sv_life_morning",
    title: "我的晨间 3 件事",
    category: "生活",
    prompt:
      "【口播 · 45–60 秒】分享你晨间固定的 3 件事。开头用结果钩子（「我早起后效率翻倍」类），每件一事一句，结尾邀请观众试试第 1 件。",
  },
  {
    id: "sv_life_no",
    title: "学会说不",
    category: "生活",
    prompt:
      "【口播 · 45–60 秒】主题：如何礼貌但坚定地说不。给 1 个公式句式 + 1 个场景演示 + 结尾行动号召。",
  },
  {
    id: "sv_work_meeting",
    title: "开会为什么总超时",
    category: "职场",
    prompt:
      "【口播 · 45–60 秒】拆解「开会总超时」的 2 个根因 + 1 个你可以立刻用的规矩。钩子开头，结尾给行动号召。",
  },
  {
    id: "sv_work_feedback",
    title: "怎么提负面反馈",
    category: "职场",
    prompt:
      "【口播 · 45–60 秒】教观众提负面反馈：先事实、再影响、最后请求。用 1 个错误示范 + 1 个正确示范。",
  },
  {
    id: "sv_prod_onboard",
    title: "新功能 60 秒种草",
    category: "产品",
    prompt:
      "【口播 · 45–60 秒】假设你要种草一个 App 新功能：谁痛、解决什么、怎么用一步上手。前 3 秒钩子，结尾引导「去试试」。",
  },
  {
    id: "sv_prod_fail",
    title: "一次产品失败复盘",
    category: "产品",
    prompt:
      "【口播 · 45–60 秒】讲一次产品/项目失败：发生了什么、你学到的 1 个教训、观众能带走的 1 个原则。短、密、有钩子。",
  },
];

export const DEBATE_TOPICS: PracticeTopic[] = [
  {
    id: "db_remote",
    title: "远程办公应成默认",
    category: "职场",
    side: "pro",
    prompt:
      "【辩论 · 立论 90 秒】正方：远程办公应成为知识工作者的默认。请：① 一句立场 ② 两条可检验论据 ③ 预判并回应一个反方质疑。",
  },
  {
    id: "db_remote_con",
    title: "远程办公不该默认",
    category: "职场",
    side: "con",
    prompt:
      "【辩论 · 立论 90 秒】反方：远程办公不应成为默认。请：① 一句立场 ② 两条论据 ③ 回应对方「效率更高」的常见论点。",
  },
  {
    id: "db_exam",
    title: "考试成绩能代表能力？",
    category: "教育",
    side: "either",
    prompt:
      "【辩论 · 立论 90 秒】自选正或反：考试成绩能在多大程度上代表能力？先亮立场，再给两条论据，最后处理一个最强反方点。",
  },
  {
    id: "db_city",
    title: "年轻人必须去大城市？",
    category: "社会",
    side: "either",
    prompt:
      "【辩论 · 立论 90 秒】辩题：年轻人是否必须去大城市发展？选一方立论：立场、两条论据、一句对反方的回应。",
  },
  {
    id: "db_ai_art",
    title: "AI 生成算创作吗",
    category: "科技",
    side: "either",
    prompt:
      "【辩论 · 立论 90 秒】辩题：AI 生成的内容算不算「创作」？亮明定义与立场，两条论据，回应「没有人类意图就不是艺术」。",
  },
  {
    id: "db_privacy",
    title: "便利可以换隐私？",
    category: "科技",
    side: "con",
    prompt:
      "【辩论 · 立论 90 秒】反方：不应用便利无限换取隐私。立场一句说清，论据两条，回应「反正没人看我数据」的常见说法。",
  },
  {
    id: "db_gap_year",
    title: "大学前该 gap year？",
    category: "教育",
    side: "pro",
    prompt:
      "【辩论 · 立论 90 秒】正方：有条件的学生大学前应考虑 gap year。给出定义、两条收益论据、回应「浪费一年」的反方。",
  },
  {
    id: "db_four_day",
    title: "四天工作制该推广",
    category: "职场",
    side: "pro",
    prompt:
      "【辩论 · 立论 90 秒】正方：应推广四天工作制。立场、两条论据（效率/福祉任选角度）、预判「产出下降」并反驳。",
  },
];

export const FEYNMAN_TOPICS: PracticeTopic[] = [
  {
    id: "fy_compound",
    title: "复利",
    category: "思维",
    prompt:
      "【费曼学习法】向一个完全不了解这个概念的人解释「复利」：它是什么、为什么会产生累积效应、一个生活或工作中的例子，以及常见误解。不要默认对方懂术语。",
  },
  {
    id: "fy_opportunity_cost",
    title: "机会成本",
    category: "思维",
    prompt:
      "【费曼学习法】向一个完全不了解这个概念的人解释「机会成本」：它是什么、做选择时真正放弃了什么、一个具体例子，以及它不等于什么。",
  },
  {
    id: "fy_http",
    title: "HTTP 请求",
    category: "技术",
    prompt:
      "【费曼学习法】向一个不懂互联网的人解释「HTTP 请求」：浏览器和服务器各做什么、一次请求如何往返、一个生活类比，以及为什么会有状态码。",
  },
  {
    id: "fy_database_index",
    title: "数据库索引",
    category: "技术",
    prompt:
      "【费曼学习法】向一个初学者解释「数据库索引」：它解决什么问题、为什么能更快、代价是什么、一个图书馆或生活类比。",
  },
  {
    id: "fy_inflation",
    title: "通货膨胀",
    category: "经济",
    prompt:
      "【费曼学习法】向一个不懂经济学的人解释「通货膨胀」：钱为什么会变得不值钱、常见成因、对日常生活的影响，以及一个容易误解的地方。",
  },
  {
    id: "fy_recursion",
    title: "递归",
    category: "技术",
    prompt:
      "【费曼学习法】向一个编程初学者解释「递归」：函数如何调用自己、为什么必须有终止条件、一个简单例子，以及何时不适合用它。",
  },
  {
    id: "fy_probability",
    title: "概率与期望",
    category: "思维",
    prompt:
      "【费曼学习法】向一个完全不了解的人解释「概率和期望」：两者各是什么、为什么高概率不等于必然、一个日常决策例子。",
  },
  {
    id: "fy_llm",
    title: "大语言模型",
    category: "技术",
    prompt:
      "【费曼学习法】向一个非技术用户解释「大语言模型」：它大致如何生成回答、为什么会出错或幻觉、适合做什么、不该拿来做什么。",
  },
];

/** 自由发挥：可选轻提示（也可完全自拟） */
export const FREE_TOPIC_STARTERS: PracticeTopic[] = [
  {
    id: "free_blank",
    title: "完全自拟",
    category: "自由",
    prompt: "（自由发挥）请输入或口述你想练的主题，说完即可。建议 60–90 秒。",
  },
  {
    id: "free_intro",
    title: "一分钟自我介绍",
    category: "自由",
    prompt:
      "【自由发挥】用 60–90 秒做自我介绍：你是谁、你在做什么、听的人为什么要在意。结构自定，少废话。",
  },
  {
    id: "free_week",
    title: "这周学到的一件事",
    category: "自由",
    prompt:
      "【自由发挥】用 60–90 秒讲这周你学到的一件事：是什么、怎么学到的、以后怎么用。",
  },
  {
    id: "free_opinion",
    title: "一个你坚持的观点",
    category: "自由",
    prompt:
      "【自由发挥】选一个你真正相信的观点，60–90 秒讲清楚：观点、理由、一个例子。",
  },
];

export function topicsForMode(mode: PracticeMode): PracticeTopic[] {
  switch (mode) {
    case "short_video":
      return SHORT_VIDEO_TOPICS;
    case "debate":
      return DEBATE_TOPICS;
    case "feynman":
      return FEYNMAN_TOPICS;
    case "free":
    default:
      return FREE_TOPIC_STARTERS;
  }
}

export function defaultTopicForMode(mode: PracticeMode): PracticeTopic {
  const list = topicsForMode(mode);
  return list[0] ?? FREE_TOPIC_STARTERS[0];
}

/** 各模式默认题目文案（切换模式时写入草稿） */
export const DEFAULT_MODE_TOPICS: Record<PracticeMode, string> = {
  free: defaultTopicForMode("free").prompt,
  short_video: defaultTopicForMode("short_video").prompt,
  debate: defaultTopicForMode("debate").prompt,
  feynman: defaultTopicForMode("feynman").prompt,
};

/** 各模式默认训练目标 */
export const DEFAULT_MODE_GOALS: Record<PracticeMode, TrainingGoal> = {
  free: "improve_structure",
  short_video: "increase_density",
  debate: "state_conclusion_first",
  feynman: "improve_structure",
};

/** 练习页提示：本模式怎么练、评什么 */
export const MODE_PRACTICE_HINTS: Record<PracticeMode, string> = {
  free: "题目可自拟。先开口、有结构即可；卡壳用静默，别用填充词拖时间。",
  short_video:
    "按所选主题口播。前 3 秒必须有钩子；一句一个点；结尾要有行动号召。建议 45–60 秒。",
  debate:
    "先一句亮明立场，再给两条可检验论据，最后主动回应一个反方点。建议 90 秒立论。",
  feynman:
    "把概念讲给小白听：少术语，说清因果，给一个例子。小白会一直追问，直到能理解为止。",
};

/** 建议练习时长（秒） */
export const MODE_SUGGESTED_DURATION_SEC: Record<PracticeMode, number> = {
  free: 90,
  short_video: 60,
  debate: 90,
  feynman: 120,
};

/**
 * 规则层 issue 在各模式下的优先级（越小越优先）。
 * 未列出的 code 默认 50。
 */
export const MODE_ISSUE_PRIORITY: Record<
  PracticeMode,
  Partial<Record<string, number>>
> = {
  free: {
    too_many_fillers: 1,
    unclear_structure: 2,
    hedging: 3,
    low_density: 4,
    long_pause: 5,
  },
  short_video: {
    low_density: 1,
    repetition: 2,
    too_many_fillers: 3,
    long_pause: 4,
    vague_language: 5,
  },
  debate: {
    late_conclusion: 1,
    hedging: 2,
    vague_language: 3,
    low_density: 4,
    too_many_fillers: 5,
  },
  feynman: {
    vague_language: 1,
    unclear_structure: 2,
    logic_gap: 3,
    low_density: 4,
    too_many_fillers: 5,
  },
};

/** 随机抽一题（口播可按分类） */
export function pickRandomTopic(
  mode: PracticeMode,
  category?: string,
  excludeId?: string,
): PracticeTopic {
  let pool = topicsForMode(mode);
  if (category && category !== "全部") {
    pool = pool.filter((t) => t.category === category);
  }
  if (excludeId && pool.length > 1) {
    pool = pool.filter((t) => t.id !== excludeId);
  }
  if (pool.length === 0) pool = topicsForMode(mode);
  return pool[Math.floor(Math.random() * pool.length)] ?? defaultTopicForMode(mode);
}

export function categoriesForMode(mode: PracticeMode): string[] {
  const set = new Set(topicsForMode(mode).map((t) => t.category));
  return ["全部", ...Array.from(set)];
}
