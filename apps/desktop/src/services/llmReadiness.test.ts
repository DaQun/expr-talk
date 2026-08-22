import assert from "node:assert/strict";
import test from "node:test";
import { DEFAULT_SETTINGS } from "@showtalk/shared";
import { resolveLlmConfig } from "./llmReadiness";

test("blocks an online provider without an API key", () => {
  const result = resolveLlmConfig(DEFAULT_SETTINGS);
  assert.equal(result.ok, false);
  if (!result.ok) assert.match(result.reason, /API Key/);
});

test("allows a configured online provider", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.llm.providers.deepseek.apiKey = "test-key";
  const result = resolveLlmConfig(settings);
  assert.equal(result.ok, true);
});

test("allows a local endpoint without a remote credential", () => {
  const settings = structuredClone(DEFAULT_SETTINGS);
  settings.llm.provider = "custom";
  settings.llm.providers.custom = {
    apiKey: "",
    baseUrl: "http://localhost:11434/v1",
    model: "qwen2.5:7b",
  };
  const result = resolveLlmConfig(settings);
  assert.equal(result.ok, true);
});
