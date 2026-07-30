import type { PracticeMode, TrainingGoal } from "./mode";
import type { SessionMetrics } from "./metrics";
import type { EvaluationDimensionKey, StructuredReport } from "./report";
import type { IssueCode, TranscriptSegment } from "./transcript";

export type SessionStatus =
  | "created"
  | "recording"
  | "transcribing"
  | "analyzing"
  | "debating"
  | "failed"
  | "reviewed"
  | "retrying"
  | "completed";

export type MetricSnapshot = {
  fillerCount: number;
  hedgeCount: number;
  vagueWordCount: number;
  densityScore: number;
  wordsPerMinute?: number;
  clarity?: number;
  directness?: number;
  dimensionScores?: Partial<Record<EvaluationDimensionKey, number>>;
  durationSec?: number;
};

export type AttemptComparison = {
  parentSessionId: string;
  round: number;
  targetIssue?: IssueCode | string;
  before: MetricSnapshot;
  after: MetricSnapshot;
  /** after - before；填充词/犹豫词负向变好，密度/清晰度正向变好 */
  deltas: {
    fillerDelta: number;
    hedgeDelta: number;
    vagueDelta: number;
    densityDelta: number;
    wpmDelta?: number;
    clarityDelta?: number;
    directnessDelta?: number;
    targetDimension?: EvaluationDimensionKey;
    targetDimensionDelta?: number;
  };
  /** 兼容旧字段 */
  fillerDelta: number;
  wpmDelta?: number;
  densityDelta: number;
  improved: boolean;
  /** 相对成功标准的判定说明 */
  successCriteriaMet: string[];
  notes: string[];
};

export type DebateTurnRole = "user" | "opponent";

export type DebateTurn = {
  id: string;
  role: DebateTurnRole;
  round: number;
  text: string;
  createdAt: string;
  source?: "audio" | "paste";
  durationSec?: number;
  /** 该轮口述录音；粘贴文字和模型提问没有此素材。 */
  audioFile?: string;
  /** 用于删除该轮独立 WAV 的录音标识。 */
  audioRecordingId?: string;
};

export type DebateState = {
  /** 多轮交互的角色设定；旧辩论记录未存该字段时按 debate 处理。 */
  kind?: "debate" | "feynman";
  phase: "opening" | "cross_examination" | "completed";
  currentRound: number;
  turns: DebateTurn[];
  pendingQuestion?: string;
};

export type TrainingSession = {
  id: string;
  mode: PracticeMode;
  topic: string;
  goal: TrainingGoal | string;
  status: SessionStatus;
  startedAt: string;
  endedAt?: string;
  durationSec?: number;
  inputSource?: "audio" | "paste" | "mixed";
  audioFile?: string;
  liveTranscript: TranscriptSegment[];
  finalTranscript?: string;
  metrics?: SessionMetrics;
  report?: StructuredReport;
  /** 若本 session 是复练，指向父 session */
  parentSessionId?: string;
  round?: number;
  /** 复练目标问题（来自父报告 nextPractice） */
  targetIssue?: IssueCode | string;
  /** 与父轮对比结果 */
  comparison?: AttemptComparison;
  /** 最近一次处理失败的原因，供历史记录和重试页面展示 */
  failureReason?: string;
  /** 辩论或费曼学习法的多轮对话上下文。 */
  debate?: DebateState;
};

export type CreateSessionInput = {
  mode: PracticeMode;
  topic: string;
  goal: TrainingGoal | string;
  parentSessionId?: string;
  round?: number;
  targetIssue?: IssueCode | string;
};

export type PracticeAttempt = {
  id: string;
  parentSessionId: string;
  round: number;
  targetIssue?: string;
  transcript?: string;
  metrics?: SessionMetrics;
  comparison?: AttemptComparison;
  createdAt: string;
};
