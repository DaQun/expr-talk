import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  emptySessionMetrics,
  emptyStructuredReport,
  type TrainingSession,
} from "@expr-talk/shared";
import { buildUserProfile } from "./aggregate";

function session(index: number, issue = "too_many_fillers"): TrainingSession {
  return {
    id: `s${index}`,
    mode: "free",
    topic: "test",
    goal: "reduce_fillers",
    status: "reviewed",
    startedAt: `2026-07-${String(index + 1).padStart(2, "0")}T10:00:00Z`,
    durationSec: 60,
    liveTranscript: [],
    metrics: {
      ...emptySessionMetrics(),
      totalChars: 100,
      fillerCount: Math.max(0, 7 - index),
      densityScore: 60 + index,
    },
    report: {
      ...emptyStructuredReport(),
      scores: { clarity: 60 + index * 2, structure: 70 },
      topIssues:
        issue === "none"
          ? []
          : [
              {
                code: "too_many_fillers",
                title: "填充词偏多",
                severity: "medium",
                suggestion: "停顿代替嗯啊",
              },
            ],
    },
  };
}

describe("buildUserProfile", () => {
  it("keeps the profile insufficient before three reviewed sessions", () => {
    const profile = buildUserProfile([session(0), session(1)]);
    assert.equal(profile.maturity, "insufficient");
    assert.equal(profile.reviewedSessionCount, 2);
    assert.equal(profile.focus?.code, "too_many_fillers");
  });

  it("builds mode scores, trends and recurring issues", () => {
    const profile = buildUserProfile([
      session(0),
      session(1),
      session(2),
      session(3, "none"),
      session(4, "none"),
      session(5, "none"),
    ]);
    assert.equal(profile.maturity, "established");
    assert.equal(profile.modeAbilities[0]?.sessionCount, 6);
    assert.equal(profile.recurringIssues[0]?.trend, "improving");
    assert.ok(
      profile.trends.some((trend) => trend.key === "clarity" && trend.improved),
    );
    assert.ok(
      profile.trends.some(
        (trend) => trend.key === "fillerRate" && trend.improved,
      ),
    );
  });
});
