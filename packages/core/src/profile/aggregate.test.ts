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

  it("keeps failed and unfinished attempts out of progress metrics", () => {
    const reviewed = session(0);
    const failed: TrainingSession = {
      ...session(1),
      id: "failed",
      status: "failed",
      durationSec: 600,
      report: undefined,
      metrics: undefined,
    };
    const created: TrainingSession = {
      ...failed,
      id: "created",
      status: "created",
    };
    const profile = buildUserProfile([reviewed, failed, created]);
    assert.equal(profile.attemptCount, 3);
    assert.equal(profile.sessionCount, 1);
    assert.equal(profile.reviewedSessionCount, 1);
    assert.equal(profile.interruptedSessionCount, 1);
    assert.equal(profile.totalDurationSec, 60);
  });

  it("groups legacy model issue aliases into one recurring issue", () => {
    const first = session(0);
    const second = session(1);
    first.report!.topIssues[0] = {
      code: "FILLER_ABUSE" as never,
      title: "填充词和无效内容过多",
      severity: "high",
    };
    second.report!.topIssues[0] = {
      code: "filler_words" as never,
      title: "填充语过多",
      severity: "medium",
    };

    const profile = buildUserProfile([first, second]);

    assert.equal(profile.recurringIssues[0]?.code, "too_many_fillers");
    assert.equal(profile.recurringIssues[0]?.count, 2);
  });
});
