# Transcript Pipeline 规格：中文断句与 Utterance 生成

## 1. 问题陈述

当前 `segmentsToUtterances` 的断句逻辑：

1. 将所有 final segment 拼接后按 `[。！？!?；;]` 和换行切分。
2. 短于 4 个实义字符的碎片向后合并。
3. 时间戳取首尾 segment 的 startMs/endMs，所有 utterance 共享。

已知缺陷：

- ASR 无标点时（streaming zipformer 默认不带标点），整段文本只有一个"句子"，utterance 退化为 1 条，逐句分析失效。
- 时间戳无法定位到具体 utterance，复盘页无法做"点击句子跳转音频"。
- 合并阈值硬编码，无法区分"嗯。"（应丢弃或并入）和"好的。"（独立应答）。
- 英文混排场景未覆盖（如 "OK 那我们开始" 不应在 OK 后断开）。

## 2. 设计目标

- 无论 ASR 是否带标点，都能产出合理的 utterance 序列。
- 每个 utterance 携带尽可能精确的时间戳。
- 规则确定、可测试、不依赖外部分词服务。
- 保持 core 包零运行时依赖（不引入 jieba-wasm 等）。

## 3. 输入与输出

```ts
// 输入
type PipelineInput = {
  sessionId: string;
  segments: TranscriptSegment[]; // 仅 isFinal === true 的会被处理
};

// 输出
type PipelineOutput = {
  utterances: Utterance[];
  droppedFragments: DroppedFragment[]; // 被丢弃/合并的碎片，供调试
};

type DroppedFragment = {
  text: string;
  reason: "too_short" | "pure_filler" | "duplicate";
  mergedInto?: string; // 目标 utterance id
};
```

## 4. 处理流程

```text
final segments
  → Step 1: 段内预处理（normalize + artifact removal）
  → Step 2: 标点状态检测
  → Step 3: 断句
  → Step 4: 碎片合并/丢弃
  → Step 5: 时间戳分配
  → Step 6: 生成 Utterance
```

### Step 1: 段内预处理

复用现有 `normalizeTranscript` + `removeAsrArtifacts`。额外增加：

- 去除段首孤立语气词（`^[嗯啊呃额，、\s]+`），但保留段中语气词（它们是填充词指标的证据）。
- 统一全角/半角标点。

### Step 2: 标点状态检测

对每个 final segment 判断标点丰富度：

```ts
type PunctLevel = "rich" | "sparse" | "none";

function detectPunctLevel(text: string): PunctLevel {
  const chars = text.replace(/[\s\n]/g, "");
  if (chars.length === 0) return "none";
  const punctCount = (chars.match(/[，。！？、；：,.!?;:]/g) ?? []).length;
  const ratio = punctCount / chars.length;
  if (ratio >= 0.03) return "rich";   // 约每 33 字有 1 个标点
  if (ratio > 0) return "sparse";
  return "none";
}
```

- `rich`：ASR 自带标点（如在线 ASR、SenseVoice），直接按标点断句。
- `sparse`：部分标点，按标点断句后再用规则补充切分过长片段。
- `none`：无标点（streaming zipformer 默认），完全走规则断句。

### Step 3: 断句

#### 3a. 有标点断句（rich / sparse）

按句末标点切分：`/(?<=[。！？!?；;…])|\n+/`

切分后若单句超过 `MAX_UTTERANCE_CHARS`（默认 80），在逗号/顿号处二次切分：

```ts
const CLAUSE_SPLIT = /(?<=[，、,])\s*/;
```

二次切分后仍超长的，按固定窗口（60 字）强制断开，避免 LLM 输入过长。

#### 3b. 无标点规则断句（none）

不引入分词器，用以下启发式规则组合：

**规则优先级从高到低：**

| # | 规则 | 示例 |
|---|------|------|
| 1 | 连接词/转折词前断句 | 然后、但是、可是、所以、因为、如果、而且、另外、不过、接下来、首先、最后 |
| 2 | 时间/序列标记前断句 | 第一、第二、首先、其次、最后、一开始、后来、现在 |
| 3 | 主语重置检测：代词/名词 + 动词模式 | "我觉得…" "他说…" "这个问题…" |
| 4 | 固定长度窗口兜底 | 每 40-60 字强制断开（在最近的规则 1-3 边界处断，若无则硬断） |

实现方式：

```ts
const BREAK_BEFORE = new RegExp(
  "(然后|但是|可是|所以|因为|如果|而且|另外|不过|接下来|首先|其次|最后|一开始|后来|现在|第一|第二|第三)",
  "g",
);

function splitByRules(text: string): string[] {
  // 1. 在连接词前插入断点标记
  let marked = text.replace(BREAK_BEFORE, "\u0000$1");

  // 2. 主语重置：2-4 字名词/代词 + 常见动词起始
  //    保守模式：只匹配 "我/你/他/她/它/这/那/我们" + 动词
  marked = marked.replace(
    /([^\u0000])(我|你|他|她|它|我们|你们|他们|这个|那个|这些)(觉得|认为|想|说|看|希望|建议|决定)/g,
    "$1\u0000$2$3",
  );

  // 3. 按标记切分
  const parts = marked.split("\u0000").filter(Boolean);

  // 4. 合并过短片段（< MIN_CHARS）到前一段
  // 5. 拆分过长片段（> MAX_CHARS）在固定窗口处
  return mergeAndSplit(parts, MIN_CHARS, MAX_CHARS);
}
```

**参数默认值：**

| 参数 | 值 | 说明 |
|------|----|------|
| `MIN_UTTERANCE_CHARS` | 6 | 少于此值的实义字符视为碎片 |
| `MAX_UTTERANCE_CHARS` | 80 | 超过此值尝试二次切分 |
| `FORCE_SPLIT_CHARS` | 60 | 无规则边界时的硬断窗口 |
| `IDEAL_UTTERANCE_CHARS` | 15-40 | 目标区间（仅用于评估，不强制） |

### Step 4: 碎片合并/丢弃

切分后的片段按以下规则处理：

```text
对每个片段 P（按顺序）:
  实义字符数 = P 去除标点、空白、纯语气词后的字符数

  if 实义字符数 === 0:
    → 丢弃，reason = "pure_filler"

  if 实义字符数 < MIN_UTTERANCE_CHARS:
    if P 是纯应答词（好的/行/对/嗯/OK/可以）:
      → 丢弃，reason = "pure_filler"
    else:
      → 合并到前一个 utterance 末尾（若无前一个则合并到后一个）
      → reason = "too_short", mergedInto = 目标 id

  if P 与前一个 utterance 文本完全相同:
    → 丢弃，reason = "duplicate"（ASR 重复输出）
```

纯应答词表（可配置）：

```json
["好的", "好", "行", "对", "嗯", "嗯嗯", "OK", "ok", "可以", "没问题", "是的", "对对对"]
```

### Step 5: 时间戳分配

当前实现所有 utterance 共享全局 startMs/endMs，无法定位。改进策略：

**有 segment 时间戳时（在线 ASR / 带时间戳的本地 ASR）：**

- 每个 final segment 有 startMs/endMs。
- 断句发生在 segment 拼接后的文本上，需要建立字符偏移 → segment 的映射。

```ts
type CharMap = {
  offset: number;      // 在拼接文本中的字符偏移
  segmentId: string;
  segmentStartMs: number;
  segmentEndMs: number;
};
```

- 每个 utterance 的 startMs = 其首字符所在 segment 的 startMs。
- 每个 utterance 的 endMs = 其末字符所在 segment 的 endMs。
- 若一个 utterance 跨越多个 segment，取首尾 segment 的时间。

**无 segment 时间戳时（部分本地 ASR 只给文本不给时间）：**

- 按字符比例估算：`utterance.startMs ≈ globalStart + (charOffset / totalChars) * globalDuration`。
- 标记 `timeSource: "estimated"`，UI 不展示精确跳转按钮。

**Utterance 类型扩展：**

```ts
type Utterance = {
  // ...existing fields
  timeSource?: "segment" | "estimated" | "none";
};
```

### Step 6: 生成 Utterance

最终组装：

```ts
function buildUtterance(
  sessionId: string,
  text: string,
  startMs: number | undefined,
  endMs: number | undefined,
  segmentIds: string[],
  timeSource: "segment" | "estimated" | "none",
): Utterance {
  return {
    id: createId("utt"),
    sessionId,
    text: text.trim(),
    startMs,
    endMs,
    segmentIds,
    timeSource,
  };
}
```

## 5. 配置化

所有阈值和词表通过 `PipelineConfig` 传入，允许用户在设置中调整：

```ts
type PipelineConfig = {
  minUtteranceChars: number;       // default 6
  maxUtteranceChars: number;       // default 80
  forceSplitChars: number;         // default 60
  ackWords: string[];              // 纯应答词表
  breakBeforePatterns: string[];   // 连接词/转折词（可扩展）
  subjectResetPronouns: string[];  // 主语重置代词
};

export const DEFAULT_PIPELINE_CONFIG: PipelineConfig = {
  minUtteranceChars: 6,
  maxUtteranceChars: 80,
  forceSplitChars: 60,
  ackWords: ["好的", "好", "行", "对", "嗯", "嗯嗯", "OK", "ok", "可以", "没问题", "是的", "对对对"],
  breakBeforePatterns: [
    "然后", "但是", "可是", "所以", "因为", "如果", "而且", "另外",
    "不过", "接下来", "首先", "其次", "最后", "一开始", "后来", "现在",
    "第一", "第二", "第三",
  ],
  subjectResetPronouns: [
    "我", "你", "他", "她", "它", "我们", "你们", "他们",
    "这个", "那个", "这些",
  ],
};
```

## 6. 与下游的接口约定

- `computeSessionMetrics` 的 `utteranceCount` 参数改为直接接收 `Utterance[]`，内部计算 avgSentenceLength。
- LLM `final_report` 的 prompt 中逐句部分以 utterance 为单位，每条带 `[U1]` `[U2]` 标记，LLM 返回的 `sentenceFeedback[].utteranceId` 与之对应。
- 复盘页渲染时，utterance 按 startMs 排序；timeSource 为 "none" 时不展示时间跳转。

## 7. 测试用例（验收标准）

| 场景 | 输入 | 期望 |
|------|------|------|
| 有标点正常断句 | "今天开会。主要讨论三个问题。第一是进度。" | 3 条 utterance |
| 无标点连接词断句 | "我觉得这个方案可以然后我们需要确认一下时间" | ≥ 2 条，"然后"前断开 |
| 纯语气词丢弃 | "嗯" / "啊" / "呃" 独立片段 | 不出现在 utterances 中，出现在 droppedFragments |
| 短碎片合并 | "好的。这个项目进展顺利。" | "好的"被丢弃或并入，不独立成句 |
| 超长句二次切分 | 120 字无标点连续表达 | 切为 2-3 条，每条 ≤ 80 字 |
| 时间戳映射 | 3 个 segment 各有 startMs/endMs，产出 5 条 utterance | 每条 utterance 的 startMs/endMs 对应正确的 segment 区间 |
| 英文混排 | "OK那我们开始讨论一下这个API的设计" | 不在 "OK" 后断开，整体为 1 条或在连接词处断开 |
| ASR 重复 | "这个项目这个项目进展顺利" | 去重后 1 条 |

## 8. 不做的事

- 不引入分词器（jieba / pkuseg）：增加包体积和 WASM 复杂度，当前规则足够。
- 不做标点恢复模型：那是 ASR 层的事（SenseVoice 自带标点），Pipeline 只处理 ASR 给什么。
- 不做说话人分离：MVP 范围外。
- 不做语义完整性判断：不试图理解"这句话说完了没有"，只做形式切分。

## 9. 迁移计划

1. 在 `packages/core/src/transcript/` 下新建 `pipeline.ts`，实现上述流程。
2. 现有 `segment.ts` 的 `segmentsToUtterances` 标记 `@deprecated`，内部调用新 pipeline。
3. 补充 `pipeline.test.ts` 覆盖第 7 节所有用例。
4. 更新 `compute.ts` 接收 `Utterance[]`。
5. 前端复盘页适配 `timeSource` 字段。
