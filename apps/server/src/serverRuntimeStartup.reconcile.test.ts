import * as NodeServices from "@effect/platform-node/NodeServices";
import {
  type OrchestrationThread,
  type OrchestrationCommand,
  ProviderDriverKind,
  ProviderInstanceId,
  ThreadId,
  TurnId,
} from "@t3tools/contracts";
import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Duration from "effect/Duration";
import * as DateTime from "effect/DateTime";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import * as TestClock from "effect/testing/TestClock";

import { OrchestrationCommandInvariantError } from "./orchestration/Errors.ts";
import * as OrchestrationEngine from "./orchestration/Services/OrchestrationEngine.ts";
import * as ProjectionSnapshotQuery from "./orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderSessionDirectoryPersistenceError } from "./provider/Errors.ts";
import * as ProviderService from "./provider/Services/ProviderService.ts";
import * as ProviderSessionDirectory from "./provider/Services/ProviderSessionDirectory.ts";
import * as ServerRuntimeStartup from "./serverRuntimeStartup.ts";
import * as ServerSettings from "./serverSettings.ts";

const providerInstanceId = ProviderInstanceId.make("codex");
const updatedAt = "2026-08-20T12:00:00.000Z";

const makeThread = (
  id: string,
  status: "starting" | "running" | "ready" | "stopped" | "error",
  activeTurnId: TurnId | null = null,
  archivedAt: string | null = null,
  overrides?: {
    readonly deletedAt?: string | null;
    readonly settledOverride?: "settled" | "active" | null;
    readonly snoozedUntil?: string | null;
    readonly taskRelation?: unknown;
  },
) => ({
  id: ThreadId.make(id),
  archivedAt,
  deletedAt: overrides?.deletedAt ?? null,
  settledOverride: overrides?.settledOverride ?? null,
  snoozedUntil: overrides?.snoozedUntil ?? null,
  taskRelation: overrides?.taskRelation ?? null,
  modelSelection: { instanceId: providerInstanceId, model: "gpt-5" },
  runtimeMode: "full-access" as const,
  interactionMode: "default" as const,
  session: {
    threadId: ThreadId.make(id),
    status,
    providerName: "codex" as const,
    providerInstanceId,
    runtimeMode: "full-access" as const,
    activeTurnId,
    lastError: null,
    updatedAt,
  },
});

const makeProviderService = (liveThreadIds: ReadonlyArray<ThreadId> = []) =>
  ({
    startSession: () => Effect.die("unused"),
    sendTurn: () => Effect.die("unused"),
    interruptTurn: () => Effect.die("unused"),
    respondToRequest: () => Effect.die("unused"),
    respondToUserInput: () => Effect.die("unused"),
    stopSession: () => Effect.die("unused"),
    listSessions: () => Effect.succeed(liveThreadIds.map((threadId) => ({ threadId }) as never)),
    getCapabilities: () => Effect.die("unused"),
    getInstanceInfo: () => Effect.die("unused"),
    rollbackConversation: () => Effect.die("unused"),
    uploadFeedback: () => Effect.die("unused"),
    streamEvents: Stream.empty,
  }) satisfies ProviderService.ProviderService["Service"];

const runReconciliation = (input: {
  readonly threads: ReadonlyArray<ReturnType<typeof makeThread>>;
  readonly liveThreadIds?: ReadonlyArray<ThreadId>;
  readonly directory: ProviderSessionDirectory.ProviderSessionDirectory["Service"];
  readonly dispatch: OrchestrationEngine.OrchestrationEngineService["Service"]["dispatch"];
  readonly settings?: Parameters<typeof ServerSettings.layerTest>[0];
  readonly getThreads?: () => ReadonlyArray<OrchestrationThread>;
}) =>
  ServerRuntimeStartup.reconcileProviderSessions.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
          getCommandReadModel: () =>
            Effect.succeed({ threads: input.getThreads?.() ?? input.threads } as never),
        } as unknown as ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]),
        Layer.succeed(ProviderService.ProviderService, makeProviderService(input.liveThreadIds)),
        Layer.succeed(ProviderSessionDirectory.ProviderSessionDirectory, input.directory),
        Layer.succeed(OrchestrationEngine.OrchestrationEngineService, {
          readEvents: () => Stream.empty,
          dispatch: input.dispatch,
          streamDomainEvents: Stream.empty,
          latestSequence: Effect.succeed(0),
        }),
        ServerSettings.layerTest({ automaticContinuationEnabled: false, ...input.settings }),
        NodeServices.layer,
      ),
    ),
  );

it.effect("reconciles multiple active and archived orphans but skips live sessions", () => {
  const starting = makeThread("thread-starting", "starting");
  const running = makeThread("thread-running", "running", TurnId.make("turn-running"));
  const staleActiveTurn = makeThread(
    "thread-stale-active-turn",
    "ready",
    TurnId.make("turn-stale-active"),
  );
  const archived = makeThread(
    "thread-archived",
    "running",
    TurnId.make("turn-archived"),
    updatedAt,
  );
  const live = makeThread("thread-live", "running", TurnId.make("turn-live"));
  const settled = makeThread("thread-ready", "ready");
  const dispatched: OrchestrationCommand[] = [];
  const bindingReads: ThreadId[] = [];
  const upserts: ProviderSessionDirectory.ProviderRuntimeBinding[] = [];

  return runReconciliation({
    threads: [starting, running, staleActiveTurn, archived, live, settled],
    liveThreadIds: [live.id],
    directory: {
      getBinding: (candidate) =>
        Effect.sync(() => bindingReads.push(candidate)).pipe(
          Effect.as(
            Option.some({
              threadId: candidate,
              provider: ProviderDriverKind.make("codex"),
              providerInstanceId,
              status: "running" as const,
              resumeCursor: { cursor: candidate },
              runtimePayload: { activeTurnId: "stale", unrelated: candidate },
            }),
          ),
        ),
      upsert: (binding) => Effect.sync(() => upserts.push(binding)),
      getProvider: () => Effect.die("unused"),
      listThreadIds: () => Effect.die("unused"),
      listBindings: () => Effect.die("unused"),
    },
    dispatch: (command) =>
      Effect.sync(() => dispatched.push(command)).pipe(Effect.as({ sequence: dispatched.length })),
  }).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        const orphanIds = [starting.id, running.id, staleActiveTurn.id, archived.id];
        assert.deepStrictEqual(bindingReads, orphanIds);
        assert.deepStrictEqual(
          dispatched.map((command) => command.type === "thread.session.set" && command.threadId),
          orphanIds,
        );
        assert.deepStrictEqual(
          dispatched.map((command) =>
            command.type === "thread.session.set"
              ? {
                  status: command.session.status,
                  activeTurnId: command.session.activeTurnId,
                }
              : null,
          ),
          orphanIds.map(() => ({ status: "error" as const, activeTurnId: null })),
        );
        assert.equal(upserts.length, orphanIds.length);
        for (const binding of upserts) {
          assert.equal(binding.status, "stopped");
          assert.deepStrictEqual(binding.runtimePayload, { activeTurnId: null });
          assert.deepStrictEqual(binding.resumeCursor, { cursor: binding.threadId });
        }
      }),
    ),
  );
});

it.effect(
  "settles projections when directory bindings are absent, corrupt, or fail to upsert",
  () => {
    const absent = makeThread("thread-binding-absent", "starting");
    const corrupt = makeThread("thread-binding-corrupt", "running");
    const upsertFailure = makeThread("thread-binding-upsert-failure", "running");
    const dispatched: OrchestrationCommand[] = [];
    const corruptFailure = new ProviderSessionDirectoryPersistenceError({
      operation: "ProviderSessionDirectory.getBinding",
      detail: "corrupt persisted binding",
    });
    const writeFailure = new ProviderSessionDirectoryPersistenceError({
      operation: "ProviderSessionDirectory.upsert",
      detail: "failed binding write",
    });

    return runReconciliation({
      threads: [absent, corrupt, upsertFailure],
      directory: {
        getBinding: (candidate) =>
          candidate === absent.id
            ? Effect.succeed(Option.none())
            : candidate === corrupt.id
              ? Effect.fail(corruptFailure)
              : Effect.succeed(
                  Option.some({
                    threadId: candidate,
                    provider: ProviderDriverKind.make("codex"),
                    providerInstanceId,
                  }),
                ),
        upsert: () => Effect.fail(writeFailure),
        getProvider: () => Effect.die("unused"),
        listThreadIds: () => Effect.die("unused"),
        listBindings: () => Effect.die("unused"),
      },
      dispatch: (command) =>
        Effect.sync(() => dispatched.push(command)).pipe(
          Effect.as({ sequence: dispatched.length }),
        ),
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          assert.deepStrictEqual(
            dispatched.map((command) => command.type === "thread.session.set" && command.threadId),
            [absent.id, corrupt.id, upsertFailure.id],
          );
        }),
      ),
    );
  },
);

it.effect(
  "immediately continues eligible root and child orphans, but leaves parked threads warned",
  () => {
    const root = makeThread("thread-root", "running", TurnId.make("turn-root"));
    const child = makeThread("thread-child", "starting", null, null, {
      taskRelation: { kind: "subtask", parentThreadId: root.id },
    });
    const archived = makeThread(
      "thread-archived",
      "running",
      TurnId.make("turn-archived"),
      updatedAt,
    );
    const deleted = makeThread("thread-deleted", "running", TurnId.make("turn-deleted"), null, {
      deletedAt: updatedAt,
    });
    const settled = makeThread("thread-settled", "running", TurnId.make("turn-settled"), null, {
      settledOverride: "settled",
    });
    const snoozed = makeThread("thread-snoozed", "running", TurnId.make("turn-snoozed"), null, {
      snoozedUntil: "2026-08-21T12:00:00.000Z",
    });
    const dispatched: OrchestrationCommand[] = [];
    const upserts: ProviderSessionDirectory.ProviderRuntimeBinding[] = [];
    const threads = [root, child, archived, deleted, settled, snoozed];

    return runReconciliation({
      threads,
      settings: { automaticContinuationEnabled: true },
      directory: {
        getBinding: (threadId) =>
          Effect.succeed(
            Option.some({
              threadId,
              provider: ProviderDriverKind.make("codex"),
              providerInstanceId,
              status: "running" as const,
              resumeCursor: { sessionId: `resume-${threadId}` },
              runtimePayload: { activeTurnId: "stale" },
            }),
          ),
        upsert: (binding) => Effect.sync(() => upserts.push(binding)),
        getProvider: () => Effect.die("unused"),
        listThreadIds: () => Effect.die("unused"),
        listBindings: () => Effect.die("unused"),
      },
      dispatch: (command) =>
        Effect.sync(() => dispatched.push(command)).pipe(
          Effect.as({ sequence: dispatched.length }),
        ),
    }).pipe(
      Effect.tap(() =>
        Effect.sync(() => {
          const continued = dispatched.filter(
            (command): command is Extract<OrchestrationCommand, { type: "thread.turn.start" }> =>
              command.type === "thread.turn.start",
          );
          assert.deepStrictEqual(
            continued.map((command) => command.threadId),
            [root.id, child.id],
          );
          for (const command of continued) {
            assert.equal(command.message.text, "Continue.");
            assert.deepStrictEqual(command.modelSelection, {
              instanceId: providerInstanceId,
              model: "gpt-5",
            });
            assert.equal(command.runtimeMode, "full-access");
            assert.equal(command.interactionMode, "default");
          }
          const retryClaims = upserts.filter(
            (binding) =>
              typeof binding.runtimePayload === "object" &&
              binding.runtimePayload !== null &&
              "automaticContinuation" in binding.runtimePayload,
          );
          assert.deepStrictEqual(
            retryClaims.map((binding) => binding.threadId),
            [root.id, child.id],
          );
        }),
      ),
    );
  },
);

it.effect("respects durable cooldown and maximum-attempt retry state without sleeping", () =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const cooling = makeThread("thread-cooling", "running", TurnId.make("turn-cooling"));
    const exhausted = makeThread("thread-exhausted", "running", TurnId.make("turn-exhausted"));
    const expired = makeThread("thread-expired", "running", TurnId.make("turn-expired"));
    const dispatched: OrchestrationCommand[] = [];

    yield* runReconciliation({
      threads: [cooling, exhausted, expired],
      settings: {
        automaticContinuationEnabled: true,
        automaticContinuationRetryCooldown: Duration.seconds(30),
        automaticContinuationMaxConsecutiveAttempts: 10,
      },
      directory: {
        getBinding: (threadId) =>
          Effect.succeed(
            Option.some({
              threadId,
              provider: ProviderDriverKind.make("codex"),
              providerInstanceId,
              status: "stopped" as const,
              runtimePayload: {
                automaticContinuation: {
                  source: "restart-orphaned-provider-session",
                  consecutiveAttempts: threadId === exhausted.id ? 10 : 1,
                  lastAttemptedAt: DateTime.formatIso(
                    threadId === expired.id ? DateTime.subtract(now, { minutes: 2 }) : now,
                  ),
                },
              },
            }),
          ),
        upsert: () => Effect.void,
        getProvider: () => Effect.die("unused"),
        listThreadIds: () => Effect.die("unused"),
        listBindings: () => Effect.die("unused"),
      },
      dispatch: (command) =>
        Effect.sync(() => dispatched.push(command)).pipe(
          Effect.as({ sequence: dispatched.length }),
        ),
    });

    assert.deepStrictEqual(
      dispatched
        .filter((command) => command.type === "thread.turn.start")
        .map((command) => command.threadId),
      [expired.id],
    );
  }),
);

it.effect("dispatches one cooled-down recovery without polling and revalidates its warning", () =>
  Effect.gen(function* () {
    const now = yield* DateTime.now;
    const initial = makeThread("thread-delayed", "running", TurnId.make("turn-delayed"));
    let current = initial as OrchestrationThread;
    let binding: ProviderSessionDirectory.ProviderRuntimeBinding = {
      threadId: initial.id,
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId,
      status: "running",
      runtimePayload: {
        automaticContinuation: {
          source: "restart-orphaned-provider-session",
          consecutiveAttempts: 1,
          lastAttemptedAt: DateTime.formatIso(now),
        },
      },
    };
    const dispatched: OrchestrationCommand[] = [];

    yield* runReconciliation({
      threads: [initial],
      getThreads: () => [current],
      settings: {
        automaticContinuationEnabled: true,
        automaticContinuationRetryCooldown: Duration.seconds(30),
      },
      directory: {
        getBinding: () => Effect.succeed(Option.some(binding)),
        upsert: (next) =>
          Effect.sync(() => {
            binding = {
              ...binding,
              ...next,
              runtimePayload:
                typeof binding.runtimePayload === "object" &&
                binding.runtimePayload !== null &&
                typeof next.runtimePayload === "object" &&
                next.runtimePayload !== null
                  ? { ...binding.runtimePayload, ...next.runtimePayload }
                  : (next.runtimePayload ?? binding.runtimePayload),
            };
          }),
        getProvider: () => Effect.die("unused"),
        listThreadIds: () => Effect.die("unused"),
        listBindings: () => Effect.die("unused"),
      },
      dispatch: (command) =>
        Effect.sync(() => {
          dispatched.push(command);
          if (command.type === "thread.session.set") {
            current = { ...current, session: command.session };
          }
        }).pipe(Effect.as({ sequence: dispatched.length })),
    });

    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      ["thread.session.set"],
    );
    yield* Effect.yieldNow;
    yield* TestClock.adjust(Duration.seconds(29));
    yield* Effect.yieldNow;
    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      ["thread.session.set"],
    );

    yield* TestClock.adjust(Duration.seconds(1));
    yield* Effect.yieldNow;
    assert.deepStrictEqual(
      dispatched.map((command) => command.type),
      ["thread.session.set", "thread.turn.start"],
    );
    assert.equal(
      typeof binding.runtimePayload === "object" &&
        binding.runtimePayload !== null &&
        "automaticContinuation" in binding.runtimePayload,
      true,
    );
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer())),
);

it.effect("keeps the orphan warning when the durable retry claim cannot be persisted", () => {
  const thread = makeThread("thread-claim-failure", "running", TurnId.make("turn-claim-failure"));
  const dispatched: OrchestrationCommand[] = [];

  return runReconciliation({
    threads: [thread],
    settings: { automaticContinuationEnabled: true },
    directory: {
      getBinding: () =>
        Effect.succeed(
          Option.some({
            threadId: thread.id,
            provider: ProviderDriverKind.make("codex"),
            providerInstanceId,
            status: "running" as const,
          }),
        ),
      upsert: (binding) =>
        binding.runtimePayload &&
        typeof binding.runtimePayload === "object" &&
        "automaticContinuation" in binding.runtimePayload
          ? Effect.fail(
              new ProviderSessionDirectoryPersistenceError({
                operation: "ProviderSessionDirectory.upsert",
                detail: "claim write failed",
              }),
            )
          : Effect.void,
      getProvider: () => Effect.die("unused"),
      listThreadIds: () => Effect.die("unused"),
      listBindings: () => Effect.die("unused"),
    },
    dispatch: (command) =>
      Effect.sync(() => dispatched.push(command)).pipe(Effect.as({ sequence: dispatched.length })),
  }).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        assert.deepStrictEqual(
          dispatched.map((command) => command.type),
          ["thread.session.set"],
        );
      }),
    ),
  );
});

it.effect("does not continue when persisting the orphan warning fails", () => {
  const thread = makeThread(
    "thread-warning-failure",
    "running",
    TurnId.make("turn-warning-failure"),
  );
  const dispatched: OrchestrationCommand[] = [];
  const failure = new OrchestrationCommandInvariantError({
    commandType: "thread.session.set",
    detail: "warning persistence failed",
  });

  return runReconciliation({
    threads: [thread],
    settings: { automaticContinuationEnabled: true },
    directory: {
      getBinding: () =>
        Effect.succeed(
          Option.some({
            threadId: thread.id,
            provider: ProviderDriverKind.make("codex"),
            providerInstanceId,
            status: "running" as const,
          }),
        ),
      upsert: () => Effect.void,
      getProvider: () => Effect.die("unused"),
      listThreadIds: () => Effect.die("unused"),
      listBindings: () => Effect.die("unused"),
    },
    dispatch: (command) => {
      dispatched.push(command);
      return Effect.fail(failure);
    },
  }).pipe(
    Effect.tap(() =>
      Effect.sync(() => {
        assert.deepStrictEqual(
          dispatched.map((command) => command.type),
          ["thread.session.set", "thread.session.set"],
        );
      }),
    ),
  );
});

it.effect("retries failed projections and continues after a persistent failure", () => {
  const transient = makeThread("thread-dispatch-transient-failure", "running");
  const persistent = makeThread("thread-dispatch-persistent-failure", "running");
  const later = makeThread("thread-dispatch-success", "running");
  const attempted: ThreadId[] = [];
  let transientAttempts = 0;
  const failure = new OrchestrationCommandInvariantError({
    commandType: "thread.session.set",
    detail: "simulated startup reconciliation failure",
  });

  return runReconciliation({
    threads: [transient, persistent, later],
    directory: {
      getBinding: () => Effect.succeed(Option.none()),
      upsert: () => Effect.void,
      getProvider: () => Effect.die("unused"),
      listThreadIds: () => Effect.die("unused"),
      listBindings: () => Effect.die("unused"),
    },
    dispatch: (command) => {
      if (command.type !== "thread.session.set") {
        return Effect.die("unexpected command");
      }
      attempted.push(command.threadId);
      if (command.threadId === transient.id && transientAttempts++ === 0) {
        return Effect.fail(failure);
      }
      return command.threadId === persistent.id
        ? Effect.fail(failure)
        : Effect.succeed({ sequence: attempted.length });
    },
  }).pipe(
    Effect.tap(() =>
      Effect.sync(() =>
        assert.deepStrictEqual(attempted, [
          transient.id,
          transient.id,
          persistent.id,
          persistent.id,
          later.id,
        ]),
      ),
    ),
  );
});

it.effect("does not fail startup when the live provider session inventory cannot be read", () => {
  let queried = false;
  return ServerRuntimeStartup.reconcileProviderSessions.pipe(
    Effect.provide(
      Layer.mergeAll(
        Layer.succeed(ProjectionSnapshotQuery.ProjectionSnapshotQuery, {
          getCommandReadModel: () =>
            Effect.sync(() => {
              queried = true;
              return { threads: [] } as never;
            }),
        } as unknown as ProjectionSnapshotQuery.ProjectionSnapshotQuery["Service"]),
        Layer.succeed(ProviderService.ProviderService, {
          ...makeProviderService(),
          listSessions: () => Effect.die("provider inventory unavailable"),
        }),
        Layer.succeed(ProviderSessionDirectory.ProviderSessionDirectory, {
          getBinding: () => Effect.die("unused"),
          upsert: () => Effect.die("unused"),
          getProvider: () => Effect.die("unused"),
          listThreadIds: () => Effect.die("unused"),
          listBindings: () => Effect.die("unused"),
        }),
        Layer.succeed(OrchestrationEngine.OrchestrationEngineService, {
          readEvents: () => Stream.empty,
          dispatch: () => Effect.die("unused"),
          streamDomainEvents: Stream.empty,
          latestSequence: Effect.succeed(0),
        }),
        ServerSettings.layerTest(),
        NodeServices.layer,
      ),
    ),
    Effect.tap(() => Effect.sync(() => assert.equal(queried, false))),
  );
});
