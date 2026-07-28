import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  CommandId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type OrchestrationReadModel,
  type ThreadTaskCreateCommand,
} from "@t3tools/contracts";
import { expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";

import { decideOrchestrationCommand } from "./decider.ts";

const now = "2026-07-28T12:00:00.000Z";
const projectId = ProjectId.make("project-1");
const parentThreadId = ThreadId.make("parent");
const childThreadId = ThreadId.make("child");
const modelSelection = {
  instanceId: ProviderInstanceId.make("codex"),
  model: "gpt-5.4",
};

function makeReadModel(taskOrchestrationEnabled: boolean): OrchestrationReadModel {
  return {
    snapshotSequence: 1,
    projects: [
      {
        id: projectId,
        title: "Project",
        workspaceRoot: "/tmp/project",
        defaultModelSelection: modelSelection,
        scripts: [],
        createdAt: now,
        updatedAt: now,
        deletedAt: null,
      },
    ],
    threads: [
      {
        id: parentThreadId,
        projectId,
        title: "Parent",
        modelSelection,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        latestTurn: null,
        createdAt: now,
        updatedAt: now,
        archivedAt: null,
        settledOverride: null,
        settledAt: null,
        taskOrchestrationEnabled,
        taskRelation: null,
        pinned: false,
        deletedAt: null,
        messages: [],
        proposedPlans: [],
        activities: [],
        checkpoints: [],
        session: null,
      },
    ],
    updatedAt: now,
  };
}

function taskCreate(
  relation: ThreadTaskCreateCommand["taskRelation"] = {
    parentThreadId,
    rootThreadId: parentThreadId,
    depth: 1,
    workspaceMode: "shared",
    createdBy: "agent",
  },
): ThreadTaskCreateCommand {
  return {
    type: "thread.task.create",
    commandId: CommandId.make("cmd-task"),
    threadId: childThreadId,
    projectId,
    title: "Child",
    modelSelection,
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    taskRelation: relation,
    createdAt: now,
  };
}

it.layer(NodeServices.layer)("task orchestration decider", (it) => {
  it.effect("enables task orchestration for new user threads by default", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: {
          type: "thread.create",
          commandId: CommandId.make("cmd-thread"),
          threadId: ThreadId.make("thread"),
          projectId,
          title: "Thread",
          modelSelection,
          runtimeMode: "full-access",
          interactionMode: "default",
          branch: null,
          worktreePath: null,
          createdAt: now,
        },
        readModel: makeReadModel(false),
      });
      expect(Array.isArray(event)).toBe(false);
      if (!("type" in event) || event.type !== "thread.created") {
        return yield* Effect.die("Expected one thread.created event");
      }
      expect(event.payload.taskOrchestrationEnabled).toBe(true);
    }),
  );

  it.effect("creates an agent-owned child with permission and safe child defaults", () =>
    Effect.gen(function* () {
      const event = yield* decideOrchestrationCommand({
        command: taskCreate(),
        readModel: makeReadModel(true),
      });
      expect(Array.isArray(event)).toBe(false);
      if (!("type" in event) || event.type !== "thread.created") {
        return yield* Effect.die("Expected one thread.created event");
      }
      expect(event.payload).toMatchObject({
        taskRelation: taskCreate().taskRelation,
        taskOrchestrationEnabled: false,
        pinned: false,
      });
    }),
  );

  it.effect("rejects child creation when the parent did not grant permission", () =>
    Effect.gen(function* () {
      const exit = yield* Effect.exit(
        decideOrchestrationCommand({
          command: taskCreate(),
          readModel: makeReadModel(false),
        }),
      );
      expect(exit._tag).toBe("Failure");
    }),
  );

  it.effect("rejects forged root and depth relationships", () =>
    Effect.gen(function* () {
      const wrongDepth = yield* Effect.exit(
        decideOrchestrationCommand({
          command: taskCreate({
            ...taskCreate().taskRelation,
            depth: 2,
          }),
          readModel: makeReadModel(true),
        }),
      );
      expect(wrongDepth._tag).toBe("Failure");

      const wrongRoot = yield* Effect.exit(
        decideOrchestrationCommand({
          command: taskCreate({
            ...taskCreate().taskRelation,
            rootThreadId: ThreadId.make("other-root"),
          }),
          readModel: makeReadModel(true),
        }),
      );
      expect(wrongRoot._tag).toBe("Failure");
    }),
  );
});
