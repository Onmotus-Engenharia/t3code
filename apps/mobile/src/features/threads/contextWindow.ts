import type { OrchestrationThreadShell, ProviderRateLimits } from "@t3tools/contracts";
import { selectCodexUsageWindows } from "@t3tools/shared/providerRateLimits";

export interface TaskTreeContextWindowUsage {
  readonly taskCount: number;
  readonly measuredTaskCount: number;
  readonly usedTokens: number;
  readonly totalProcessedTokens: number;
  readonly maxTokens: number | null;
  readonly usedPercentage: number | null;
}

type ThreadShellTokenUsage = Pick<
  OrchestrationThreadShell,
  "id" | "taskRelation" | "latestTokenUsage"
>;

export function deriveTaskTreeContextWindowUsage(
  rootThread: ThreadShellTokenUsage | null,
  threads: ReadonlyArray<ThreadShellTokenUsage>,
): TaskTreeContextWindowUsage | null {
  if (rootThread === null || rootThread.taskRelation !== null) return null;

  const taskTreeThreads = threads.filter(
    (thread) => thread.id === rootThread.id || thread.taskRelation?.rootThreadId === rootThread.id,
  );
  if (taskTreeThreads.length < 2) return null;

  const usages = taskTreeThreads.flatMap((thread) =>
    thread.latestTokenUsage ? [thread.latestTokenUsage] : [],
  );
  if (usages.length === 0) return null;

  const usedTokens = usages.reduce((total, usage) => total + usage.usedTokens, 0);
  const totalProcessedTokens = usages.reduce(
    (total, usage) => total + (usage.totalProcessedTokens ?? usage.usedTokens),
    0,
  );
  const allMaxTokensKnown = usages.every((usage) => usage.maxTokens !== undefined);
  const maxTokens = allMaxTokensKnown
    ? usages.reduce((total, usage) => total + (usage.maxTokens ?? 0), 0)
    : null;

  return {
    taskCount: taskTreeThreads.length,
    measuredTaskCount: usages.length,
    usedTokens,
    totalProcessedTokens,
    maxTokens,
    usedPercentage:
      maxTokens !== null && maxTokens > 0 ? Math.min(100, (usedTokens / maxTokens) * 100) : null,
  };
}

export function formatContextWindowTokens(value: number): string {
  if (!Number.isFinite(value)) return "0";
  if (value < 1_000) return `${Math.round(value)}`;
  if (value < 10_000) return `${(value / 1_000).toFixed(1).replace(/\.0$/, "")}k`;
  if (value < 1_000_000) return `${Math.round(value / 1_000)}k`;
  return `${(value / 1_000_000).toFixed(1).replace(/\.0$/, "")}m`;
}

export function formatContextUsage(usage: {
  readonly usedTokens: number;
  readonly maxTokens?: number | null;
}): string {
  const used = formatContextWindowTokens(usage.usedTokens);
  return usage.maxTokens !== undefined && usage.maxTokens !== null && usage.maxTokens > 0
    ? `${used} / ${formatContextWindowTokens(usage.maxTokens)}`
    : `${used} used`;
}

export interface ContextInfoAction {
  readonly id: string;
  readonly title: string;
  readonly subtitle: string;
}

export function buildContextInfoActions(input: {
  readonly currentUsage: NonNullable<OrchestrationThreadShell["latestTokenUsage"]>;
  readonly taskTreeUsage: TaskTreeContextWindowUsage | null;
  readonly fullDiffStat: { readonly additions: number; readonly deletions: number } | null;
  readonly codexRateLimits: ProviderRateLimits | null;
}): ContextInfoAction[] {
  const actions: ContextInfoAction[] = [
    {
      id: "context-current",
      title: "Current thread",
      subtitle: `${formatContextUsage(input.currentUsage)} · ${formatContextWindowTokens(input.currentUsage.totalProcessedTokens ?? input.currentUsage.usedTokens)} processed`,
    },
  ];
  if (input.taskTreeUsage) {
    actions.push({
      id: "context-all-tasks",
      title: `All tasks (${input.taskTreeUsage.taskCount})`,
      subtitle: `${formatContextUsage(input.taskTreeUsage)} · ${formatContextWindowTokens(input.taskTreeUsage.totalProcessedTokens)} processed`,
    });
  }
  if (input.fullDiffStat) {
    actions.push({
      id: "context-full-diff",
      title: input.taskTreeUsage ? "Full task tree" : "Full thread",
      subtitle: `+${input.fullDiffStat.additions} / -${input.fullDiffStat.deletions} lines`,
    });
  }

  const codexUsage = selectCodexUsageWindows(input.codexRateLimits);
  if (codexUsage.fiveHour) {
    actions.push({
      id: "context-codex-5h",
      title: "Codex 5h",
      subtitle: `${Math.round(Math.max(0, Math.min(100, codexUsage.fiveHour.usedPercent)))}% used`,
    });
  }
  if (codexUsage.weekly) {
    actions.push({
      id: "context-codex-weekly",
      title: "Codex weekly",
      subtitle: `${Math.round(Math.max(0, Math.min(100, codexUsage.weekly.usedPercent)))}% used`,
    });
  }
  return actions;
}
