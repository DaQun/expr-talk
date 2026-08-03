import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  formatFinalAsrSegment,
  joinFinalSegments,
} from "./normalize";
import { segmentsToUtterances } from "./segment";

describe("formatFinalAsrSegment", () => {
  it("appends period when missing", () => {
    assert.equal(formatFinalAsrSegment("项目延期了"), "项目延期了。");
  });

  it("keeps existing end punct", () => {
    assert.equal(formatFinalAsrSegment("已经完成了。"), "已经完成了。");
  });

  it("uses question mark for 吗", () => {
    assert.equal(formatFinalAsrSegment("这样可以吗"), "这样可以吗？");
  });
});

describe("joinFinalSegments", () => {
  it("joins with newlines and punctuates", () => {
    const text = joinFinalSegments([
      { text: "第一点", isFinal: true },
      { text: "第二点", isFinal: true },
    ]);
    assert.equal(text, "第一点。\n第二点。");
  });
});

describe("segmentsToUtterances", () => {
  it("keeps pasted lines as separate utterances without punctuation", () => {
    const utterances = segmentsToUtterances("ses_test", [
      {
        id: "seg_1",
        text: "第一条完整论据\n第二条完整论据",
        isFinal: true,
      },
    ]);

    assert.deepEqual(
      utterances.map((item) => item.text),
      ["第一条完整论据", "第二条完整论据"],
    );
  });

  it("splits long punctuation-free ASR text at discourse markers", () => {
    const utterances = segmentsToUtterances("ses_rules", [
      {
        id: "seg_rules",
        text: "我先说明这个方案的目标然后解释它的实现方式但是这里还有一个明显的风险所以最后需要给出回滚计划",
        isFinal: true,
      },
    ]);
    assert.ok(utterances.length >= 3);
    assert.ok(utterances.some((item) => item.text.startsWith("但是")));
    assert.ok(utterances.some((item) => item.text.startsWith("所以")));
  });

  it("keeps segment ownership and estimates sub-sentence timestamps", () => {
    const utterances = segmentsToUtterances("ses_timing", [
      {
        id: "seg_timed",
        text: "这是第一句完整内容。这是第二句完整内容。",
        startMs: 1_000,
        endMs: 5_000,
        isFinal: true,
      },
    ]);
    assert.equal(utterances.length, 2);
    assert.deepEqual(utterances[0].segmentIds, ["seg_timed"]);
    assert.equal(utterances[0].timeSource, "estimated");
    assert.ok((utterances[0].endMs ?? 0) <= (utterances[1].startMs ?? 0));
  });

  it("drops isolated acknowledgement fragments", () => {
    const utterances = segmentsToUtterances("ses_ack", [
      { id: "seg_ack", text: "嗯。这个方案需要先验证用户需求。", isFinal: true },
    ]);
    assert.deepEqual(utterances.map((item) => item.text), ["这个方案需要先验证用户需求。"]);
  });
});
