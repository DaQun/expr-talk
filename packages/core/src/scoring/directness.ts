import type { SessionMetrics } from "@showtalk/shared";

/** 直接性：犹豫词越少越高 */
export function scoreDirectness(metrics: SessionMetrics): number {
  const hedgePenalty = Math.min(50, metrics.hedgeCount * 6);
  return Math.round(Math.max(0, 100 - hedgePenalty));
}
