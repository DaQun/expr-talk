# ASR 模型目录

Spike 2 默认使用：

**sherpa-onnx streaming zipformer 中英双语（2023-02-20）**

## 下载

在仓库根目录执行：

```bash
./scripts/download-asr-model.sh
```

完成后应出现：

```text
models/streaming-zipformer-zh-en/
  encoder-epoch-99-avg-1.int8.onnx
  decoder-epoch-99-avg-1.onnx
  joiner-epoch-99-avg-1.int8.onnx
  tokens.txt
```

## 路径解析顺序

1. 环境变量 `SHOWTALK_ASR_MODEL_DIR`（兼容旧名 `EXPR_TALK_ASR_MODEL_DIR`）
2. App Data：`~/Library/Application Support/com.showtalk.app/models/streaming-zipformer-zh-en`（macOS）
3. 仓库 `models/streaming-zipformer-zh-en`（开发）

模型体积较大（约数百 MB），已加入 `.gitignore`。
