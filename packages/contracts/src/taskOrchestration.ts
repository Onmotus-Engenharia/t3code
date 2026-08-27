import * as Schema from "effect/Schema";

import { CommandId, IsoDateTime, NonNegativeInt, ThreadId, TurnId } from "./baseSchemas.ts";

export const TaskWorkspaceMode = Schema.Literals(["shared", "isolated"]);
export type TaskWorkspaceMode = typeof TaskWorkspaceMode.Type;

export const TaskRelation = Schema.Struct({
  parentThreadId: ThreadId,
  rootThreadId: ThreadId,
  rootTurnId: Schema.optional(TurnId),
  depth: NonNegativeInt,
  workspaceMode: TaskWorkspaceMode,
  createdBy: Schema.Literal("agent"),
});
export type TaskRelation = typeof TaskRelation.Type;

export const ThreadTaskOrchestrationSetCommand = Schema.Struct({
  type: Schema.Literal("thread.task-orchestration.set"),
  commandId: CommandId,
  threadId: ThreadId,
  enabled: Schema.Boolean,
});
export type ThreadTaskOrchestrationSetCommand = typeof ThreadTaskOrchestrationSetCommand.Type;

export const ThreadTaskOrchestrationSetPayload = Schema.Struct({
  threadId: ThreadId,
  enabled: Schema.Boolean,
  updatedAt: IsoDateTime,
});
export type ThreadTaskOrchestrationSetPayload = typeof ThreadTaskOrchestrationSetPayload.Type;
