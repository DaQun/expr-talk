import type {
  DebateState,
  FeynmanCheckpoint,
  FeynmanDifficulty,
  FeynmanLearnerRole,
  PracticeMode,
  TrainingSession,
} from "@expr-talk/shared";
import {
  mergeFeynmanCheckpoints,
  shouldCompleteFeynmanTurn,
} from "@expr-talk/llm";

const FEYNMAN_CHECKPOINTS: FeynmanCheckpoint[] = [
  { id: "definition", status: "not_started" },
  { id: "mechanism", status: "not_started" },
  { id: "example", status: "not_started" },
  { id: "boundary", status: "not_started" },
];

export function turnRecordingId(sessionId: string, round: number): string {
  return `${sessionId}_turn_${round}_${Date.now().toString(36)}`;
}

export function matchesActiveRecording(
  session: TrainingSession | null,
  recordingId: string,
): boolean {
  return Boolean(
    session?.status === "recording" &&
      (recordingId === session.id ||
        recordingId.startsWith(`${session.id}_turn_`)),
  );
}

export function recordingIdsForSession(session: TrainingSession): string[] {
  return [
    ...new Set([
      session.id,
      ...(session.debate?.turns ?? []).flatMap((turn) =>
        turn.audioRecordingId ? [turn.audioRecordingId] : [],
      ),
    ]),
  ];
}

export function withoutSessionRecordings(
  session: TrainingSession,
): TrainingSession {
  return {
    ...session,
    audioFile: undefined,
    debate: session.debate
      ? {
          ...session.debate,
          turns: session.debate.turns.map(
            ({ audioFile: _audioFile, audioRecordingId: _recordingId, ...turn }) =>
              turn,
          ),
        }
      : undefined,
  };
}

export function isInteractiveMode(
  mode: PracticeMode,
): mode is "debate" | "feynman" {
  return mode === "debate" || mode === "feynman";
}

export function interactiveQuestionLabel(mode: PracticeMode): string {
  return mode === "feynman" ? "小白提问" : "反方质询";
}

export function initialDebateState(
  kind: "debate" | "feynman" = "debate",
  feynman?: {
    learnerRole: FeynmanLearnerRole;
    difficulty: FeynmanDifficulty;
  },
): DebateState {
  return {
    kind,
    phase: "opening",
    currentRound: 1,
    turns: [],
    ...(kind === "feynman"
      ? {
          feynman: {
            learnerRole: feynman?.learnerRole ?? "outsider",
            difficulty: feynman?.difficulty ?? "standard",
            checkpoints: FEYNMAN_CHECKPOINTS.map((checkpoint) => ({
              ...checkpoint,
            })),
          },
        }
      : {}),
  };
}

export function withFeynmanCheckpoints(
  state: DebateState,
  checkpoints: FeynmanCheckpoint[] | undefined,
): DebateState {
  if (!state.feynman || !checkpoints?.length) return state;
  return {
    ...state,
    feynman: {
      ...state.feynman,
      checkpoints: mergeFeynmanCheckpoints(
        state.feynman.checkpoints,
        checkpoints,
      ),
    },
  };
}

export function formatDebateTranscript(debate: DebateState): string {
  const isFeynman = debate.kind === "feynman";
  return debate.turns
    .map((turn) =>
      turn.role === "user"
        ? `第 ${turn.round} 轮，${isFeynman ? "讲解" : "我方"}：${turn.text}`
        : `第 ${turn.round} 轮，${
            isFeynman
              ? turn.text.startsWith("我已经理解")
                ? "小白确认"
                : "小白提问"
              : "反方质询"
          }：${turn.text}`,
    )
    .join("\n");
}

function completeFeynmanState(
  state: DebateState,
  focus: string,
  checkpoints?: FeynmanCheckpoint[],
): DebateState {
  return {
    ...withFeynmanCheckpoints(state, checkpoints),
    phase: "completed",
    pendingQuestion: undefined,
    turns: [
      ...state.turns,
      {
        id: `feynman_understood_${Date.now()}`,
        role: "opponent",
        round: state.currentRound,
        text: focus ? `我已经理解：${focus}` : "我已经理解这个概念了。",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}

export function shouldFinishFeynmanRound(
  session: TrainingSession,
  result: { understood: boolean },
): boolean {
  return (
    session.mode === "feynman" &&
    shouldCompleteFeynmanTurn(
      session.debate?.currentRound ?? 0,
      result.understood,
    )
  );
}

export function finishFeynmanEvaluation(
  state: DebateState,
  result: {
    understood: boolean;
    focus?: string;
    checkpoints?: FeynmanCheckpoint[];
  },
): DebateState {
  if (result.understood) {
    return completeFeynmanState(
      state,
      result.focus ?? "",
      result.checkpoints,
    );
  }
  return {
    ...withFeynmanCheckpoints(state, result.checkpoints),
    phase: "completed",
    pendingQuestion: undefined,
    turns: [
      ...state.turns,
      {
        id: `feynman_round_limit_${Date.now()}`,
        role: "opponent",
        round: state.currentRound,
        text: "本次讲解已达到 6 轮，先结束追问并进入复盘。",
        createdAt: new Date().toISOString(),
      },
    ],
  };
}
