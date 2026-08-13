import type { PracticeMode, TrainingGoal } from "./mode";
import type { SessionMetrics } from "./metrics";
import type {
  EvaluationDimensionKey,
  StructuredReport,
  TaskCheck,
  TaskCheckStatus,
} from "./report";
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
  totalChars?: number;
  fillerCount: number;
  fillerRate?: number;
  hedgeCount: number;
  hedgeRate?: number;
  vagueWordCount: number;
  vagueRate?: number;
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
    fillerRateDelta?: number;
    hedgeDelta: number;
    hedgeRateDelta?: number;
    vagueDelta: number;
    vagueRateDelta?: number;
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
  /** false 表示指标互相冲突或样本不足，不应给出二元进步结论。 */
  conclusive?: boolean;
  /** 相对成功标准的判定说明 */
  successCriteriaMet: string[];
  notes: string[];
  /** 父轮被删除后仍保留对比快照，但不再提供跳转。 */
  parentAvailable?: boolean;
};

export type DebateTurnRole = "user" | "opponent";

export type FeynmanLearnerRole =
  | "child"
  | "student"
  | "outsider"
  | "challenger";

export type FeynmanDifficulty = "gentle" | "standard" | "challenge";

export type FeynmanCheckpointId =
  | "definition"
  | "mechanism"
  | "example"
  | "boundary";

export type FeynmanCheckpointStatus =
  | "not_started"
  | "in_progress"
  | "understood";

export type FeynmanCheckpoint = {
  id: FeynmanCheckpointId;
  status: FeynmanCheckpointStatus;
  evidence?: string;
};

export const FEYNMAN_CHECKPOINT_IDS: FeynmanCheckpointId[] = [
  "definition",
  "mechanism",
  "example",
  "boundary",
];

export const FEYNMAN_CHECKPOINT_LABELS: Record<FeynmanCheckpointId, string> = {
  definition: "概念定义",
  mechanism: "原理与因果",
  example: "具体例子",
  boundary: "边界与误解",
};

export function taskCheckStatusFromCheckpoint(
  status: FeynmanCheckpointStatus,
): TaskCheckStatus {
  if (status === "understood") return "met";
  if (status === "in_progress") return "partial";
  return "missed";
}

export function taskChecksFromFeynmanCheckpoints(
  checkpoints: FeynmanCheckpoint[],
): TaskCheck[] {
  const byId = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  return FEYNMAN_CHECKPOINT_IDS.map((id) => {
    const checkpoint = byId.get(id);
    const status = checkpoint?.status ?? "not_started";
    return {
      label: FEYNMAN_CHECKPOINT_LABELS[id],
      status: taskCheckStatusFromCheckpoint(status),
      evidence: checkpoint?.evidence,
    };
  });
}

/** understood=1、进行中=0.4、未开始=0，四项平均后映射到 0–100。 */
export function scoreFromFeynmanCheckpoints(
  checkpoints: FeynmanCheckpoint[],
): number {
  const byId = new Map(checkpoints.map((checkpoint) => [checkpoint.id, checkpoint]));
  const units: number[] = FEYNMAN_CHECKPOINT_IDS.map((id) => {
    const status = byId.get(id)?.status ?? "not_started";
    if (status === "understood") return 1;
    if (status === "in_progress") return 0.4;
    return 0;
  });
  const total = units.reduce((sum, unit) => sum + unit, 0);
  return Math.round((total / FEYNMAN_CHECKPOINT_IDS.length) * 100);
}

export function feynmanScenarioSummary(checkpoints: FeynmanCheckpoint[]): {
  score: number;
  verdict: string;
  evidence: string;
} {
  const checks = taskChecksFromFeynmanCheckpoints(checkpoints);
  const met = checks.filter((check) => check.status === "met").length;
  const leftover = checks
    .filter((check) => check.status !== "met")
    .map((check) => check.label);
  const score = scoreFromFeynmanCheckpoints(checkpoints);
  const verdict =
    leftover.length === 0
      ? `四个检查点均已讲清（${met}/4）。`
      : `练习中已讲清 ${met}/4 项检查点；未完成：${leftover.join("、")}。`;
  const evidence = checks
    .map((check) => `${check.label}：${check.evidence?.trim() || "暂无摘录"}`)
    .join(" ");
  return { score, verdict, evidence };
}

export type FeynmanState = {
  learnerRole: FeynmanLearnerRole;
  difficulty: FeynmanDifficulty;
  checkpoints: FeynmanCheckpoint[];
};

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
  /** 模型这一轮回复的思考过程（reasoning）；有值才展示，无值不展示。 */
  reasoning?: string;
};

export type DebateState = {
  /** 多轮交互的角色设定；旧辩论记录未存该字段时按 debate 处理。 */
  kind?: "debate" | "feynman";
  phase: "opening" | "cross_examination" | "completed";
  currentRound: number;
  turns: DebateTurn[];
  pendingQuestion?: string;
  /** 费曼模式的学习者设定与基于对话内容的掌握检查点。 */
  feynman?: FeynmanState;
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
