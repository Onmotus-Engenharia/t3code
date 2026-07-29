import type {
  OrchestrationCheckpointFile,
  OrchestrationCheckpointFileSource,
  TaskRelation,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";

interface TaskCheckpoint {
  readonly checkpointTurnCount: number;
  readonly status: "ready" | "missing" | "error";
}

interface TaskThread {
  readonly id: ThreadId;
  readonly taskRelation: TaskRelation | null;
  readonly checkpoints: ReadonlyArray<TaskCheckpoint>;
}

function sourceKey(source: OrchestrationCheckpointFileSource): string {
  return `${source.threadId}:${source.fromTurnCount}:${source.toTurnCount}`;
}

export function selectOrchestratedCheckpointSources(input: {
  readonly rootThreadId: ThreadId;
  readonly rootTurnId: TurnId;
  readonly threads: ReadonlyArray<TaskThread>;
}): ReadonlyArray<OrchestrationCheckpointFileSource> {
  return input.threads.flatMap((thread) => {
    const relation = thread.taskRelation;
    if (
      relation === null ||
      relation.rootThreadId !== input.rootThreadId ||
      relation.rootTurnId !== input.rootTurnId ||
      relation.workspaceMode !== "isolated"
    ) {
      return [];
    }

    const latest = thread.checkpoints
      .filter((checkpoint) => checkpoint.status !== "missing")
      .toSorted((left, right) => right.checkpointTurnCount - left.checkpointTurnCount)[0];
    return latest === undefined
      ? []
      : [
          {
            threadId: thread.id,
            fromTurnCount: 0,
            toTurnCount: latest.checkpointTurnCount,
          },
        ];
  });
}

export function mergeCheckpointFiles(
  groups: ReadonlyArray<ReadonlyArray<OrchestrationCheckpointFile>>,
): OrchestrationCheckpointFile[] {
  const byPath = new Map<string, OrchestrationCheckpointFile>();
  for (const files of groups) {
    for (const file of files) {
      const current = byPath.get(file.path);
      if (current === undefined) {
        byPath.set(file.path, {
          ...file,
          ...(file.sources === undefined ? {} : { sources: [...file.sources] }),
        });
        continue;
      }

      const sources = new Map(
        [...(current.sources ?? []), ...(file.sources ?? [])].map((source) => [
          sourceKey(source),
          source,
        ]),
      );
      byPath.set(file.path, {
        ...current,
        additions: current.additions + file.additions,
        deletions: current.deletions + file.deletions,
        ...(sources.size === 0 ? {} : { sources: [...sources.values()] }),
      });
    }
  }
  return [...byPath.values()].toSorted((left, right) => left.path.localeCompare(right.path));
}

export function checkpointFileSources(
  files: ReadonlyArray<OrchestrationCheckpointFile>,
): ReadonlyArray<OrchestrationCheckpointFileSource> {
  return [
    ...new Map(
      files.flatMap((file) =>
        (file.sources ?? []).map((source) => [sourceKey(source), source] as const),
      ),
    ).values(),
  ];
}

export function joinCheckpointDiffs(diffs: ReadonlyArray<string>): string {
  return diffs
    .map((diff) => diff.trimEnd())
    .filter((diff) => diff.length > 0)
    .join("\n");
}
