# ShowTalk 架构设计

> 2026-08-18 由 ExprTalk 更名为 ShowTalk。名称对照、bundle id 与本机数据迁移见 [`rename-to-showtalk.md`](./rename-to-showtalk.md)。

## 1. 项目定位

本项目是一个面向个人表达能力提升的训练系统，而不是单纯的语音转文字工具或 AI 批改工具。

核心目标：

- 帮助用户练习口头表达、汇报、面试、演讲、口播和即兴表达。
- 将一次表达训练拆成可量化、可诊断、可复练的过程。
- 通过长期数据形成用户表达能力画像。
- 支持本地隐私优先，也支持接入在线模型获得更高质量能力。

产品闭环：

```text
选择训练目标
-> 开始练习
-> 录音 / 转写
-> 结构化诊断
-> 逐句改写
-> 复练对比
-> 保存历史
-> 生成长期能力画像
```

## 2. 设计原则

### 2.1 本地优先

录音、实时字幕、基础表达指标、训练历史应优先在本地完成，降低延迟并保护隐私。

### 2.2 在线增强

在线 ASR 和在线 LLM 是增强能力，不是系统唯一依赖。用户应能选择：

- 本地 ASR + 在线 LLM。
- 在线 ASR + 在线 LLM。

### 2.3 ASR 和 LLM 分离

语音识别和表达分析是两类能力，必须分开设计。

```text
ASR: audio -> transcript
LLM: transcript + context -> diagnosis / rewrite / coaching
```

### 2.4 确定性分析和 AI 分析分离

以下指标应由确定性算法计算：

- 填充词数量。
- 犹豫词数量。
- 重复率。
- 平均句长。
- 语速。
- 停顿。
- 表达密度。
- 词频。

以下能力适合交给 LLM：

- 结构判断。
- 观点是否明确。
- 说服力评价。
- 逐句改写。
- 教练式追问。
- 下一轮训练建议。

### 2.5 结构化数据优先

AI 返回内容必须结构化，前端再负责渲染。不要把 Markdown 报告作为核心数据源。

## 3. 推荐技术栈

### 3.1 客户端形态

推荐优先做桌面应用：

- 需要麦克风权限。
- 需要本地模型。
- 需要保存音频和训练历史。
- 需要较强本地计算能力。

框架选择（已拍板）：

```text
Tauri 2.x + React + TypeScript
```

拍板理由：

- sherpa-onnx 有官方维护的 Rust binding（sherpa-rs），本地 ASR 可直接跑在 Rust 后端进程内，不需要跨进程传 PCM 到独立子进程。
- 安装包体积小，系统集成干净，适合长期产品化。
- SQLite、文件系统、密钥安全存储在 Rust 侧均有成熟方案。

Electron 仅在以下情况作为回退选项：Tauri WebView 的麦克风采集在目标平台上无法稳定工作（见 15.5 风险预案）。

### 3.2 前端

推荐：

```text
React + TypeScript + Zustand + TanStack Query
```

用途：

- React：构建训练界面、报告页、历史页、设置页。
- TypeScript：约束 ASR、LLM、报告、评分等结构。
- Zustand：管理录音状态、训练状态、当前 session。
- TanStack Query：管理异步请求、历史数据读取、模型连接测试。

### 3.3 本地数据库

推荐：

```text
SQLite
```

原因：

- 桌面端部署简单。
- 适合保存训练历史。
- 支持趋势统计和本地搜索。
- 数据可导出、可备份。

### 3.4 音频处理

推荐：

```text
Web Audio API / AudioWorklet
```

职责：

- 麦克风采集。
- 音频分帧。
- 音量计算。
- 静音检测。
- VAD 输入。
- PCM/WAV 缓存。

采集与传输方案（主方案）：

- 前端 AudioWorklet 采集 48kHz float32 帧。
- 前端完成 48kHz -> 16kHz 重采样和 float32 -> int16 转换。
- 通过 Tauri IPC 将 16kHz int16 PCM 帧批量送入 Rust 后端（建议每 100-200ms 一批，约 5-10 次/秒，避免高频 IPC 开销）。
- Rust 侧负责 WAV 落盘和喂入本地 ASR。

备选方案：Rust 侧使用 cpal 直接采集麦克风，完全绕开 WebView 的 getUserMedia 权限差异。当主方案在某平台不稳定时切换（见 15.5）。

### 3.5 本地 ASR

可选模型：

- Sherpa-ONNX streaming zipformer（中文）：实时首选，延迟表现好，官方维护活跃。
- Sherpa-ONNX streaming Paraformer：实时备选，AISHELL-1 CER 约 1.95%，无需 GPU，生态成熟。
- SenseVoice-Small：精转写首选，234M 参数 CPU 推理极快，且自带情感/音频事件识别，可服务 emotion_expression 模式；sherpa-onnx 原生支持。
- FireRedASR：高精度可选项（AED 版 CER 低至 0.57%），1.1B+ 参数依赖 GPU，仅作为可选 Provider。
- Whisper.cpp：多语言场景备选，中文准确率不及国产模型。

推荐组合：

```text
实时字幕：Sherpa-ONNX streaming zipformer / Paraformer（Rust 进程内加载）
结束后精转写：SenseVoice-Small（本地默认）/ 在线 ASR
```

### 3.6 在线 ASR

第一版建议支持 OpenAI compatible transcription 协议：

```text
POST /v1/audio/transcriptions
```

配置项：

- API Key。
- Base URL。
- Model。
- Language。
- Response format。

后续再接入厂商：

- OpenAI。
- 阿里云。
- 火山引擎。
- 腾讯云。
- 讯飞。
- 自定义 WebSocket ASR。

### 3.7 LLM

推荐 Provider：

- OpenAI。
- DeepSeek。
- Ollama。
- Anthropic。
- 自定义 OpenAI compatible。

LLM 任务拆分：

- `realtime_hint`
- `final_report`
- `sentence_rewrite`
- `coach_question`
- `training_plan`
- `progress_summary`

所有任务都使用结构化输出。

## 4. 系统分层

```text
Application Layer
  UI / Routing / State

Training Layer
  Session lifecycle
  Practice modes
  Coaching flow

Audio Layer
  Capture
  VAD
  Audio buffering
  Export

ASR Layer
  Local ASR providers
  Online ASR providers
  Transcript normalization

Core Analysis Layer
  Metrics
  Scoring
  Rule feedback
  Sentence analysis

AI Layer
  LLM providers
  Prompt templates
  Structured schemas

Storage Layer
  SQLite
  Audio files
  Exported reports

Sync Layer
  Optional account
  Optional cloud backup
```

## 5. 核心模块设计

### 5.1 Training Session

训练 session 是系统核心对象。

```ts
type TrainingSession = {
  id: string;
  mode: PracticeMode;
  topic: string;
  goal: TrainingGoal;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  audioFile?: string;
  liveTranscript: TranscriptSegment[];
  finalTranscript?: string;
  metrics?: SessionMetrics;
  report?: StructuredReport;
};
```

Session 生命周期：

```text
created
-> recording
-> transcribing
-> analyzing
-> reviewed
-> retrying
-> completed
```

### 5.2 Practice Mode

训练模式决定题目、评分权重和反馈重点。

```ts
type PracticeMode =
  | "impromptu"
  | "meeting"
  | "interview"
  | "presentation"
  | "short_video"
  | "retelling"
  | "debate"
  | "emotion_expression";
```

示例权重：

```json
{
  "meeting": {
    "clarity": 0.25,
    "structure": 0.25,
    "directness": 0.25,
    "actionability": 0.25
  },
  "short_video": {
    "hook": 0.30,
    "density": 0.25,
    "rhythm": 0.25,
    "memorability": 0.20
  }
}
```

### 5.3 Audio Pipeline

实时链路：

```text
Microphone
-> AudioWorklet
-> PCM frame
-> VAD
-> Streaming ASR
-> partial transcript
-> realtime metrics
-> UI hint
```

结束后链路：

```text
Recorded audio
-> WAV export
-> optional online transcription
-> final transcript
-> full analysis
```

实时链路关键参数（初始值，需在真机上调优）：

- 采样率：16kHz int16 单声道（ASR 输入标准格式）。
- AudioWorklet 帧长：128 samples，前端聚合为 100-200ms 批次后经 IPC 发送。
- 端点检测（endpoint detection）：使用 sherpa-onnx 内置规则，静音 > 800ms 或单段时长 > 20s 视为句子结束。
- 长停顿判定（用于指标）：> 2s 记为一次 long pause。

partial / final 合并策略：

- 每个端点段对应一个 `TranscriptSegment`，段内 partial 结果只更新该 segment 的 `text`，不新增记录。
- 端点触发时该 segment 标记 `isFinal: true`，冻结文本，开启下一个 segment。
- UI 字幕只渲染最后 1 个非 final segment + 最近 N 个 final segment，避免全量重排。
- 实时指标只基于 final segment 计算，避免 partial 抖动导致指标跳变。

### 5.4 ASR Provider

统一接口：

```ts
type ASRProviderCapabilities = {
  streaming: boolean;
  batch: boolean;
  wordTimestamps: boolean;
  speakerDiarization: boolean;
  punctuation: boolean;
};

interface ASRProvider {
  id: string;
  name: string;
  capabilities: ASRProviderCapabilities;
  testConnection(config: ASRConfig): Promise<TestResult>;
}

interface StreamingASRProvider extends ASRProvider {
  start(config: ASRConfig): Promise<StreamingASRSession>;
}

interface BatchASRProvider extends ASRProvider {
  transcribe(file: AudioFile, config: ASRConfig): Promise<Transcript>;
}
```

Provider 示例：

```text
local-sherpa
local-whisper
openai-transcription
custom-openai-transcription
aliyun-asr
volcengine-asr
iflytek-asr
```

### 5.5 Transcript Pipeline

ASR 输出不应直接进入分析，需要标准化：

```text
raw transcript
-> normalize punctuation
-> split sentences
-> merge short fragments
-> remove ASR artifacts
-> assign timestamps
-> create utterances
```

Transcript 数据结构：

```ts
type TranscriptSegment = {
  id: string;
  startMs?: number;
  endMs?: number;
  text: string;
  isFinal: boolean;
  confidence?: number;
};
```

Segment 与 Utterance 的关系：

- `TranscriptSegment` 是 ASR 的原始产物，边界由端点检测决定，可能过碎或过长。
- `Utterance` 是分析单元，由 Transcript Pipeline 对 final segment 重新切分/合并生成（按标点断句、合并短碎片）。
- 逐句诊断、逐句改写、utterances 表均以 Utterance 为单位；segment 仅用于实时字幕和时间戳来源。
- 一个 Utterance 可映射到 1..N 个 segment，时间戳取首尾 segment 的 startMs/endMs。

### 5.6 Core Analysis

Core 层不依赖 UI、不依赖具体模型。

```text
core/
  transcript/
    normalize.ts
    segment.ts
  metrics/
    filler.ts
    hedge.ts
    vague.ts
    repetition.ts
    pace.ts
    pause.ts
    density.ts
  scoring/
    clarity.ts
    structure.ts
    directness.ts
    rhythm.ts
  feedback/
    ruleFeedback.ts
    issueDetector.ts
```

核心输出：

```ts
type SessionMetrics = {
  totalChars: number;
  totalWords: number;
  durationSec?: number;
  wordsPerMinute?: number;
  fillerCount: number;
  hedgeCount: number;
  vagueWordCount: number;
  repetitionRate: number;
  avgSentenceLength: number;
  longPauseCount?: number;
  densityScore: number;
};
```

中文指标计算口径：

- `totalChars`：去除标点和空白后的汉字 + 字母数字 token 数。
- `totalWords`：中文按字计数（不做分词），英文单词按词计数；混排时两者相加。
- `wordsPerMinute`：中文语速统一按 字/分钟 计算，正常口语参考区间 180-260 字/分钟。
- `avgSentenceLength`：按 Utterance 计，单位为字。
- `repetitionRate`：基于 2-4 字 n-gram 的重复占比（需先分句去停顿词）。
- 填充词/犹豫词/模糊词词表以配置文件维护（`core/metrics/lexicons/*.json`），初始词表示例：
  - 填充词：嗯、啊、呃、就是、然后、那个、这个、其实、对吧。
  - 犹豫词：可能、大概、好像、应该、差不多、我觉得吧。
  - 模糊词：一些、东西、搞一下、弄一下、之类的。
- 词表允许用户在设置中自定义增删，命中统计需记录原句位置以便复盘页展示证据。

### 5.7 LLM Analysis

LLM 输入：

```json
{
  "mode": "meeting",
  "goal": "先说结论",
  "transcript": "...",
  "metrics": {},
  "userProfile": {},
  "rubric": {}
}
```

LLM 输出：

```ts
type StructuredReport = {
  schemaVersion: number;
  summary: string;
  scores: {
    clarity: number;
    structure: number;
    directness: number;
    density: number;
    rhythm?: number;
    persuasiveness?: number;
  };
  topIssues: Issue[];
  sentenceFeedback: SentenceFeedback[];
  rewriteExamples: RewriteExample[];
  nextPractice: NextPractice;
};
```

版本化约定：

- `schemaVersion` 随 schema 演进递增，落库的 `report_json` 必须携带。
- 读取历史报告时按版本做迁移或降级渲染，禁止假设历史数据与当前 schema 一致。
- `metrics_json` 同样携带 `schemaVersion` 字段。

### 5.8 Coaching Engine

教练模块负责把报告转成下一轮训练任务。

规则：

- 每次只给 1 个主要改进目标。
- 目标必须可复练。
- 复练题目应尽量复用原始主题。
- 对比指标必须可量化。

示例：

```json
{
  "targetIssue": "late_conclusion",
  "instruction": "下一轮请在前 10 秒说出结论。",
  "retryPrompt": "重新说明这个项目为什么延期，以及你建议怎么处理。",
  "successCriteria": [
    "前 10 秒出现明确判断",
    "填充词少于 3 个",
    "包含至少 2 个具体原因"
  ]
}
```

## 6. 数据库设计

### 6.1 sessions

```sql
CREATE TABLE sessions (
  id TEXT PRIMARY KEY,
  mode TEXT NOT NULL,
  topic TEXT,
  goal TEXT,
  status TEXT NOT NULL,
  started_at TEXT NOT NULL,
  ended_at TEXT,
  duration_sec INTEGER,
  audio_path TEXT,
  live_transcript TEXT,
  final_transcript TEXT,
  metrics_json TEXT,
  report_json TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

### 6.2 utterances

```sql
CREATE TABLE utterances (
  id TEXT PRIMARY KEY,
  session_id TEXT NOT NULL,
  start_ms INTEGER,
  end_ms INTEGER,
  text TEXT NOT NULL,
  metrics_json TEXT,
  feedback_json TEXT,
  FOREIGN KEY (session_id) REFERENCES sessions(id)
);
```

### 6.3 practice_attempts

```sql
CREATE TABLE practice_attempts (
  id TEXT PRIMARY KEY,
  parent_session_id TEXT NOT NULL,
  round INTEGER NOT NULL,
  target_issue TEXT,
  transcript TEXT,
  metrics_json TEXT,
  comparison_json TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (parent_session_id) REFERENCES sessions(id)
);
```

### 6.4 user_profile

```sql
CREATE TABLE user_profile (
  id TEXT PRIMARY KEY,
  recurring_issues_json TEXT,
  baseline_scores_json TEXT,
  progress_trends_json TEXT,
  updated_at TEXT NOT NULL
);
```

### 6.5 settings

```sql
CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value_json TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
```

## 7. 设置系统

### 7.1 ASR 设置

```json
{
  "asr": {
    "realtimeProvider": "local-sherpa",
    "finalProvider": "openai-transcription",
    "useFinalRefinement": true,
    "providers": {
      "local-sherpa": {
        "modelPath": "/models/sherpa",
        "language": "zh"
      },
      "openai-transcription": {
        "apiKey": "",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4o-mini-transcribe",
        "language": "zh"
      }
    }
  }
}
```

### 7.2 LLM 设置

```json
{
  "llm": {
    "provider": "deepseek",
    "providers": {
      "openai": {
        "apiKey": "",
        "baseUrl": "https://api.openai.com/v1",
        "model": "gpt-4.1-mini"
      },
      "deepseek": {
        "apiKey": "",
        "baseUrl": "https://api.deepseek.com/v1",
        "model": "deepseek-chat"
      },
      "ollama": {
        "baseUrl": "http://localhost:11434",
        "model": "qwen2.5:7b"
      }
    }
  }
}
```

## 8. UI 信息架构

### 8.1 页面

```text
Home
  选择训练模式
  今日训练入口
  最近表现摘要

Practice
  题目
  录音控制
  实时字幕
  实时轻提示

Review
  最终逐字稿
  总体评分
  逐句诊断
  改写建议
  复练入口

Retry
  同题复练
  对比上一轮

History
  训练记录
  搜索
  过滤模式

Profile
  长期能力画像
  趋势图
  高频问题

Settings
  ASR 设置
  LLM 设置
  隐私与存储
```

### 8.2 录制页原则

录制页只展示必要信息：

- 题目。
- 当前目标。
- 计时器。
- 实时字幕。
- 少量指标。
- 一个主要提示。

避免展示大量报告、复杂图表和长 AI 建议。

### 8.3 复盘页原则

复盘页重点展示：

- 最值得改的 1-3 个问题。
- 有证据的原句。
- 改写前后对比。
- 下一轮复练任务。

## 9. API 和进程边界

桌面应用建议分成：

```text
Renderer Process
  UI
  Lightweight state

Main / Backend Process
  File system
  SQLite
  Local model lifecycle
  Secure API key access

Worker
  Audio processing
  Metrics calculation
  Heavy transcript analysis
```

不要在 UI 线程里执行重计算。

IPC 接口示例：

```ts
type AppAPI = {
  session: {
    create(input): Promise<TrainingSession>;
    startRecording(id): Promise<void>;
    stopRecording(id): Promise<TrainingSession>;
    analyze(id): Promise<StructuredReport>;
  };
  asr: {
    listProviders(): Promise<ASRProviderInfo[]>;
    testProvider(config): Promise<TestResult>;
  };
  llm: {
    listProviders(): Promise<LLMProviderInfo[]>;
    testProvider(config): Promise<TestResult>;
  };
  history: {
    list(query): Promise<TrainingSession[]>;
    get(id): Promise<TrainingSession>;
  };
};
```

## 10. 隐私和安全

默认策略：

- 音频保存在本地。
- API Key 保存在系统安全存储中。
- 用户明确开启在线 ASR 时才上传音频。
- 用户明确开启在线 LLM 时才上传逐字稿。
- 设置页清楚标注哪些数据会发送到第三方。

建议提供：

- 自动删除音频。
- 只保存文本不保存音频。
- 一键清空全部训练历史。
- 导出本地数据。

## 11. 云端能力规划

第一版可以不做云端。

如果后续要产品化，可增加服务端：

```text
API Server
  Auth
  Sync
  AI Gateway
  Prompt versioning
  Billing / quota

Database
  PostgreSQL

Queue
  Redis / BullMQ

Object Storage
  optional audio backup
```

云端只做可选同步和模型代理，不应成为本地训练的硬依赖。

## 12. MVP 范围

第一版建议只做以下能力：

- 训练模式选择。
- 本地实时转写。
- 粘贴逐字稿。
- 结束后结构化报告。
- 逐句诊断。
- 一键复练。
- SQLite 保存历史。
- ASR Provider 抽象。
- LLM Provider 抽象。
- OpenAI compatible 在线 ASR。
- OpenAI compatible / DeepSeek / Ollama LLM。

暂不做：

- 多人说话人分离。
- 云同步。
- 账号系统。
- 复杂社交功能。
- 大量厂商 ASR 适配。
- 过度复杂的实时 AI 教练。

## 13. 开发里程碑

### Milestone 0: 技术验证 Spike（3-5 天）

在正式开发前，用最少代码验证核心假设：

- Spike 1 音频链路（0.5 天）：Tauri + AudioWorklet 采集 -> 重采样 16k int16 -> IPC 送 Rust -> 落 WAV。验收：回放无爆音、无丢帧。
- Spike 2 流式 ASR（1-2 天）：Rust 集成 sherpa-rs + streaming zipformer，partial 结果经 Tauri event 推回前端。验收：说话到上屏 < 800ms，连续 3 分钟不崩、内存稳定。
- Spike 3 指标 + 规则报告（1 天）：实现填充词、语速、平均句长，停止录音后展示纯规则报告。验收：完整跑通「开始 -> 说话 -> 停止 -> 看报告」。
- Spike 4 LLM 报告（可选，0.5 天）：接 DeepSeek 输出 StructuredReport，失败降级规则报告。

任一 Spike 不达标时先解决或切换备选方案（cpal 采集 / Paraformer / Electron），再进入 Milestone 1。

### Milestone 1: 基础训练闭环

- 新建桌面应用。
- 完成录音。
- 完成本地 ASR。
- 完成逐字稿展示。
- 完成基础指标。
- 完成一次训练报告。

### Milestone 2: Provider 化

- 抽象 ASR Provider。
- 抽象 LLM Provider。
- 增加 OpenAI compatible 在线转写。
- 增加模型连接测试。

### Milestone 3: 复练和对比

- 增加复练任务。
- 保存多轮尝试。
- 对比两轮指标。
- 生成下一轮建议。

### Milestone 4: 历史和画像

- SQLite 持久化。
- 历史列表。
- 趋势统计。
- 高频问题画像。

### Milestone 5: 产品完善

- 导出报告。
- 隐私设置。
- 数据清理。
- 模型管理。
- 训练计划。

## 14. 推荐目录结构

```text
apps/
  desktop/
    src/
      app/
      pages/
      components/
      state/
      ipc/

packages/
  core/
    transcript/
    metrics/
    scoring/
    feedback/
    coaching/

  asr/
    providers/
      local-sherpa/
      local-whisper/
      openai-transcription/
      custom/
    types.ts

  llm/
    providers/
      openai/
      deepseek/
      ollama/
      custom/
    prompts/
    schemas/

  storage/
    migrations/
    repositories/
    db.ts

  shared/
    types/
    utils/
```

如果项目早期不想上 monorepo，也可以先使用单仓库目录：

```text
src/
  app/
  features/
  core/
  asr/
  llm/
  storage/
  shared/
```

## 15. 关键风险

### 15.1 ASR 准确率影响分析质量

解决方式：

- 保留用户编辑逐字稿能力。
- 支持结束后在线精转写。
- 分析前做文本清洗。

### 15.2 实时反馈干扰表达

解决方式：

- 录制时只做轻提示。
- 长反馈放到复盘页。

### 15.3 AI 输出不稳定

解决方式：

- 使用 JSON schema。
- 对输出做校验。
- 失败时降级到规则报告。

### 15.4 功能过多导致 MVP 失焦

解决方式：

- 第一版只做一个训练闭环。
- 每次报告只推荐一个复练目标。
- 历史画像后置。

### 15.5 录音链路故障与降级

风险场景：

- WebView getUserMedia 权限异常或麦克风被占用。
- 录音中途设备切换（拔插耳机、蓝牙断连）导致流中断。
- 流式 ASR 崩溃或喂入超时，字幕停止更新。

解决方式：

- 录音与转写解耦：PCM 始终先落盘（WAV），ASR 崩溃不丢音频，结束后可用批量转写补救。
- 监听设备变更事件，流中断时自动重建音频流并在 UI 提示，session 继续而非报废。
- ASR watchdog：连续 N 秒无输出则重启 recognizer，重启期间字幕显示"识别恢复中"。
- macOS 需配置麦克风 entitlements 与用途描述；若 WebView 采集在目标平台不可用，切换到 Rust cpal 采集方案（见 3.4）。
- 训练进行中每 10s 持久化一次 live transcript，进程崩溃后可恢复未完成 session。

## 16. 最终建议

从零实现时，建议采用：

```text
Tauri / Electron
+ React
+ TypeScript
+ Zustand
+ SQLite
+ AudioWorklet
+ ASR Provider
+ LLM Provider
+ Core deterministic analysis
+ Structured AI report
```

产品上先做好一件事：

```text
让用户完成一次训练，并能马上复练，看见自己变好。
```

只要这个闭环成立，后续再扩展更多模型、更多场景、更多统计能力，系统才有稳定的产品基础。
