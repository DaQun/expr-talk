import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { computeSessionMetrics } from "./compute";

describe("computeSessionMetrics", () => {
  it("counts Chinese fillers and produces density score", () => {
    const text =
      "嗯那个这个项目其实就是延期了，然后我们可能大概需要再搞一下排期。";
    const metrics = computeSessionMetrics({
      text,
      durationSec: 20,
      utteranceCount: 2,
    });

    assert.ok(metrics.fillerCount >= 3);
    assert.ok(metrics.totalChars > 0);
    assert.ok(metrics.wordsPerMinute != null);
    assert.ok(metrics.densityScore >= 0 && metrics.densityScore <= 100);
    assert.equal(metrics.schemaVersion, 1);
  });

  it("does not invent pace when duration is unknown", () => {
    const metrics = computeSessionMetrics({
      text: "这是粘贴的文字，不代表真实口述时长。",
    });

    assert.equal(metrics.durationSec, undefined);
    assert.equal(metrics.wordsPerMinute, undefined);
  });
});
