import * as NodeAssert from "node:assert/strict";

import {
  MessageId,
  ProviderInstanceId,
  ThreadId,
  TurnId,
  type OrchestrationCommand,
  type OrchestrationEvent,
  type OrchestrationReadModel,
  type OrchestrationThread,
} from "@t3tools/contracts";
import * as NodeServices from "@effect/platform-node/NodeServices";
import { it as effectIt } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { makeT3Tasks } from "./T3Tasks.ts";

const thread = (input: {
  readonly id: string;
  readonly rootThreadId?: string;
  readonly parentThreadId?: string;
}): OrchestrationThread =>
  ({
    id: ThreadId.make(input.id),
    projectId: "project-1",
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

const contextWindowActivity = (id: string, usedTokens: number, maxTokens?: number) =>
  ({
    id,
    tone: "info",
    kind: "context-window.updated",
    summary: "Context window updated",
    payload: {
      usedTokens,
      ...(maxTokens === undefined ? {} : { maxTokens }),
    },
    turnId: null,
    createdAt: "2026-07-28T00:00:00.000Z",
  }) as unknown as OrchestrationThread["activities"][number];

const contextCompactionActivity = (id: string) =>
  ({
    id,
    tone: "info",
    kind: "context-compaction",
    summary: "Context compacted",
    payload: {},
    turnId: null,
    createdAt: "2026-07-28T00:00:04.000Z",
  }) as unknown as OrchestrationThread["activities"][number];

const contextHealth = (input: {
  readonly usedTokens: number | null;
  readonly maxTokens: number | null;
  readonly compacted: boolean;
  readonly reuseAllowed: boolean;
  readonly reason: "safe" | "threshold_reached" | "compacted" | "unmeasurable";
}) => ({
  ...input,
  usedPercentage:
    input.usedTokens === null || input.maxTokens === null
      ? null
      : (input.usedTokens / input.maxTokens) * 100,
});

effectIt.layer(NodeServices.layer)("T3Tasks live operations", (it) => {
  it.effect("coordinates task operations and context-health-safe reuse", () =>
    Effect.gen(function* () {
      const caller = {
        ...thread({ id: "root" }),
        projectId: "project-1",
        taskOrchestrationEnabled: false,
      } as unknown as OrchestrationThread;
      const child = {
        ...thread({ id: "child", rootThreadId: "root", parentThreadId: "root" }),
        projectId: "project-1",
        taskOrchestrationEnabled: false,
        latestTokenUsage: {
          usedTokens: 79,
          maxTokens: 100,
        },
        activities: [contextWindowActivity("context-79", 79, 100)],
        messages: [
          {
            id: MessageId.make("message-1"),
            role: "assistant" as const,
            text: "first output",
            turnId: null,
            streaming: true,
            createdAt: "2026-07-28T00:00:00.000Z",
            updatedAt: "2026-07-28T00:00:00.000Z",
          },
        ],
      } as unknown as OrchestrationThread;
      const grandchild = {
        ...thread({ id: "grandchild", rootThreadId: "root", parentThreadId: "child" }),
        taskOrchestrationEnabled: false,
        taskRelation: {
          parentThreadId: ThreadId.make("child"),
          rootThreadId: ThreadId.make("root"),
          depth: 2,
          workspaceMode: "shared" as const,
          createdBy: "agent" as const,
        },
      } as unknown as OrchestrationThread;
      const unrelated = {
        ...thread({ id: "unrelated" }),
        taskOrchestrationEnabled: true,
      } as unknown as OrchestrationThread;
      const snapshotRef = yield* Ref.make({
        snapshotSequence: 1,
        projects: [
          {
            id: "project-1",
            title: "Project",
            workspaceRoot: "/repo",
            defaultModelSelection: null,
            scripts: [],
            createdAt: "2026-07-28T00:00:00.000Z",
            updatedAt: "2026-07-28T00:00:00.000Z",
            deletedAt: null,
          },
        ],
        threads: [caller, child, grandchild, unrelated],
        updatedAt: "2026-07-28T00:00:00.000Z",
      } as unknown as OrchestrationReadModel);
      const commands = yield* Ref.make<Array<OrchestrationCommand>>([]);
      const events = yield* Queue.unbounded<OrchestrationEvent>();

      const query = {
        getSnapshot: () => Ref.get(snapshotRef),
        getThreadDetailById: (id: ThreadId) =>
          Ref.get(snapshotRef).pipe(
            Effect.map((snapshot) =>
              Option.fromUndefinedOr(snapshot.threads.find((candidate) => candidate.id === id)),
            ),
          ),
      } as unknown as ProjectionSnapshotQuery["Service"];
      const engine = {
        dispatch: (command: OrchestrationCommand) =>
          Ref.update(commands, (current) => [...current, command]).pipe(
            Effect.andThen(
              command.type === "thread.turn.start"
                ? Ref.update(snapshotRef, (snapshot) => ({
                    ...snapshot,
                    threads: snapshot.threads.map((candidate) =>
                      candidate.id === command.threadId
                        ? {
                            ...candidate,
                            latestTurn: {
                              turnId: TurnId.make("turn-started"),
                              state: "running" as const,
                              requestedAt: command.createdAt,
                              startedAt: command.createdAt,
                              completedAt: null,
                              assistantMessageId: null,
                            },
                          }
                        : candidate,
                    ),
                  }))
                : Effect.void,
            ),
            Effect.as({ sequence: 1 }),
          ),
        streamDomainEvents: Stream.fromQueue(events),
        readEvents: () => Stream.empty,
        latestSequence: Effect.succeed(1),
      } as OrchestrationEngineService["Service"];
      const providers = {
        getProviders: Effect.succeed([]),
      } as unknown as ProviderRegistry["Service"];
      const service = yield* makeT3Tasks.pipe(
        Effect.provideService(ProjectionSnapshotQuery, query),
        Effect.provideService(OrchestrationEngineService, engine),
        Effect.provideService(ProviderRegistry, providers),
        Effect.provideService(GitWorkflowService, {} as GitWorkflowService["Service"]),
      );
      const callAs = (callerThreadId: string, tool: string, args: unknown) =>
        service.execute({
          callerThreadId: ThreadId.make(callerThreadId),
          payload: {
            namespace: "t3_tasks",
            tool,
            arguments: args,
            callId: "call-1",
            threadId: "provider-thread",
            turnId: "provider-turn",
          },
        });
      const call = (tool: string, args: unknown) => callAs("root", tool, args);
      const body = (response: Awaited<Effect.Success<ReturnType<typeof call>>>) =>
        JSON.parse(
          response.contentItems[0]?.type === "inputText" ? response.contentItems[0].text : "{}",
        ) as Record<string, unknown>;

      const denied = yield* call("list", {});
      NodeAssert.equal(denied.success, false);
      NodeAssert.equal((body(denied).error as { code?: string }).code, "permission_denied");

      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "root" ? { ...candidate, taskOrchestrationEnabled: true } : candidate,
        ),
      }));
      const listed = yield* call("list", {});
      NodeAssert.equal(listed.success, true);
      const listedTasks = body(listed).tasks as Array<{ contextHealth?: unknown }>;
      NodeAssert.equal(listedTasks.length, 1);
      NodeAssert.deepStrictEqual(
        listedTasks[0]?.contextHealth,
        contextHealth({
          usedTokens: 79,
          maxTokens: 100,
          compacted: false,
          reuseAllowed: true,
          reason: "safe",
        }),
      );

      const enabled = yield* call("orchestration", {
        threadId: "child",
        enabled: true,
      });
      NodeAssert.equal(enabled.success, true);
      NodeAssert.deepStrictEqual(body(enabled), { threadId: "child", enabled: true });
      const disabled = yield* call("orchestration", {
        threadId: "child",
        enabled: false,
      });
      NodeAssert.equal(disabled.success, true);
      NodeAssert.deepStrictEqual(body(disabled), { threadId: "child", enabled: false });

      for (const threadId of ["grandchild", "unrelated"]) {
        const rejected = yield* call("orchestration", { threadId, enabled: true });
        NodeAssert.equal(rejected.success, false);
        NodeAssert.equal((body(rejected).error as { code?: string }).code, "ownership_denied");
      }
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child" ? { ...candidate, taskOrchestrationEnabled: true } : candidate,
        ),
      }));
      const rootGrandchildRead = yield* call("read", { threadId: "grandchild" });
      NodeAssert.equal(rootGrandchildRead.success, false);
      NodeAssert.equal(
        (body(rootGrandchildRead).error as { code?: string }).code,
        "ownership_denied",
      );
      const childGrandchildRead = yield* callAs("child", "read", { threadId: "grandchild" });
      NodeAssert.equal(childGrandchildRead.success, true);
      NodeAssert.equal(body(childGrandchildRead).threadId, "grandchild");
      const childGrandchildMessage = yield* callAs("child", "message", {
        threadId: "grandchild",
        message: "reuse only when safe",
      });
      NodeAssert.equal(childGrandchildMessage.success, false);
      NodeAssert.equal(
        (body(childGrandchildMessage).error as { code?: string }).code,
        "unsafe_reuse",
      );
      const invalidDepth = yield* callAs("child", "orchestration", {
        threadId: "grandchild",
        enabled: true,
      });
      NodeAssert.equal(invalidDepth.success, false);
      NodeAssert.equal((body(invalidDepth).error as { code?: string }).code, "depth_limit");

      const read = yield* call("read", { threadId: "child", cursor: 0, limit: 1 });
      NodeAssert.equal((body(read).messages as Array<unknown>).length, 1);
      NodeAssert.deepStrictEqual(
        body(read).contextHealth as unknown,
        contextHealth({
          usedTokens: 79,
          maxTokens: 100,
          compacted: false,
          reuseAllowed: true,
          reason: "safe",
        }),
      );
      NodeAssert.deepStrictEqual(
        (body(read).summary as { contextHealth?: unknown }).contextHealth,
        contextHealth({
          usedTokens: 79,
          maxTokens: 100,
          compacted: false,
          reuseAllowed: true,
          reason: "safe",
        }),
      );
      NodeAssert.equal(body(read).nextCursor, 0);
      NodeAssert.match(String(body(read).outputToken), /message-1/);
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child"
            ? {
                ...candidate,
                messages: candidate.messages.map((message) => ({
                  ...message,
                  streaming: false,
                  updatedAt: "2026-07-28T00:00:01.000Z",
                })),
              }
            : candidate,
        ),
      }));
      const completedRead = yield* call("read", { threadId: "child", cursor: 0, limit: 1 });
      NodeAssert.equal(body(completedRead).nextCursor, 1);
      NodeAssert.equal(body(completedRead).outputToken, null);

      const timedOut = yield* call("wait", {
        tasks: [{ threadId: "child", cursor: 1 }],
        timeoutSeconds: 0,
      });
      NodeAssert.equal(body(timedOut).timedOut, true);
      NodeAssert.deepStrictEqual(
        (body(timedOut).tasks as Array<{ contextHealth?: unknown }>)[0]?.contextHealth,
        contextHealth({
          usedTokens: 79,
          maxTokens: 100,
          compacted: false,
          reuseAllowed: true,
          reason: "safe",
        }),
      );

      const waiting = yield* Effect.forkChild(
        call("wait", {
          tasks: [{ threadId: "child", cursor: 1 }],
          timeoutSeconds: 2,
        }),
      );
      yield* Queue.offer(events, {
        aggregateId: ThreadId.make("child"),
      } as OrchestrationEvent);
      yield* TestClock.adjust("75 millis");
      NodeAssert.equal(waiting.pollUnsafe(), undefined);
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child"
            ? {
                ...candidate,
                messages: [
                  ...candidate.messages,
                  {
                    ...candidate.messages[0]!,
                    id: MessageId.make("message-2"),
                    text: "new output",
                    streaming: true,
                    updatedAt: "2026-07-28T00:00:02.000Z",
                  },
                ],
              }
            : candidate,
        ),
      }));
      yield* Queue.offer(events, {
        aggregateId: ThreadId.make("child"),
      } as OrchestrationEvent);
      yield* TestClock.adjust("25 millis");
      const awakened = yield* Fiber.join(waiting);
      NodeAssert.equal(body(awakened).timedOut, false);
      const awakenedTask = (
        body(awakened).tasks as Array<{
          nextCursor: number;
          outputToken: string | null;
        }>
      )[0];
      NodeAssert.equal(awakenedTask?.nextCursor, 1);
      NodeAssert.match(awakenedTask?.outputToken ?? "", /message-2/);
      const streamingWait = yield* Effect.forkChild(
        call("wait", {
          tasks: [
            {
              threadId: "child",
              cursor: 1,
              outputToken: awakenedTask?.outputToken,
            },
          ],
          timeoutSeconds: 2,
        }),
      );
      yield* Effect.yieldNow;
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child"
            ? {
                ...candidate,
                messages: candidate.messages.map((message) =>
                  message.id === "message-2"
                    ? {
                        ...message,
                        text: "new output delta",
                        updatedAt: "2026-07-28T00:00:03.000Z",
                      }
                    : message,
                ),
              }
            : candidate,
        ),
      }));
      yield* Queue.offer(events, {
        aggregateId: ThreadId.make("child"),
      } as OrchestrationEvent);
      yield* TestClock.adjust("25 millis");
      const streamed = yield* Fiber.join(streamingWait);
      NodeAssert.equal(body(streamed).timedOut, false);

      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child"
            ? {
                ...candidate,
                latestTurn: {
                  turnId: TurnId.make("active-turn"),
                  state: "running" as const,
                  requestedAt: "2026-07-28T00:00:00.000Z",
                  startedAt: "2026-07-28T00:00:00.000Z",
                  completedAt: null,
                  assistantMessageId: null,
                },
              }
            : candidate,
        ),
      }));
      const rejectedMessage = yield* call("message", {
        threadId: "child",
        message: "too soon",
      });
      NodeAssert.equal(rejectedMessage.success, false);
      NodeAssert.match((body(rejectedMessage).error as { message: string }).message, /active/);
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child" ? { ...candidate, latestTurn: null } : candidate,
        ),
      }));
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child"
            ? {
                ...candidate,
                latestTokenUsage: { usedTokens: 80, maxTokens: 100 },
                activities: [contextWindowActivity("context-80", 80, 100)],
              }
            : candidate,
        ),
      }));
      const atLimit = yield* call("message", { threadId: "child", message: "at limit" });
      NodeAssert.equal(atLimit.success, false);
      NodeAssert.equal((body(atLimit).error as { code?: string }).code, "unsafe_reuse");
      NodeAssert.deepStrictEqual(
        (
          (body(atLimit).error as { details?: { contextHealth?: unknown } }).details as {
            contextHealth?: unknown;
          }
        ).contextHealth,
        contextHealth({
          usedTokens: 80,
          maxTokens: 100,
          compacted: false,
          reuseAllowed: false,
          reason: "threshold_reached",
        }),
      );
      const unsafeList = yield* call("list", {});
      NodeAssert.deepStrictEqual(
        (body(unsafeList).tasks as Array<{ contextHealth?: unknown }>)[0]?.contextHealth,
        contextHealth({
          usedTokens: 80,
          maxTokens: 100,
          compacted: false,
          reuseAllowed: false,
          reason: "threshold_reached",
        }),
      );
      const unsafeRead = yield* call("read", { threadId: "child" });
      NodeAssert.deepStrictEqual(
        body(unsafeRead).contextHealth,
        contextHealth({
          usedTokens: 80,
          maxTokens: 100,
          compacted: false,
          reuseAllowed: false,
          reason: "threshold_reached",
        }),
      );
      const unsafeWait = yield* call("wait", {
        tasks: [{ threadId: "child" }],
        timeoutSeconds: 0,
      });
      NodeAssert.deepStrictEqual(
        (body(unsafeWait).tasks as Array<{ contextHealth?: unknown }>)[0]?.contextHealth,
        contextHealth({
          usedTokens: 80,
          maxTokens: 100,
          compacted: false,
          reuseAllowed: false,
          reason: "threshold_reached",
        }),
      );
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child"
            ? {
                ...candidate,
                latestTokenUsage: { usedTokens: 81, maxTokens: 100 },
                activities: [contextWindowActivity("context-81", 81, 100)],
              }
            : candidate,
        ),
      }));
      const aboveLimit = yield* call("message", { threadId: "child", message: "above limit" });
      NodeAssert.equal(aboveLimit.success, false);
      NodeAssert.equal((body(aboveLimit).error as { code?: string }).code, "unsafe_reuse");
      NodeAssert.equal(
        (
          body(aboveLimit).error as {
            details?: { contextHealth?: { reason?: string } };
          }
        ).details?.contextHealth?.reason,
        "threshold_reached",
      );
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child"
            ? {
                ...candidate,
                latestTokenUsage: { usedTokens: 1, maxTokens: 100 },
                activities: [
                  contextWindowActivity("context-low", 1, 100),
                  contextCompactionActivity("compaction-1"),
                ],
              }
            : candidate,
        ),
      }));
      const compacted = yield* call("message", { threadId: "child", message: "compacted" });
      NodeAssert.equal(compacted.success, false);
      NodeAssert.equal((body(compacted).error as { code?: string }).code, "unsafe_reuse");
      NodeAssert.equal(
        (
          body(compacted).error as {
            details?: { contextHealth?: { reason?: string } };
          }
        ).details?.contextHealth?.reason,
        "compacted",
      );
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child"
            ? {
                ...candidate,
                latestTokenUsage: { usedTokens: 1 },
                activities: [contextWindowActivity("context-missing", 1)],
              }
            : candidate,
        ),
      }));
      const unmeasurable = yield* call("message", {
        threadId: "child",
        message: "unmeasurable",
      });
      NodeAssert.equal(unmeasurable.success, false);
      NodeAssert.equal((body(unmeasurable).error as { code?: string }).code, "unsafe_reuse");
      NodeAssert.equal(
        (
          body(unmeasurable).error as {
            details?: { contextHealth?: { reason?: string } };
          }
        ).details?.contextHealth?.reason,
        "unmeasurable",
      );
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child"
            ? {
                ...candidate,
                latestTokenUsage: { usedTokens: 79, maxTokens: 100 },
                activities: [contextWindowActivity("context-safe-again", 79, 100)],
              }
            : candidate,
        ),
      }));
      const messaging = yield* Effect.forkChild(
        call("message", { threadId: "child", message: "follow up" }),
      );
      yield* Effect.yieldNow;
      yield* TestClock.adjust("25 millis");
      const message = yield* Fiber.join(messaging);
      NodeAssert.equal(message.success, true);
      NodeAssert.equal(body(message).turnId, "turn-started");
      NodeAssert.deepStrictEqual(
        body(message).contextHealth,
        contextHealth({
          usedTokens: 79,
          maxTokens: 100,
          compacted: false,
          reuseAllowed: true,
          reason: "safe",
        }),
      );
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child"
            ? {
                ...candidate,
                latestTokenUsage: { usedTokens: 80, maxTokens: 100 },
                activities: [contextWindowActivity("context-running-80", 80, 100)],
              }
            : candidate,
        ),
      }));
      const interruptCountBeforeCompletion = (yield* Ref.get(commands)).filter(
        (command) => command.type === "thread.turn.interrupt",
      ).length;
      NodeAssert.equal(interruptCountBeforeCompletion, 0);
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "child" && candidate.latestTurn
            ? {
                ...candidate,
                latestTurn: {
                  ...candidate.latestTurn,
                  state: "completed" as const,
                  completedAt: "2026-07-28T00:00:05.000Z",
                },
              }
            : candidate,
        ),
      }));
      const completedAfterUnsafeUsage = yield* call("list", { status: "completed" });
      NodeAssert.equal(
        (body(completedAfterUnsafeUsage).tasks as Array<{ status?: string }>)[0]?.status,
        "completed",
      );
      NodeAssert.equal(
        (yield* Ref.get(commands)).filter((command) => command.type === "thread.turn.interrupt")
          .length,
        0,
      );
      yield* call("interrupt", { threadId: "child" });
      yield* call("pin", { threadId: "child", pinned: true });
      yield* call("pin", { threadId: "child", pinned: false });
      yield* Ref.update(snapshotRef, (snapshot) => ({
        ...snapshot,
        threads: snapshot.threads.map((candidate) =>
          candidate.id === "root"
            ? {
                ...candidate,
                latestTurn: {
                  turnId: TurnId.make("root-turn"),
                  state: "running" as const,
                  requestedAt: "2026-07-28T00:00:00.000Z",
                  startedAt: "2026-07-28T00:00:00.000Z",
                  completedAt: null,
                  assistantMessageId: null,
                },
              }
            : candidate,
        ),
      }));
      const created = yield* call("create", {
        tasks: [
          {
            prompt: "Run a bounded test task.",
            workspaceMode: "shared",
            pinned: true,
          },
        ],
      });
      NodeAssert.equal(created.success, true);
      const createdTasks = body(created).tasks as Array<{
        parentThreadId: string;
        status: string;
        warning?: string;
      }>;
      NodeAssert.equal(createdTasks.length, 1);
      NodeAssert.equal(createdTasks[0]?.parentThreadId, "root");
      NodeAssert.equal(createdTasks[0]?.status, "queued");
      NodeAssert.match(createdTasks[0]?.warning ?? "", /Shared workspace/);

      const dispatched = yield* Ref.get(commands);
      NodeAssert.ok(
        dispatched.some(
          (command) =>
            command.type === "thread.task.create" &&
            command.taskRelation.rootTurnId === "root-turn",
        ),
      );
      NodeAssert.ok(dispatched.some((command) => command.type === "thread.turn.start"));
      NodeAssert.ok(dispatched.some((command) => command.type === "thread.turn.interrupt"));
      NodeAssert.ok(
        dispatched.some((command) => command.type === "thread.pin.set" && command.pinned),
      );
      NodeAssert.ok(
        dispatched.some((command) => command.type === "thread.pin.set" && !command.pinned),
      );
      NodeAssert.ok(
        dispatched.some(
          (command) =>
            command.type === "thread.task-orchestration.set" &&
            command.threadId === "child" &&
            command.enabled,
        ),
      );
      NodeAssert.ok(
        dispatched.some(
          (command) =>
            command.type === "thread.task-orchestration.set" &&
            command.threadId === "child" &&
            !command.enabled,
        ),
      );
    }),
  );
});
