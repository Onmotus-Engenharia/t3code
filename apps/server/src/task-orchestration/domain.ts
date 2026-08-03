import {
  ThreadId,
  type ModelSelection,
  type OrchestrationThread,
  type ServerProvider,
  type TaskWorkspaceMode,
} from "@t3tools/contracts";

import { deriveTaskContextHealth, type TaskContextHealth } from "./contextHealth.ts";

export type ToolErrorCode =
  | "invalid_arguments"
  | "permission_denied"
  | "not_found"
  | "ownership_denied"
  | "depth_limit"
  | "active_child_limit"
  | "model_unavailable"
  | "reasoning_effort_unavailable"
  | "workspace_isolation_failed"
  | "unsafe_reuse"
  | "orchestration_failed";

export class ToolFailure extends Error {
  readonly code: ToolErrorCode;
  override readonly message: string;
  readonly details: unknown;

  constructor(code: ToolErrorCode, message: string, details?: unknown) {
    super(message);
    this.code = code;
    this.message = message;
    this.details = details;
  }
}

export const fail = (code: ToolErrorCode, message: string, details?: unknown): never => {
  throw new ToolFailure(code, message, details);
};

export const object = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : fail("invalid_arguments", "Tool arguments must be an object.");

export const requiredString = (input: Record<string, unknown>, key: string): string => {
  const value = input[key];
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fail("invalid_arguments", `'${key}' must be a non-empty string.`);
};

export const optionalString = (input: Record<string, unknown>, key: string): string | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : fail("invalid_arguments", `'${key}' must be a non-empty string when supplied.`);
};

export const optionalBoolean = (
  input: Record<string, unknown>,
  key: string,
): boolean | undefined => {
  const value = input[key];
  if (value === undefined) return undefined;
  return typeof value === "boolean"
    ? value
    : fail("invalid_arguments", `'${key}' must be a boolean when supplied.`);
};

export const resolveWorkspaceMode = (requested: string | undefined): TaskWorkspaceMode => {
  const mode = requested ?? "isolated";
  return mode === "shared" || mode === "isolated"
    ? mode
    : fail("invalid_arguments", "'workspaceMode' must be 'shared' or 'isolated'.");
};

export const jsonResponse = (success: boolean, body: unknown) => ({
  success,
  contentItems: [{ type: "inputText" as const, text: JSON.stringify(body) }],
});

export const threadStatus = (thread: OrchestrationThread) => {
  if (thread.deletedAt !== null) return "deleted";
  if (thread.archivedAt !== null) return "archived";
  if (thread.latestTurn === null) return "idle";
  return thread.latestTurn.state;
};

export const isTerminal = (thread: OrchestrationThread) => {
  const status = threadStatus(thread);
  return (
    status === "completed" ||
    status === "error" ||
    status === "interrupted" ||
    status === "deleted" ||
    status === "archived"
  );
};

export const taskRootId = (thread: OrchestrationThread): ThreadId =>
  thread.taskRelation?.rootThreadId ?? thread.id;

export const createLimitForCaller = (caller: OrchestrationThread): number =>
  caller.taskRelation === null ? 10 : 4;

export const ownsThread = (caller: OrchestrationThread, target: OrchestrationThread): boolean =>
  target.taskRelation !== null &&
  target.taskRelation.parentThreadId === caller.id &&
  target.projectId === caller.projectId;

export const validateCreateLimits = (input: {
  readonly caller: OrchestrationThread;
  readonly threads: ReadonlyArray<OrchestrationThread>;
  readonly requestedCount: number;
}): number => {
  const childDepth = (input.caller.taskRelation?.depth ?? 0) + 1;
  if (childDepth > 2) {
    return fail("depth_limit", "Task depth cannot exceed 2.");
  }
  const activeChildLimit = createLimitForCaller(input.caller);
  if (input.requestedCount < 1 || input.requestedCount > activeChildLimit) {
    return fail(
      "invalid_arguments",
      `'tasks' must contain one to ${activeChildLimit} task definitions for this caller.`,
    );
  }
  const activeChildren = input.threads.filter(
    (thread) =>
      ownsThread(input.caller, thread) &&
      thread.deletedAt === null &&
      thread.archivedAt === null &&
      !isTerminal(thread),
  ).length;
  if (activeChildren + input.requestedCount > activeChildLimit) {
    const callerLabel = input.caller.taskRelation === null ? "Root orchestrator" : "Child task";
    return fail(
      "active_child_limit",
      `${callerLabel} is limited to ${activeChildLimit} active direct children.`,
    );
  }
  return childDepth;
};

export interface TaskWaitState {
  readonly threadId: ThreadId;
  readonly status: string;
  readonly terminal: boolean;
  readonly outputChanged: boolean;
  readonly nextCursor: number;
  readonly outputToken: string | null;
}

export const taskOutputToken = (thread: OrchestrationThread, cursor: number): string | null => {
  const message = thread.messages[cursor];
  return message
    ? `${message.id}|${message.updatedAt}|${message.streaming ? "streaming" : "complete"}`
    : null;
};

export const hasTaskWaitChange = (
  initial: ReadonlyArray<TaskWaitState>,
  current: ReadonlyArray<TaskWaitState>,
): boolean =>
  current.some((state) => {
    const previous = initial.find((candidate) => candidate.threadId === state.threadId);
    return (
      previous === undefined ||
      state.status !== previous.status ||
      state.nextCursor > previous.nextCursor ||
      state.outputToken !== previous.outputToken ||
      (!previous.outputChanged && state.outputChanged) ||
      (!previous.terminal && state.terminal)
    );
  });

export const reasoningEffort = (thread: OrchestrationThread): string | null => {
  const selection = thread.modelSelection.options?.find(
    (candidate) => candidate.id === "reasoningEffort",
  );
  return typeof selection?.value === "string" ? selection.value : null;
};

export const taskSummary = (
  thread: OrchestrationThread,
  contextHealth: TaskContextHealth = deriveTaskContextHealth(thread),
) => ({
  threadId: thread.id,
  parentThreadId: thread.taskRelation?.parentThreadId ?? null,
  depth: thread.taskRelation?.depth ?? 0,
  workspaceMode: thread.taskRelation?.workspaceMode ?? null,
  worktreePath: thread.worktreePath,
  title: thread.title,
  status: threadStatus(thread),
  model: thread.modelSelection.model,
  reasoningEffort: reasoningEffort(thread),
  pinned: thread.pinned,
  contextHealth,
});

export const deriveTaskTitle = (prompt: string, requestedTitle?: string): string =>
  requestedTitle?.trim().slice(0, 160) ||
  prompt
    .split(/\r?\n/)
    .map((line) => line.trim())
    .find((line) => line.length > 0)
    ?.slice(0, 160) ||
  "Task";

export const validateTaskLocation = (input: {
  readonly callerProjectId: string;
  readonly effectiveWorkspacePath: string;
  readonly requestedProjectId?: string;
  readonly requestedWorkspacePath?: string;
}): void => {
  if (
    input.requestedProjectId !== undefined &&
    input.requestedProjectId !== input.callerProjectId
  ) {
    fail(
      "ownership_denied",
      `Task project '${input.requestedProjectId}' does not match caller project '${input.callerProjectId}'.`,
    );
  }
  if (
    input.requestedWorkspacePath !== undefined &&
    input.requestedWorkspacePath !== input.effectiveWorkspacePath
  ) {
    fail(
      "ownership_denied",
      `Task workspace must exactly match the caller's effective checkout '${input.effectiveWorkspacePath}'.`,
    );
  }
};

export const selectOwnedTaskSummaries = (
  caller: OrchestrationThread,
  threads: ReadonlyArray<OrchestrationThread>,
  status?: string,
) =>
  threads
    .filter(
      (thread) =>
        ownsThread(caller, thread) &&
        thread.deletedAt === null &&
        (status === undefined || threadStatus(thread) === status),
    )
    .map((thread) => taskSummary(thread));

export const validateTaskModelSelection = (
  providers: ReadonlyArray<ServerProvider>,
  parentSelection: ModelSelection,
  model: string | undefined,
  effort: string | undefined,
): ModelSelection => {
  if (model === undefined && effort === undefined) return parentSelection;
  const provider = providers.find(
    (candidate) => candidate.instanceId === parentSelection.instanceId,
  );
  const selectedModel = provider?.models.find(
    (candidate) => candidate.slug === (model ?? parentSelection.model),
  );
  if (!provider || !selectedModel) {
    return fail(
      "model_unavailable",
      `Model '${model ?? parentSelection.model}' is not advertised by active provider instance '${parentSelection.instanceId}'.`,
    );
  }
  if (effort === undefined) {
    return {
      ...parentSelection,
      model: selectedModel.slug,
      ...(model !== undefined && model !== parentSelection.model
        ? {
            options: (parentSelection.options ?? []).filter(
              (selection) => selection.id !== "reasoningEffort",
            ),
          }
        : {}),
    };
  }
  const descriptor = selectedModel.capabilities?.optionDescriptors?.find(
    (candidate) => candidate.id === "reasoningEffort" && candidate.type === "select",
  );
  if (descriptor?.type !== "select" || !descriptor.options.some((choice) => choice.id === effort)) {
    return fail(
      "reasoning_effort_unavailable",
      `Reasoning effort '${effort}' is not advertised for model '${selectedModel.slug}'.`,
    );
  }
  return {
    ...parentSelection,
    model: selectedModel.slug,
    options: [
      ...(parentSelection.options ?? []).filter((selection) => selection.id !== "reasoningEffort"),
      { id: "reasoningEffort", value: effort },
    ],
  };
};
