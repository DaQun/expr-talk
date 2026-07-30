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
});
