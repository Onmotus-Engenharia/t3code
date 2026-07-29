import type { EnvironmentId, ServerConfig, ThreadId } from "@t3tools/contracts";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";

type ThreadIdentity = {
  readonly environmentId: EnvironmentId;
  readonly threadId: ThreadId;
};

export interface ThreadOrchestrationControlModel {
  readonly showControl: boolean;
  readonly enabled: boolean;
  readonly toggleLabel: string;
  readonly parentTarget: ThreadIdentity | null;
  readonly hasStaleParent: boolean;
}

export function deriveThreadOrchestrationControlModel(input: {
  readonly thread: EnvironmentThreadShell;
  readonly threadShells: ReadonlyArray<EnvironmentThreadShell>;
  readonly serverConfig: ServerConfig | null;
  readonly pending: boolean;
}): ThreadOrchestrationControlModel {
  const provider = input.serverConfig?.providers.find(
    (candidate) => candidate.instanceId === input.thread.modelSelection.instanceId,
  );
  const showControl =
    provider?.driver === "codex" &&
    provider.enabled &&
    provider.installed &&
    provider.availability !== "unavailable";
  const relation = input.thread.taskRelation;
  const parent =
    relation === null
      ? null
      : (input.threadShells.find(
          (candidate) =>
            candidate.environmentId === input.thread.environmentId &&
            candidate.projectId === input.thread.projectId &&
            candidate.id === relation.parentThreadId,
        ) ?? null);

  return {
    showControl,
    enabled: input.thread.taskOrchestrationEnabled,
    toggleLabel: input.pending
      ? "Updating task orchestration"
      : `Tasks ${input.thread.taskOrchestrationEnabled ? "on" : "off"}`,
    parentTarget:
      parent === null
        ? null
        : {
            environmentId: parent.environmentId,
            threadId: parent.id,
          },
    hasStaleParent: relation !== null && parent === null,
  };
}
