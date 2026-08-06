import {
  CommandId,
  MessageId,
  ThreadId,
  type OrchestrationProject,
  type OrchestrationThread,
  type ServerProvider,
} from "@t3tools/contracts";
import { buildTemporaryWorktreeBranchName } from "@t3tools/shared/git";
import * as Crypto from "effect/Crypto";
import * as DateTime from "effect/DateTime";
import * as Effect from "effect/Effect";

import { GitWorkflowService } from "../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import {
  ToolFailure,
  deriveTaskTitle,
  object,
  optionalBoolean,
  optionalString,
  reasoningEffort,
  resolveWorkspaceMode,
  requiredString,
  taskRootId,
  taskOrchestrationEnabledForChildDepth,
  validateCreateLimits,
  validateTaskLocation,
  validateTaskModelSelection,
} from "./domain.ts";

export const executeCreate = Effect.fn("T3Tasks.executeCreate")(function* (input: {
  readonly taskValues: ReadonlyArray<unknown>;
  readonly caller: OrchestrationThread;
  readonly project: OrchestrationProject;
  readonly threads: ReadonlyArray<OrchestrationThread>;
  readonly providerSnapshots: ReadonlyArray<ServerProvider>;
  readonly engine: OrchestrationEngineService["Service"];
  readonly git: GitWorkflowService["Service"];
  readonly crypto: Crypto.Crypto;
}) {
  const childDepth = validateCreateLimits({
    caller: input.caller,
    threads: input.threads,
    requestedCount: input.taskValues.length,
  });

  const commandId = input.crypto.randomUUIDv4.pipe(Effect.map(CommandId.make));
  const messageId = input.crypto.randomUUIDv4.pipe(Effect.map(MessageId.make));
  const threadId = input.crypto.randomUUIDv4.pipe(Effect.map(ThreadId.make));
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));
  const dispatchTurn = Effect.fn("T3Tasks.dispatchCreatedTurn")(function* (
    thread: OrchestrationThread,
    text: string,
  ) {
    yield* input.engine.dispatch({
      type: "thread.turn.start",
      commandId: yield* commandId,
      threadId: thread.id,
      message: {
        messageId: yield* messageId,
        role: "user",
        text,
        attachments: [],
      },
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt: yield* nowIso,
    });
  });

  const created: Array<Record<string, unknown>> = [];
  for (const rawTask of input.taskValues) {
    const task = object(rawTask);
    const prompt = requiredString(task, "prompt");
    const title = deriveTaskTitle(prompt, optionalString(task, "title"));
    const parentCwd = input.caller.worktreePath ?? input.project.workspaceRoot;
    const requestedProjectId = optionalString(task, "projectId");
    const requestedWorkspacePath = optionalString(task, "workspacePath");
    validateTaskLocation({
      callerProjectId: input.caller.projectId,
      effectiveWorkspacePath: parentCwd,
      ...(requestedProjectId ? { requestedProjectId } : {}),
      ...(requestedWorkspacePath ? { requestedWorkspacePath } : {}),
    });
    const workspaceMode = resolveWorkspaceMode(optionalString(task, "workspaceMode"));
    const pinned = optionalBoolean(task, "pinned") ?? false;
    const rootTurnId = input.caller.taskRelation?.rootTurnId ?? input.caller.latestTurn?.turnId;
    const modelSelection = validateTaskModelSelection(
      input.providerSnapshots,
      input.caller.modelSelection,
      optionalString(task, "model"),
      optionalString(task, "reasoningEffort"),
    );
    const childThreadId = yield* threadId;
    let branch = input.caller.branch;
    let worktreePath = input.caller.worktreePath;
    let isolatedWorktree: { readonly path: string; readonly refName: string } | undefined;
    if (workspaceMode === "isolated") {
      const temporaryBranch = buildTemporaryWorktreeBranchName(() =>
        childThreadId.replaceAll("-", ""),
      );
      const result = yield* input.git
        .createWorktree({
          cwd: parentCwd,
          refName: "HEAD",
          newRefName: temporaryBranch,
          path: null,
        })
        .pipe(
          Effect.mapError(
            (cause) =>
              new ToolFailure(
                "workspace_isolation_failed",
                `Could not create an isolated Git worktree: ${cause.message}`,
              ),
          ),
        );
      isolatedWorktree = result.worktree;
      branch = result.worktree.refName;
      worktreePath = result.worktree.path;
    }
    const createdAt = yield* nowIso;
    const child: OrchestrationThread = {
      ...input.caller,
      id: childThreadId,
      projectId: input.caller.projectId,
      title,
      modelSelection,
      branch,
      worktreePath,
      latestTurn: null,
      createdAt,
      updatedAt: createdAt,
      archivedAt: null,
      taskOrchestrationEnabled: taskOrchestrationEnabledForChildDepth(childDepth),
      taskRelation: {
        parentThreadId: input.caller.id,
        rootThreadId: taskRootId(input.caller),
        ...(rootTurnId !== undefined ? { rootTurnId } : {}),
        depth: childDepth,
        workspaceMode,
        createdBy: "agent",
      },
      pinned,
      deletedAt: null,
      messages: [],
      proposedPlans: [],
      activities: [],
      checkpoints: [],
      session: null,
    };
    const createCommandId = yield* commandId;
    const pinCommandId = pinned ? yield* commandId : undefined;
    const cleanupCommandId = yield* commandId;
    yield* input.engine
      .dispatch({
        type: "thread.task.create",
        commandId: createCommandId,
        threadId: childThreadId,
        projectId: input.caller.projectId,
        title,
        modelSelection,
        runtimeMode: input.caller.runtimeMode,
        interactionMode: input.caller.interactionMode,
        branch,
        worktreePath,
        taskRelation: child.taskRelation!,
        createdAt,
      })
      .pipe(
        Effect.andThen(
          pinned
            ? input.engine.dispatch({
                type: "thread.pin.set",
                commandId: pinCommandId!,
                threadId: childThreadId,
                pinned: true,
              })
            : Effect.void,
        ),
        Effect.andThen(dispatchTurn(child, prompt)),
        Effect.onError(() =>
          input.engine
            .dispatch({
              type: "thread.delete",
              commandId: cleanupCommandId,
              threadId: childThreadId,
            })
            .pipe(
              Effect.ignore,
              Effect.andThen(
                isolatedWorktree
                  ? input.git
                      .removeWorktree({
                        cwd: parentCwd,
                        path: isolatedWorktree.path,
                        force: true,
                      })
                      .pipe(Effect.ignore)
                  : Effect.void,
              ),
            ),
        ),
      );
    created.push({
      threadId: childThreadId,
      title,
      parentThreadId: input.caller.id,
      rootThreadId: taskRootId(input.caller),
      depth: childDepth,
      workspaceMode,
      status: "queued",
      model: modelSelection.model,
      reasoningEffort: reasoningEffort(child),
      pinned,
      runtimeThreadId: null,
      providerThreadId: null,
      ...(workspaceMode === "shared"
        ? {
            warning:
              "Shared workspace: concurrent agents can write the same checkout. Coordinate edits to avoid conflicts.",
          }
        : {}),
    });
  }
  return { tasks: created };
});
