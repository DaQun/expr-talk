import assert from "node:assert/strict";
import test from "node:test";
import type { TrainingSession } from "@expr-talk/shared";
import {
  finishFeynmanEvaluation,
  formatDebateTranscript,
  initialDebateState,
  matchesActiveRecording,
  recordingIdsForSession,
  shouldFinishFeynmanRound,
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

test("ends Feynman sessions when understood or at the round limit", () => {
  assert.equal(shouldFinishFeynmanRound(feynmanSession(2), { understood: true }), true);
  assert.equal(shouldFinishFeynmanRound(feynmanSession(6), { understood: false }), true);
  const completed = finishFeynmanEvaluation(feynmanSession(6).debate!, { understood: false });
  assert.equal(completed.phase, "completed");
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
