import type { PracticeMode, ScoreDimension } from "./mode";
import type { IssueCode } from "./transcript";

export type ProfileMaturity = "insufficient" | "preliminary" | "established";

export type ProfileModeAbility = {
  mode: PracticeMode;
  sessionCount: number;
  scores: Partial<Record<ScoreDimension, number>>;
};

export type RecurringProfileIssue = {
  code: IssueCode;
  title: string;
  count: number;
  sessionRate: number;
  recentCount: number;
  trend: "improving" | "stable" | "worsening";
  lastSeenAt: string;
  suggestion?: string;
};

export type ProfileTrend = {
  key: ScoreDimension | "fillerRate" | "vagueRate";
  label: string;
  baseline: number;
  recent: number;
  delta: number;
  improved: boolean;
  lowerIsBetter: boolean;
};

export type UserProfile = {
  generatedAt: string;
  maturity: ProfileMaturity;
  sessionCount: number;
  /** 所有已创建尝试，包含失败和中断。 */
  attemptCount: number;
  interruptedSessionCount: number;
  reviewedSessionCount: number;
  retryCount: number;
  retrySuccessRate?: number;
  totalDurationSec: number;
  activeDays30: number;
  modeAbilities: ProfileModeAbility[];
  recurringIssues: RecurringProfileIssue[];
  trends: ProfileTrend[];
  strength?: { dimension: ScoreDimension; label: string; score: number };
  focus?: {
    code: IssueCode;
    title: string;
    suggestion?: string;
    recommendedMode: PracticeMode;
  };
};
