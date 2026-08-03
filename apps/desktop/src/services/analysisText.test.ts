import assert from "node:assert/strict";
import test from "node:test";
import { selectAnalysisText } from "./analysisText";

test("keeps a short transcript intact", () => {
  const result = selectAnalysisText("开头、论证、结论", 100);
  assert.equal(result.text, "开头、论证、结论");
  assert.equal(result.coverage.strategy, "full");
});

test("samples the beginning, middle and conclusion of long transcripts", () => {
  const input = `${"A".repeat(500)}${"M".repeat(500)}${"Z".repeat(500)}`;
  const result = selectAnalysisText(input, 600);
  assert.equal(result.coverage.strategy, "sampled");
  assert.match(result.text, /^A+/);
  assert.ok(result.text.includes("M"));
  assert.match(result.text, /Z+$/);
  assert.ok(result.text.length <= 600);
});
