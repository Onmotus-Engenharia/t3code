import { ThreadTokenUsageSnapshot, type OrchestrationThread } from "@t3tools/contracts";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

const CONTEXT_REUSE_THRESHOLD_PERCENTAGE = 80;
const decodeTokenUsage = Schema.decodeUnknownOption(ThreadTokenUsageSnapshot);

export type TaskContextHealthReason = "safe" | "threshold_reached" | "compacted" | "unmeasurable";

export interface TaskContextHealth {
  readonly usedTokens: number | null;
  readonly maxTokens: number | null;
  readonly usedPercentage: number | null;
  readonly compacted: boolean;
  readonly reuseAllowed: boolean;
  readonly reason: TaskContextHealthReason;
}

/**
 * Derives task reuse safety from persisted projection activities. The backward
 * walk matches the client context-window convention and skips invalid rows.
 */
export const deriveTaskContextHealth = (thread: OrchestrationThread): TaskContextHealth => {
  const activities = thread.activities ?? [];
  const compacted = activities.some((activity) => activity.kind === "context-compaction");
  let latestUsage: ThreadTokenUsageSnapshot | null = null;

  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index];
    if (activity?.kind !== "context-window.updated") continue;
    const usage = Option.getOrNull(decodeTokenUsage(activity.payload));
    if (usage !== null) {
      latestUsage = usage;
      break;
    }
  }

  const usedTokens = latestUsage?.usedTokens ?? null;
  const maxTokens = latestUsage?.maxTokens ?? null;
  const usedPercentage =
    usedTokens !== null && maxTokens !== null
      ? Math.min(100, (usedTokens / maxTokens) * 100)
      : null;
  const reason: TaskContextHealthReason = compacted
    ? "compacted"
    : usedPercentage !== null && usedPercentage >= CONTEXT_REUSE_THRESHOLD_PERCENTAGE
      ? "threshold_reached"
      : usedPercentage === null
        ? "unmeasurable"
        : "safe";

  return {
    usedTokens,
    maxTokens,
    usedPercentage,
    compacted,
    reuseAllowed: reason === "safe",
    reason,
  };
};
