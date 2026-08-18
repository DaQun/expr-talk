#!/usr/bin/env bash
# 下载 Spike 2 用 streaming zipformer 中英双语模型到仓库 models/
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
MODEL_NAME="sherpa-onnx-streaming-zipformer-bilingual-zh-en-2023-02-20"
TARGET_DIR="$ROOT/models/streaming-zipformer-zh-en"
URL="https://github.com/k2-fsa/sherpa-onnx/releases/download/asr-models/${MODEL_NAME}.tar.bz2"
TMP_TAR="$ROOT/models/${MODEL_NAME}.tar.bz2"

mkdir -p "$ROOT/models"

if [[ -f "$TARGET_DIR/encoder-epoch-99-avg-1.int8.onnx" \
   && -f "$TARGET_DIR/decoder-epoch-99-avg-1.onnx" \
   && -f "$TARGET_DIR/joiner-epoch-99-avg-1.int8.onnx" \
   && -f "$TARGET_DIR/tokens.txt" ]]; then
  echo "模型已存在: $TARGET_DIR"
  ls -lh "$TARGET_DIR"/*.{onnx,txt} 2>/dev/null || ls -lh "$TARGET_DIR"
  exit 0
fi

echo "下载 $URL ...（支持断点续传）"
curl -L --fail --retry 8 --retry-delay 3 -C - --progress-bar -o "$TMP_TAR" "$URL"

echo "解压..."
rm -rf "$ROOT/models/$MODEL_NAME" "$TARGET_DIR"
tar -xjf "$TMP_TAR" -C "$ROOT/models"
mv "$ROOT/models/$MODEL_NAME" "$TARGET_DIR"
rm -f "$TMP_TAR"

echo "完成: $TARGET_DIR"
ls -lh "$TARGET_DIR" | head -20
echo
echo "可选：export SHOWTALK_ASR_MODEL_DIR=\"$TARGET_DIR\""
