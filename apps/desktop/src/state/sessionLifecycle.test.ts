import assert from "node:assert/strict";
import test from "node:test";
import type { TrainingSession } from "@expr-talk/shared";
import {
  scoreFromFeynmanCheckpoints,
  taskChecksFromFeynmanCheckpoints,
} from "@expr-talk/shared";
import {
  applyFeynmanEvaluation,
  formatDebateTranscript,
  initialDebateState,
  matchesActiveRecording,
  recordingIdsForSession,
  withoutSessionRecordings,
} from "./sessionLifecycle";

function feynmanSession(round: number): TrainingSession {
  return {
    id: "ses_feynman",
    mode: "feynman",
    topic: "复利",
    goal: "clarity",
    status: "debating",
    startedAt: "2026-07-31T00:00:00.000Z",
    liveTranscript: [],
    debate: { ...initialDebateState("feynman"), currentRound: round },
  };
}

test("maps Feynman checkpoints to review task checks without extra textbook bars", () => {
  const checkpoints = [
    { id: "definition" as const, status: "understood" as const, evidence: "钱多了物价涨了" },
    {
      id: "mechanism" as const,
      status: "understood" as const,
      evidence: "钱多→购买力强→供需失衡",
    },
    { id: "example" as const, status: "understood" as const, evidence: "冷饮和吃面变贵" },
    { id: "boundary" as const, status: "in_progress" as const, evidence: "承认还不清楚边界" },
  ];
  assert.deepEqual(
    taskChecksFromFeynmanCheckpoints(checkpoints).map((check) => check.status),
    ["met", "met", "met", "partial"],
  );
  assert.equal(scoreFromFeynmanCheckpoints(checkpoints), 85);
});

test("initializes independent Feynman checkpoints", () => {
  const first = initialDebateState("feynman");
  const second = initialDebateState("feynman");
  first.feynman!.checkpoints[0].status = "understood";
  assert.equal(second.feynman!.checkpoints[0].status, "not_started");
});

test("formats role-aware interactive transcripts", () => {
  const debate = initialDebateState("feynman");
  debate.turns = [
    { id: "u", role: "user", round: 1, text: "复利是利滚利", createdAt: "now" },
    { id: "q", role: "opponent", round: 1, text: "举个例子？", createdAt: "now" },
  ];
  assert.equal(
    formatDebateTranscript(debate),
    "第 1 轮，讲解：复利是利滚利\n第 1 轮，小白提问：举个例子？",
  );
});

test("keeps Feynman sessions open after understanding and beyond six rounds", () => {
  const understood = applyFeynmanEvaluation(feynmanSession(6).debate!, {
    understood: true,
    question: "",
    focus: "复利会让本金和收益一起参与下一轮计算",
  });
  assert.equal(understood.phase, "cross_examination");
  assert.equal(understood.pendingQuestion, undefined);
  assert.equal(
    understood.turns[understood.turns.length - 1]?.text,
    "我已经理解：复利会让本金和收益一起参与下一轮计算",
  );

  const questioning = applyFeynmanEvaluation(feynmanSession(12).debate!, {
    understood: false,
    question: "这个规律在什么情况下不适用？",
  });
  assert.equal(questioning.phase, "cross_examination");
  assert.equal(questioning.pendingQuestion, "这个规律在什么情况下不适用？");
});

test("removes all persisted recording references", () => {
  const session = feynmanSession(2);
  session.audioFile = "/recordings/main.wav";
  session.debate!.turns = [
    {
      id: "u",
      role: "user",
      round: 1,
      text: "说明",
      createdAt: "now",
      audioFile: "/recordings/turn.wav",
      audioRecordingId: "turn-1",
    },
  ];
  assert.deepEqual(recordingIdsForSession(session), ["ses_feynman", "turn-1"]);
  const cleaned = withoutSessionRecordings(session);
  assert.equal(cleaned.audioFile, undefined);
  assert.equal(cleaned.debate?.turns[0].audioFile, undefined);
  assert.equal(cleaned.debate?.turns[0].audioRecordingId, undefined);
});

test("accepts ASR events only for the active session recording", () => {
  const session = feynmanSession(2);
  session.status = "recording";
  assert.equal(matchesActiveRecording(session, "ses_feynman"), true);
  assert.equal(matchesActiveRecording(session, "ses_feynman_turn_2_next"), true);
  assert.equal(matchesActiveRecording(session, "ses_feynman_turnish"), false);
  assert.equal(matchesActiveRecording(session, "another_session_turn_2"), false);
  assert.equal(matchesActiveRecording({ ...session, status: "debating" }, "ses_feynman"), false);
});
