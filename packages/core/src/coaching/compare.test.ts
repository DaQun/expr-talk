import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { compareAttempts } from "./compare";
import { emptySessionMetrics } from "@showtalk/shared";
import { emptyStructuredReport } from "@showtalk/shared";

describe("compareAttempts", () => {
  it("marks improved when fillers drop for too_many_fillers", () => {
    const before = { ...emptySessionMetrics(), totalChars: 100, fillerCount: 8, densityScore: 60 };
    const after = { ...emptySessionMetrics(), totalChars: 100, fillerCount: 2, densityScore: 72 };
    const cmp = compareAttempts({
      parentSessionId: "p1",
      round: 2,
      targetIssue: "too_many_fillers",
      beforeMetrics: before,
      afterMetrics: after,
      successCriteria: ["填充词少于 3 个"],
    });
    assert.equal(cmp.improved, true);
    assert.equal(cmp.fillerDelta, -6);
    assert.ok(cmp.successCriteriaMet.length >= 1);
    assert.ok(cmp.notes.some((n) => n.includes("每百字填充词")));
  });

  it("marks not improved when fillers rise", () => {
    const before = { ...emptySessionMetrics(), totalChars: 100, fillerCount: 2, densityScore: 70 };
    const after = { ...emptySessionMetrics(), totalChars: 100, fillerCount: 9, densityScore: 65 };
    const cmp = compareAttempts({
      parentSessionId: "p1",
      round: 2,
      targetIssue: "too_many_fillers",
      beforeMetrics: before,
      afterMetrics: after,
    });
    assert.equal(cmp.improved, false);
    assert.equal(cmp.fillerDelta, 7);
  });

  it("does not reward a lower raw filler count when the answer is much shorter", () => {
    const cmp = compareAttempts({
      parentSessionId: "p1",
      round: 2,
      targetIssue: "filler_overload",
      beforeMetrics: {
        ...emptySessionMetrics(),
        totalChars: 1_000,
        fillerCount: 10,
        densityScore: 70,
      },
      afterMetrics: {
        ...emptySessionMetrics(),
        totalChars: 100,
        fillerCount: 2,
        densityScore: 70,
      },
    });

    assert.equal(cmp.fillerDelta, -8);
    assert.equal(cmp.deltas.fillerRateDelta, 1);
    assert.equal(cmp.improved, false);
    assert.equal(cmp.conclusive, true);
  });

  it("reports mixed metric movement as inconclusive", () => {
    const cmp = compareAttempts({
      parentSessionId: "p1",
      round: 2,
      beforeMetrics: {
        ...emptySessionMetrics(),
        totalChars: 100,
        fillerCount: 5,
        densityScore: 70,
      },
      afterMetrics: {
        ...emptySessionMetrics(),
        totalChars: 100,
        fillerCount: 2,
        densityScore: 60,
      },
    });

    assert.equal(cmp.improved, false);
    assert.equal(cmp.conclusive, false);
  });

  it("prioritizes the target dimension when V4 reports are available", () => {
    const metrics = { ...emptySessionMetrics(), densityScore: 70 };
    const beforeReport = {
      ...emptyStructuredReport(),
      dimensionReviews: {
        logic: { score: 55, verdict: "较弱", evidence: "缺论据", source: "llm" as const },
      },
    };
    const afterReport = {
      ...emptyStructuredReport(),
      dimensionReviews: {
        logic: { score: 72, verdict: "改善", evidence: "补充论据", source: "llm" as const },
      },
    };
    const cmp = compareAttempts({
      parentSessionId: "p1",
      round: 2,
      targetIssue: "unsupported_claim",
      beforeMetrics: metrics,
      afterMetrics: metrics,
      beforeReport,
      afterReport,
    });

    assert.equal(cmp.improved, true);
    assert.equal(cmp.deltas.targetDimension, "logic");
    assert.equal(cmp.deltas.targetDimensionDelta, 17);
  });
});
