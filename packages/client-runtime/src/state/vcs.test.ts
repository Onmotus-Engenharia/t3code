import {
  EnvironmentId,
  WS_METHODS,
  type VcsListRefsInput,
  type VcsListRefsResult,
} from "@t3tools/contracts";
import { describe, expect, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Ref from "effect/Ref";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";
import * as TestClock from "effect/testing/TestClock";
import { AsyncResult, Atom, AtomRegistry } from "effect/unstable/reactivity";

import {
  AVAILABLE_CONNECTION_STATE,
  PrimaryConnectionTarget,
  type PreparedConnection,
  type SupervisorConnectionState,
} from "../connection/model.ts";
import * as EnvironmentRegistry from "../connection/registry.ts";
import * as EnvironmentSupervisor from "../connection/supervisor.ts";
import * as Persistence from "../platform/persistence.ts";
import type { WsRpcProtocolClient } from "../rpc/protocol.ts";
import type { RpcSession } from "../rpc/session.ts";
import { createVcsEnvironmentAtoms, makeCachedVcsRefsChanges } from "./vcs.ts";

const TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-1"),
  label: "Test environment",
  httpBaseUrl: "https://environment.example.test",
  wsBaseUrl: "wss://environment.example.test",
});
const SECOND_TARGET = new PrimaryConnectionTarget({
  environmentId: EnvironmentId.make("environment-2"),
  label: "Second test environment",
  httpBaseUrl: "https://environment-2.example.test",
  wsBaseUrl: "wss://environment-2.example.test",
});

const CONNECTED_CONNECTION_STATE: SupervisorConnectionState = {
  ...AVAILABLE_CONNECTION_STATE,
  desired: true,
  network: "online",
  phase: "connected",
  attempt: 1,
  generation: 1,
};

const CACHED_REFS: VcsListRefsResult = {
  refs: [
    {
      name: "main",
      current: true,
      isDefault: true,
      worktreePath: "/repo",
    },
  ],
  isRepo: true,
  hasPrimaryRemote: true,
  nextCursor: null,
  totalCount: 1,
};

const LIVE_REFS: VcsListRefsResult = {
  ...CACHED_REFS,
  refs: [
    {
      name: "release",
      current: true,
      isDefault: true,
      worktreePath: "/repo",
    },
  ],
};

function session(client: WsRpcProtocolClient): RpcSession {
  return {
    client,
    initialConfig: Effect.never,
    ready: Effect.void,
    probe: Effect.void,
    closed: Effect.never,
  };
}

function cacheWithRefs(refs: Option.Option<VcsListRefsResult>) {
  return Persistence.EnvironmentCacheStore.of({
    loadShell: () => Effect.succeed(Option.none()),
    saveShell: () => Effect.void,
    loadThread: () => Effect.succeed(Option.none()),
    saveThread: () => Effect.void,
    removeThread: () => Effect.void,
    loadServerConfig: () => Effect.succeed(Option.none()),
    saveServerConfig: () => Effect.void,
    loadVcsRefs: () => Effect.succeed(refs),
    saveVcsRefs: () => Effect.void,
    clear: () => Effect.void,
  });
}

describe("cached VCS refs", () => {
  it.effect("loads an unfiltered branch list without a connection", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
          target: TARGET,
          state: yield* SubscriptionRef.make(AVAILABLE_CONNECTION_STATE),
          session: yield* SubscriptionRef.make(Option.none<RpcSession>()),
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
        const refs = yield* Stream.unwrap(
          makeCachedVcsRefsChanges({ cwd: "/repo", limit: 100 }).pipe(
            Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
            Effect.provideService(
              Persistence.EnvironmentCacheStore,
              cacheWithRefs(Option.some(CACHED_REFS)),
            ),
          ),
        ).pipe(Stream.runHead);

        expect(Option.getOrThrow(refs)).toEqual(CACHED_REFS);
      }),
    ),
  );

  it.effect("continues polling after a transient live failure", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const expectedError = new Error("Could not list Git refs.");
        const calls = yield* Ref.make(0);
        const client = {
          [WS_METHODS.vcsListRefs]: () =>
            Ref.updateAndGet(calls, (count) => count + 1).pipe(
              Effect.flatMap((count) =>
                count === 1 ? Effect.fail(expectedError) : Effect.succeed(LIVE_REFS),
              ),
            ),
        } as unknown as WsRpcProtocolClient;
        const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
          target: TARGET,
          state: yield* SubscriptionRef.make(CONNECTED_CONNECTION_STATE),
          session: yield* SubscriptionRef.make(Option.some(session(client))),
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);

        const result = Stream.unwrap(
          makeCachedVcsRefsChanges({ cwd: "/repo", limit: 100 }).pipe(
            Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
            Effect.provideService(
              Persistence.EnvironmentCacheStore,
              cacheWithRefs(Option.some(CACHED_REFS)),
            ),
          ),
        ).pipe(Stream.runHead);
        const fiber = yield* Effect.forkChild(result);

        for (let attempt = 0; attempt < 100 && (yield* Ref.get(calls)) < 1; attempt += 1) {
          yield* Effect.yieldNow;
        }
        expect(yield* Ref.get(calls)).toBe(1);

        yield* TestClock.adjust("5 seconds");
        expect(Option.getOrThrow(yield* Fiber.join(fiber))).toEqual(LIVE_REFS);
      }).pipe(Effect.provide(TestClock.layer())),
    ),
  );

  it.effect("revalidates connected refs every five seconds", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const calls = yield* Ref.make(0);
        const client = {
          [WS_METHODS.vcsListRefs]: () =>
            Ref.updateAndGet(calls, (count) => count + 1).pipe(
              Effect.map((count) => (count === 1 ? CACHED_REFS : LIVE_REFS)),
            ),
        } as unknown as WsRpcProtocolClient;
        const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
          target: TARGET,
          state: yield* SubscriptionRef.make(CONNECTED_CONNECTION_STATE),
          session: yield* SubscriptionRef.make(Option.some(session(client))),
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);
        const results = Stream.unwrap(
          makeCachedVcsRefsChanges({ cwd: "/repo", limit: 100 }).pipe(
            Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
            Effect.provideService(Persistence.EnvironmentCacheStore, cacheWithRefs(Option.none())),
          ),
        ).pipe(Stream.take(2), Stream.runCollect);
        const fiber = yield* Effect.forkChild(results);

        for (let attempt = 0; attempt < 100 && (yield* Ref.get(calls)) < 1; attempt += 1) {
          yield* Effect.yieldNow;
        }
        expect(yield* Ref.get(calls)).toBe(1);

        yield* TestClock.adjust("5 seconds");
        expect(Array.from(yield* Fiber.join(fiber))).toEqual([CACHED_REFS, LIVE_REFS]);
      }).pipe(Effect.provide(TestClock.layer())),
    ),
  );

  it.effect("does not emit persisted refs before a live refresh", () =>
    Effect.scoped(
      Effect.gen(function* () {
        const client = {
          [WS_METHODS.vcsListRefs]: () => Effect.succeed(LIVE_REFS),
        } as unknown as WsRpcProtocolClient;
        const supervisor = EnvironmentSupervisor.EnvironmentSupervisor.of({
          target: TARGET,
          state: yield* SubscriptionRef.make(CONNECTED_CONNECTION_STATE),
          session: yield* SubscriptionRef.make(Option.some(session(client))),
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]);

        const refs = yield* Stream.unwrap(
          makeCachedVcsRefsChanges({ cwd: "/repo", limit: 100 }).pipe(
            Effect.provideService(EnvironmentSupervisor.EnvironmentSupervisor, supervisor),
            Effect.provideService(
              Persistence.EnvironmentCacheStore,
              cacheWithRefs(Option.some(CACHED_REFS)),
            ),
          ),
        ).pipe(Stream.runHead);

        expect(Option.getOrThrow(refs)).toEqual(LIVE_REFS);
      }),
    ),
  );
});

describe("VCS refs atom lifecycle", () => {
  interface RefsCall {
    readonly environmentId: EnvironmentId;
    readonly input: VcsListRefsInput;
  }

  const waitFor = Effect.fn("VcsRefsLifecycleTest.waitFor")(function* (predicate: () => boolean) {
    for (let attempt = 0; attempt < 500; attempt += 1) {
      if (predicate()) return;
      yield* TestClock.withLive(Effect.sleep(1));
    }
    return yield* Effect.die("Timed out waiting for VCS refs lifecycle condition.");
  });

  const liveSleep = (millis: number) => TestClock.withLive(Effect.sleep(millis));

  const makeLifecycleHarness = Effect.fn("VcsRefsLifecycleTest.makeHarness")(function* (
    revalidateInterval = 60,
  ) {
    const calls: RefsCall[] = [];
    const cachedRefs = new Map<string, VcsListRefsResult>();
    const supervisors = new Map<
      EnvironmentId,
      EnvironmentSupervisor.EnvironmentSupervisor["Service"]
    >();
    const states = new Map<
      EnvironmentId,
      SubscriptionRef.SubscriptionRef<SupervisorConnectionState>
    >();

    for (const target of [TARGET, SECOND_TARGET]) {
      const client = {
        [WS_METHODS.vcsListRefs]: (input: VcsListRefsInput) => {
          calls.push({ environmentId: target.environmentId, input });
          return Effect.succeed(LIVE_REFS);
        },
      } as unknown as WsRpcProtocolClient;
      const state = yield* SubscriptionRef.make(CONNECTED_CONNECTION_STATE);
      states.set(target.environmentId, state);
      supervisors.set(
        target.environmentId,
        EnvironmentSupervisor.EnvironmentSupervisor.of({
          target,
          state,
          session: yield* SubscriptionRef.make(Option.some(session(client))),
          prepared: yield* SubscriptionRef.make(Option.none<PreparedConnection>()),
          connect: Effect.void,
          disconnect: Effect.void,
          retryNow: Effect.void,
        } satisfies EnvironmentSupervisor.EnvironmentSupervisor["Service"]),
      );
    }

    const cache = Persistence.EnvironmentCacheStore.of({
      ...cacheWithRefs(Option.none()),
      loadVcsRefs: (environmentId, cwd) =>
        Effect.succeed(Option.fromUndefinedOr(cachedRefs.get(`${environmentId}\0${cwd}`))),
      saveVcsRefs: (environmentId, cwd, refs) =>
        Effect.sync(() => {
          cachedRefs.set(`${environmentId}\0${cwd}`, refs);
        }),
    });
    const environmentRegistry = EnvironmentRegistry.EnvironmentRegistry.of({
      followStream: (environmentId, stream) =>
        Stream.provideService(
          stream,
          EnvironmentSupervisor.EnvironmentSupervisor,
          supervisors.get(environmentId)!,
        ),
    } as EnvironmentRegistry.EnvironmentRegistry["Service"]);
    const runtime = Atom.runtime(
      Layer.mergeAll(
        Layer.succeed(EnvironmentRegistry.EnvironmentRegistry, environmentRegistry),
        Layer.succeed(Persistence.EnvironmentCacheStore, cache),
      ),
    );
    const atoms = createVcsEnvironmentAtoms(runtime, { revalidateInterval });
    const registry = AtomRegistry.make();
    const callsFor = (environmentId: EnvironmentId, input?: Partial<VcsListRefsInput>) =>
      calls.filter(
        (call) =>
          call.environmentId === environmentId &&
          (input === undefined ||
            Object.entries(input).every(
              ([key, value]) => call.input[key as keyof VcsListRefsInput] === value,
            )),
      ).length;

    return { atoms, cachedRefs, calls, callsFor, registry, states };
  });

  it.effect("runs one refresh loop for one active consumer and stays interval-bounded", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness();
      const atom = harness.atoms.listRefs({
        environmentId: TARGET.environmentId,
        input: { cwd: "/repo", limit: 100 },
      });
      const unmount = harness.registry.mount(atom);

      yield* waitFor(() => harness.calls.length === 1);
      yield* liveSleep(25);
      expect(harness.calls).toHaveLength(1);
      yield* liveSleep(50);
      expect(harness.calls).toHaveLength(2);

      unmount();
      harness.registry.dispose();
    }),
  );

  it.effect("shares one refresh loop between identical consumers", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness();
      const target = {
        environmentId: TARGET.environmentId,
        input: { cwd: "/repo", limit: 100 },
      } as const;
      const first = harness.atoms.listRefs(target);
      const second = harness.atoms.listRefs({ ...target, input: { ...target.input } });
      expect(second).toBe(first);

      const unmountFirst = harness.registry.mount(first);
      const unmountSecond = harness.registry.mount(second);
      yield* waitFor(() => harness.calls.length === 1);
      yield* liveSleep(75);
      expect(harness.calls).toHaveLength(2);

      unmountFirst();
      yield* liveSleep(75);
      expect(harness.calls).toHaveLength(3);
      unmountSecond();
      const stoppedAt = harness.calls.length;
      yield* liveSleep(75);
      expect(harness.calls).toHaveLength(stoppedAt);
      harness.registry.dispose();
    }),
  );

  it.effect("stops promptly after unmount while keeping persisted refs available offline", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness();
      const target = {
        environmentId: TARGET.environmentId,
        input: { cwd: "/repo", limit: 100 },
      } as const;
      const atom = harness.atoms.listRefs(target);
      const unmount = harness.registry.mount(atom);

      yield* waitFor(() => harness.calls.length === 1 && harness.cachedRefs.size === 1);
      unmount();
      const stoppedAt = harness.calls.length;
      yield* liveSleep(75);
      expect(harness.calls).toHaveLength(stoppedAt);

      yield* SubscriptionRef.set(
        harness.states.get(TARGET.environmentId)!,
        AVAILABLE_CONNECTION_STATE,
      );
      const remount = harness.registry.mount(atom);
      yield* waitFor(() => AsyncResult.isSuccess(harness.registry.get(atom)));
      const result = harness.registry.get(atom);
      expect(AsyncResult.isSuccess(result) ? result.value : null).toEqual(LIVE_REFS);
      expect(harness.calls).toHaveLength(stoppedAt);

      remount();
      harness.registry.dispose();
    }),
  );

  it.effect("does not retain stale query or cursor loops", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness(100);
      const atomFor = (input: VcsListRefsInput) =>
        harness.atoms.listRefs({ environmentId: TARGET.environmentId, input });
      const first = atomFor({ cwd: "/repo", query: "first", limit: 100 });
      const second = atomFor({ cwd: "/repo", query: "second", limit: 100 });
      const third = atomFor({ cwd: "/repo", cursor: 100, limit: 100 });
      expect(new Set([first, second, third]).size).toBe(3);

      const unmountFirst = harness.registry.mount(first);
      yield* waitFor(() => harness.calls.length === 1);
      unmountFirst();
      const unmountSecond = harness.registry.mount(second);
      yield* waitFor(() => harness.calls.length === 2);
      unmountSecond();
      const unmountThird = harness.registry.mount(third);
      yield* waitFor(() => harness.calls.length === 3);
      yield* liveSleep(125);

      expect(harness.calls).toHaveLength(4);
      expect(harness.callsFor(TARGET.environmentId, { query: "first" })).toBe(1);
      expect(harness.callsFor(TARGET.environmentId, { query: "second" })).toBe(1);
      expect(harness.callsFor(TARGET.environmentId, { cursor: 100 })).toBe(2);

      unmountThird();
      harness.registry.dispose();
    }),
  );

  it.effect("reconnects with exactly one replacement loop", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness();
      const atom = harness.atoms.listRefs({
        environmentId: TARGET.environmentId,
        input: { cwd: "/repo", limit: 100 },
      });
      const unmount = harness.registry.mount(atom);
      yield* waitFor(() => harness.calls.length === 1);

      const state = harness.states.get(TARGET.environmentId)!;
      yield* SubscriptionRef.set(state, AVAILABLE_CONNECTION_STATE);
      yield* liveSleep(75);
      expect(harness.calls).toHaveLength(1);

      yield* SubscriptionRef.set(state, { ...CONNECTED_CONNECTION_STATE, generation: 2 });
      yield* waitFor(() => harness.calls.length === 2);
      yield* liveSleep(75);
      expect(harness.calls).toHaveLength(3);

      unmount();
      harness.registry.dispose();
    }),
  );

  it.effect("isolates refresh loops by environment", () =>
    Effect.gen(function* () {
      const harness = yield* makeLifecycleHarness();
      const input = { cwd: "/repo", limit: 100 } as const;
      const first = harness.atoms.listRefs({ environmentId: TARGET.environmentId, input });
      const second = harness.atoms.listRefs({ environmentId: SECOND_TARGET.environmentId, input });
      expect(second).not.toBe(first);

      const unmountFirst = harness.registry.mount(first);
      const unmountSecond = harness.registry.mount(second);
      yield* waitFor(() => harness.calls.length === 2);
      yield* liveSleep(75);
      expect(harness.callsFor(TARGET.environmentId)).toBe(2);
      expect(harness.callsFor(SECOND_TARGET.environmentId)).toBe(2);

      unmountFirst();
      yield* liveSleep(75);
      expect(harness.callsFor(TARGET.environmentId)).toBe(2);
      expect(harness.callsFor(SECOND_TARGET.environmentId)).toBe(3);

      unmountSecond();
      harness.registry.dispose();
    }),
  );
});
