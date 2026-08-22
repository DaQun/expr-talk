import assert from "node:assert/strict";
import test from "node:test";
import {
  asrSubtitle,
  builtinLlmProviders,
  customChannelConfigured,
  filterUsableAsrProviders,
  isCustomLlmId,
  llmPlaceholders,
  llmSubtitle,
  visibleCustomLlmEntries,
} from "./settingsChannels";

test("asr subtitle stays pending until credentials exist", () => {
  assert.equal(asrSubtitle("aliyun-bailian", { model: "paraformer-realtime-v2" }), "待配置");
  assert.equal(
    asrSubtitle("aliyun-bailian", {
      apiKey: "sk-test",
      model: "paraformer-realtime-v2",
    }),
    "paraformer-realtime-v2",
  );
  assert.equal(asrSubtitle("tencent-asr", { appId: "123" }), "待配置");
  assert.equal(
    asrSubtitle("tencent-asr", {
      secretId: "id",
      secretKey: "key",
      appId: "123",
    }),
    "AppId 123",
  );
  assert.equal(asrSubtitle("local-sherpa", {}, true), "本地模型 · 已就绪");
  assert.equal(asrSubtitle("local-sherpa", {}, false), "本地模型 · 未下载");
});

test("llm subtitle ignores default model names without a key", () => {
  assert.equal(llmSubtitle({ model: "deepseek-chat" }), "待配置");
  assert.equal(
    llmSubtitle({ apiKey: "sk-test", model: "deepseek-chat" }),
    "deepseek-chat",
  );
  assert.equal(
    llmSubtitle({ baseUrl: "http://127.0.0.1:11434/v1", model: "qwen" }),
    "qwen",
  );
  assert.equal(
    llmSubtitle({ baseUrl: "http://localhost:11434/v1" }),
    "待配置",
  );
});

test("hides empty builtin custom unless it is the active provider", () => {
  const providers = {
    custom: { apiKey: "", baseUrl: "", model: "" },
    "custom:abc": { name: "硅基流动", apiKey: "sk", baseUrl: "", model: "" },
  };
  assert.deepEqual(
    visibleCustomLlmEntries(providers, "deepseek").map((e) => e.id),
    ["custom:abc"],
  );
  assert.deepEqual(
    visibleCustomLlmEntries(providers, "custom").map((e) => e.id),
    ["custom", "custom:abc"],
  );
  assert.equal(customChannelConfigured(providers.custom), false);
  assert.equal(isCustomLlmId("custom:abc"), true);
});

test("filters unimplemented ASR and keeps the active one", () => {
  const listed = filterUsableAsrProviders(
    [
      { id: "local-sherpa" },
      { id: "openai-transcription" },
      { id: "aliyun-bailian" },
    ],
    "local-sherpa",
  );
  assert.deepEqual(
    listed.map((p) => p.id),
    ["local-sherpa", "aliyun-bailian"],
  );
  assert.deepEqual(
    filterUsableAsrProviders(
      [
        { id: "local-sherpa" },
        { id: "openai-transcription" },
      ],
      "openai-transcription",
    ).map((p) => p.id),
    ["local-sherpa", "openai-transcription"],
  );
});

test("builtin LLM list is DeepSeek then OpenAI, without custom", () => {
  const listed = builtinLlmProviders([
    { id: "openai" },
    { id: "custom" },
    { id: "deepseek" },
  ]);
  assert.deepEqual(
    listed.map((p) => p.id),
    ["deepseek", "openai"],
  );
});

test("placeholders follow the viewed channel", () => {
  assert.equal(llmPlaceholders("deepseek").model, "deepseek-chat");
  assert.equal(llmPlaceholders("openai").baseUrl, "https://api.openai.com/v1");
  assert.equal(llmPlaceholders("custom:foo").model, "model-id");
});
