# ExprTalk — 新一代表达训练系统

本地优先的口头表达训练桌面应用：录音 → 转写 → 结构化诊断 → 逐句改写 → 复练对比 → 长期能力画像。

架构说明见 [`docs/architecture.md`](./docs/architecture.md)。

## 技术栈

| 层级 | 选型 |
|------|------|
| 桌面壳 | Tauri 2.x |
| 前端 | React + TypeScript + Zustand + TanStack Query |
| 本地存储 | SQLite（Rust 侧，后续接入） |
| 本地 ASR | Sherpa-ONNX（计划） |
| 在线能力 | OpenAI compatible ASR / LLM |

## 仓库结构

```text
apps/
  desktop/          # Tauri + React 桌面应用
packages/
  shared/           # 跨包共享类型与常量
  core/             # 确定性指标 / 规则反馈 / 教练引擎
  asr/              # ASR Provider 抽象与实现占位
  llm/              # LLM Provider 抽象与实现占位
  storage/          # SQLite schema / repository 占位
docs/
  architecture.md   # 架构设计文档
```

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
```

## MVP 范围（当前骨架已覆盖）

- [x] Monorepo 与包边界
- [x] 共享领域类型（Session / Metrics / Report / Provider）
- [x] Core 确定性指标（填充词、犹豫词、模糊词、语速等）
- [x] 页面信息架构（Home / Practice / Review / History / Profile / Settings）
- [x] IPC 与 Rust command 占位
- [x] Spike 1：麦克风 + AudioWorklet + 16k int16 + WAV（浏览器缓冲 / Tauri 落盘）
- [x] Spike 2：本地流式 ASR（官方 sherpa-onnx OnlineRecognizer + Tauri event 字幕）
- [x] SQLite 持久化（sessions / settings）
- [x] 停止后自动规则报告 + 可选 LLM 结构化报告（失败降级）
- [x] 复练对比（相对上一轮填充词/犹豫词/密度等 delta）

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
