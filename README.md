# ExprTalk — 新一代表达训练系统

本地优先的口头表达训练桌面应用：录音 → 转写 → 结构化诊断 → 逐句改写 → 复练对比 → 长期能力画像。

支持四种训练模式：自由发挥、口播（按主题）、辩论（多轮质询）、费曼学习法（小白追问）。

架构说明见 [`docs/architecture.md`](./docs/architecture.md)，转写管线规范见 [`docs/transcript-pipeline-spec.md`](./docs/transcript-pipeline-spec.md)。

## 技术栈

| 层级 | 选型 |
|------|------|
| 桌面壳 | Tauri 2.x（Rust 后端） |
| 前端 | React + TypeScript + Zustand + TanStack Query |
| 本地存储 | SQLite（Rust 侧，sessions / settings / utterances） |
| 本地 ASR | Sherpa-ONNX 流式识别（离线，含中文模型） |
| 在线 ASR | 阿里云 / 腾讯云 / 火山引擎 / OpenAI 兼容 |
| 在线 LLM | DeepSeek / OpenAI / Ollama / 自定义（OpenAI 兼容） |

## 仓库结构

```text
apps/
  desktop/          # Tauri + React 桌面应用（前端 + Rust command）
packages/
  shared/           # 跨包共享类型与常量（训练模式 / 评分 / 主题）
  core/             # 确定性指标 / 规则反馈 / 教练引擎
  asr/              # ASR Provider 抽象与实现（本地 sherpa + 在线）
  llm/              # LLM Provider 抽象与实现（deepseek / openai / ollama / custom）
  storage/          # SQLite schema / repository
docs/
  architecture.md               # 架构设计文档
  transcript-pipeline-spec.md   # 转写管线规范
models/             # 本地 ASR 模型（streaming-zipformer-zh-en）
scripts/
  download-asr-model.sh  # 下载本地 ASR 模型
```

## 训练模式

| 模式 | 说明 |
|------|------|
| 自由发挥 | 自定题目，练开口、结构与少废话 |
| 口播 · 按主题 | 选题口播，练钩子、密度与行动号召 |
| 辩论 | 给定立场，立论后由模型扮演反方质询，多轮回应 |
| 费曼学习法 | 向"小白"讲清概念，模型按理解检查点追问直到听懂 |

辩论与费曼为交互模式：**开始前可选文字或语音输入，开始后锁定不可切换**。

## 快速开始

```bash
# 安装依赖
npm install

# 仅前端（浏览器预览 UI，无原生能力）
npm run dev

# 桌面应用（需本机已装 Rust）
npm run tauri:dev

# 类型检查
npm run typecheck

# 测试
npm test
```

## 功能清单

- [x] Monorepo 与包边界
- [x] 共享领域类型（Session / Metrics / Report / PracticeMode / Provider）
- [x] Core 确定性指标（填充词、犹豫词、模糊词、语速等）
- [x] 页面信息架构（Home / Practice / Review / History / Profile / Settings / Retry）
- [x] 麦克风录音：AudioWorklet + 16k int16 + WAV（浏览器缓冲 / Tauri 落盘）
- [x] 本地流式 ASR（Sherpa-ONNX OnlineRecognizer + 实时字幕）
- [x] 在线 ASR Provider（阿里云 / 腾讯云 / 火山引擎 / OpenAI 兼容）
- [x] SQLite 持久化（sessions / settings / utterances）
- [x] LLM 结构化报告（schemaVersion 校验、流式进度展示）
- [x] 开始前检查 LLM 配置，停止后生成结构化报告
- [x] 复练对比（相对上一轮填充词/犹豫词/密度等 delta）
- [x] 辩论模式：反方质询多轮交互（含防重复质询约束）
- [x] 费曼学习法：理解检查点累积追问，直到确认听懂
- [x] 交互模式输入方式统一：开始前选文字/语音，开始后锁定

### 本地 ASR 模型

```bash
./scripts/download-asr-model.sh
npm run tauri:dev
```

模型目录见 `models/README.md`。未下载模型时仍可录音落盘，字幕会提示模型未就绪。

## 开发原则（摘要）

1. **本地优先**：录音、字幕、基础指标默认本地完成。
2. **ASR 与 LLM 分离**：`audio → transcript` 与 `transcript → diagnosis` 独立 Provider。
3. **确定性分析与 AI 分析分离**：填充词/语速等走规则；结构/说服力走 LLM。
4. **结构化数据优先**：AI 输出必须带 `schemaVersion` 的 JSON，不把 Markdown 当数据源。
