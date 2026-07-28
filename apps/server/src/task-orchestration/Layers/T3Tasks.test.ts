import * as NodeAssert from "node:assert/strict";

import {
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationThread,
  type ServerProvider,
} from "@t3tools/contracts";
import { describe, it } from "vite-plus/test";

import {
  deriveTaskTitle,
  hasTaskWaitChange,
  ownsThread,
  resolveWorkspaceMode,
  selectOwnedTaskSummaries,
  validateCreateLimits,
  validateTaskLocation,
  validateTaskModelSelection,
} from "../domain.ts";
import { T3_TASK_DYNAMIC_TOOLS } from "../tools.ts";

const thread = (input: {
  readonly id: string;
  readonly projectId?: string;
  readonly rootThreadId?: string;
  readonly parentThreadId?: string;
}): OrchestrationThread =>
  ({
    id: ThreadId.make(input.id),
    projectId: input.projectId ?? "project-1",
    deletedAt: null,
    archivedAt: null,
    latestTurn: null,
    worktreePath: null,
    title: input.id,
    pinned: false,
    messages: [],
    modelSelection: {
      instanceId: ProviderInstanceId.make("codex"),
      model: "gpt-5.6-sol",
    },
    taskRelation: input.rootThreadId
      ? {
          parentThreadId: ThreadId.make(input.parentThreadId ?? "parent"),
          rootThreadId: ThreadId.make(input.rootThreadId),
          depth: 1,
          workspaceMode: "shared",
          createdBy: "agent",
        }
      : null,
  }) as unknown as OrchestrationThread;

describe("T3Tasks authorization and advertised limits", () => {
  it("allows only the caller and descendants of its same-project task root", () => {
    const caller = thread({ id: "child-a", rootThreadId: "root" });
    const direct = thread({
      id: "direct",
      rootThreadId: "root",
      parentThreadId: "child-a",
    });

    NodeAssert.equal(ownsThread(caller, caller), false);
    NodeAssert.equal(ownsThread(caller, direct), true);
    NodeAssert.equal(ownsThread(caller, thread({ id: "child-b", rootThreadId: "root" })), false);
    NodeAssert.equal(ownsThread(caller, thread({ id: "root" })), false);
    NodeAssert.equal(
      ownsThread(
        caller,
        thread({ id: "other-project", rootThreadId: "root", projectId: "project-2" }),
      ),
      false,
    );
    NodeAssert.equal(
      ownsThread(caller, thread({ id: "other-root", rootThreadId: "root-2" })),
      false,
    );
  });

  it("ignores unrelated task events until status or output changes", () => {
    const initial = [
      {
        threadId: ThreadId.make("child"),
        status: "running",
        terminal: false,
        outputChanged: false,
        nextCursor: 2,
        outputToken: "message-1|time-1|streaming",
      },
    ];

    NodeAssert.equal(hasTaskWaitChange(initial, initial), false);
    NodeAssert.equal(
      hasTaskWaitChange(initial, [{ ...initial[0]!, outputChanged: true, nextCursor: 3 }]),
      true,
    );
    NodeAssert.equal(
      hasTaskWaitChange(initial, [{ ...initial[0]!, status: "completed", terminal: true }]),
      true,
    );
  });

  it("treats interrupted tasks as terminal for root concurrency accounting", () => {
    const root = thread({ id: "root" });
    const interrupted = {
      ...thread({ id: "interrupted", rootThreadId: "root", parentThreadId: "root" }),
      latestTurn: {
        turnId: TurnId.make("turn-interrupted"),
        state: "interrupted",
      },
    } as unknown as OrchestrationThread;
    const active = [1, 2, 3].map((index) =>
      thread({
        id: `active-${index}`,
        rootThreadId: "root",
        parentThreadId: "root",
      }),
    );

    NodeAssert.equal(
      validateCreateLimits({
        caller: root,
        threads: [root, interrupted, ...active],
        requestedCount: 1,
      }),
      1,
    );
  });

  it("advertises the four-task batch and sixty-second wait caps", () => {
    const namespace = T3_TASK_DYNAMIC_TOOLS[0];
    NodeAssert.equal(namespace?.type, "namespace");
    if (namespace?.type !== "namespace") return;
    const create = namespace.tools.find((tool) => tool.name === "create");
    const wait = namespace.tools.find((tool) => tool.name === "wait");
    const createSchema = create?.inputSchema as
      | { properties?: { tasks?: { maxItems?: number } } }
      | undefined;
    NodeAssert.equal(createSchema?.properties?.tasks?.maxItems, 4);
    const createTaskSchema = (
      create?.inputSchema as
        | {
            properties?: {
              tasks?: {
                items?: {
                  required?: ReadonlyArray<string>;
                  properties?: Record<string, unknown>;
                };
              };
            };
          }
        | undefined
    )?.properties?.tasks?.items;
    NodeAssert.equal(createTaskSchema?.required?.includes("title"), false);
    NodeAssert.equal(createTaskSchema?.required?.includes("workspaceMode"), false);
    NodeAssert.ok(createTaskSchema?.properties?.pinned);
    const waitSchema = wait?.inputSchema as
      | { properties?: { timeoutSeconds?: { maximum?: number } } }
      | undefined;
    NodeAssert.equal(waitSchema?.properties?.timeoutSeconds?.maximum, 60);
  });

  it("rejects invalid create batches, depth-three recursion, and more than four active tasks", () => {
    const root = thread({ id: "root" });
    NodeAssert.throws(
      () => validateCreateLimits({ caller: root, threads: [root], requestedCount: 0 }),
      /one to four/,
    );
    NodeAssert.throws(
      () => validateCreateLimits({ caller: root, threads: [root], requestedCount: 5 }),
      /one to four/,
    );

    const depthTwo = {
      ...thread({ id: "depth-two", rootThreadId: "root", parentThreadId: "depth-one" }),
      taskRelation: {
        parentThreadId: ThreadId.make("depth-one"),
        rootThreadId: ThreadId.make("root"),
        depth: 2,
        workspaceMode: "shared" as const,
        createdBy: "agent" as const,
      },
    } as OrchestrationThread;
    NodeAssert.throws(
      () =>
        validateCreateLimits({
          caller: depthTwo,
          threads: [root, depthTwo],
          requestedCount: 1,
        }),
      /depth cannot exceed 2/i,
    );

    const active = [1, 2, 3].map((index) =>
      thread({
        id: `active-${index}`,
        rootThreadId: "root",
        parentThreadId: "root",
      }),
    );
    NodeAssert.throws(
      () =>
        validateCreateLimits({
          caller: root,
          threads: [root, ...active],
          requestedCount: 2,
        }),
      /limited to 4 active children/,
    );
    NodeAssert.equal(
      validateCreateLimits({
        caller: root,
        threads: [root, ...active],
        requestedCount: 1,
      }),
      1,
    );
  });

  it("derives optional titles and rejects arbitrary project/workspace overrides", () => {
    NodeAssert.equal(
      deriveTaskTitle("\n  Implement task orchestration\nDetails"),
      "Implement task orchestration",
    );
    NodeAssert.equal(deriveTaskTitle("Prompt", "Explicit title"), "Explicit title");
    NodeAssert.equal(resolveWorkspaceMode(undefined), "isolated");
    NodeAssert.equal(resolveWorkspaceMode("shared"), "shared");
    NodeAssert.doesNotThrow(() =>
      validateTaskLocation({
        callerProjectId: "project-1",
        effectiveWorkspacePath: "/repo/worktree",
        requestedProjectId: "project-1",
        requestedWorkspacePath: "/repo/worktree",
      }),
    );
    NodeAssert.throws(
      () =>
        validateTaskLocation({
          callerProjectId: "project-1",
          effectiveWorkspacePath: "/repo/worktree",
          requestedProjectId: "project-2",
        }),
      /does not match caller project/,
    );
    NodeAssert.throws(
      () =>
        validateTaskLocation({
          callerProjectId: "project-1",
          effectiveWorkspacePath: "/repo/worktree",
          requestedWorkspacePath: "/tmp/arbitrary",
        }),
      /must exactly match/,
    );
  });

  it("filters compact task summaries by status", () => {
    const caller = thread({ id: "root" });
    const idle = thread({ id: "idle", rootThreadId: "root", parentThreadId: "root" });
    const completed = {
      ...thread({ id: "completed", rootThreadId: "root", parentThreadId: "root" }),
      latestTurn: {
        turnId: "turn-1",
        state: "completed",
      },
    } as unknown as OrchestrationThread;
    const summaries = selectOwnedTaskSummaries(caller, [idle, completed], "completed");

    NodeAssert.deepStrictEqual(
      summaries.map((summary) => [summary.threadId, summary.status]),
      [["completed", "completed"]],
    );
  });
});

describe("T3Tasks provider validation", () => {
  const provider = {
    instanceId: ProviderInstanceId.make("codex"),
    models: [
      {
        slug: "gpt-5.6-sol",
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              type: "select",
              options: [{ id: "high", label: "High" }],
            },
          ],
        },
      },
      {
        slug: "gpt-5.6-terra",
        capabilities: {
          optionDescriptors: [
            {
              id: "reasoningEffort",
              type: "select",
              options: [{ id: "low", label: "Low" }],
            },
          ],
        },
      },
    ],
  } as unknown as ServerProvider;
  const selection = {
    instanceId: ProviderInstanceId.make("codex"),
    model: "gpt-5.6-sol",
  };

  it("accepts only efforts advertised by the active provider model", () => {
    NodeAssert.deepStrictEqual(
      validateTaskModelSelection([provider], selection, undefined, "high"),
      {
        ...selection,
        options: [{ id: "reasoningEffort", value: "high" }],
      },
    );
    NodeAssert.throws(
      () => validateTaskModelSelection([provider], selection, undefined, "ultra"),
      /not advertised/,
    );
  });

  it("drops inherited reasoning effort when changing model without an explicit effort", () => {
    NodeAssert.deepStrictEqual(
      validateTaskModelSelection(
        [provider],
        {
          ...selection,
          options: [
            { id: "reasoningEffort", value: "high" },
            { id: "serviceTier", value: "priority" },
          ],
        },
        "gpt-5.6-terra",
        undefined,
      ),
      {
        ...selection,
        model: "gpt-5.6-terra",
        options: [{ id: "serviceTier", value: "priority" }],
      },
    );
  });
});
