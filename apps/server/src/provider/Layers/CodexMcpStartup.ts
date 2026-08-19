import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Ref from "effect/Ref";
import * as Schema from "effect/Schema";
import * as Semaphore from "effect/Semaphore";
import * as CodexSchema from "effect-codex-app-server/schema";

export type CodexMcpStartupUpdate = CodexSchema.V2McpServerStatusUpdatedNotification;

interface ActiveMcpRefresh {
  readonly completion: Deferred.Deferred<ReadonlyArray<CodexMcpStartupUpdate>>;
  readonly reloadCompleted: boolean;
  readonly statuses: ReadonlyMap<string, CodexMcpStartupUpdate>;
}

interface McpStartupGateState {
  readonly activeRefresh: ActiveMcpRefresh | undefined;
  readonly latestStatuses: ReadonlyMap<string, CodexMcpStartupUpdate>;
}

const CodexMcpStartupFailure = Schema.Struct({
  error: Schema.optional(Schema.String),
  failureReason: Schema.optional(Schema.String),
  name: Schema.String,
  status: Schema.Literals(["failed", "cancelled"]),
});

export class CodexMcpStartupError extends Schema.TaggedErrorClass<CodexMcpStartupError>()(
  "CodexMcpStartupError",
  {
    failures: Schema.Array(CodexMcpStartupFailure),
  },
) {
  override get message(): string {
    const details = this.failures
      .map((failure) => {
        const reason = failure.error ?? failure.failureReason;
        return reason
          ? `${failure.name} (${failure.status}): ${reason}`
          : `${failure.name} (${failure.status})`;
      })
      .join("; ");
    return `Codex MCP tool catalog did not become ready: ${details}`;
  }
}

const terminalStatuses = (
  state: ActiveMcpRefresh,
): ReadonlyArray<CodexMcpStartupUpdate> | undefined => {
  if (!state.reloadCompleted || state.statuses.size === 0) return undefined;
  const statuses = [...state.statuses.values()];
  return statuses.some((status) => status.status === "starting") ? undefined : statuses;
};

const completeIfTerminal = (state: ActiveMcpRefresh) => {
  const statuses = terminalStatuses(state);
  return statuses ? Deferred.succeed(state.completion, statuses).pipe(Effect.asVoid) : Effect.void;
};

export const makeCodexMcpStartupGate = Effect.fn("makeCodexMcpStartupGate")(function* () {
  const stateRef = yield* Ref.make<McpStartupGateState>({
    activeRefresh: undefined,
    latestStatuses: new Map(),
  });
  const refreshMutex = yield* Semaphore.make(1);

  const handleUpdate = Effect.fn("CodexMcpStartupGate.handleUpdate")(function* (
    update: CodexMcpStartupUpdate,
  ) {
    const next = yield* Ref.modify(stateRef, (state) => {
      const latestStatuses = new Map(state.latestStatuses);
      latestStatuses.set(update.name, update);
      if (!state.activeRefresh) {
        return [undefined, { ...state, latestStatuses }] as const;
      }
      const statuses = new Map(state.activeRefresh.statuses);
      statuses.set(update.name, update);
      const activeRefresh = {
        ...state.activeRefresh,
        statuses,
      } satisfies ActiveMcpRefresh;
      return [activeRefresh, { activeRefresh, latestStatuses }] as const;
    });
    if (next) yield* completeIfTerminal(next);
  });

  const refreshUnlocked = <A, E>(reload: Effect.Effect<A, E>) =>
    Effect.gen(function* () {
      const completion = yield* Deferred.make<ReadonlyArray<CodexMcpStartupUpdate>>();
      yield* Ref.update(stateRef, (state) => ({
        ...state,
        activeRefresh: {
          completion,
          reloadCompleted: false,
          statuses: new Map(state.latestStatuses),
        },
      }));

      yield* reload;
      const completedReload = yield* Ref.modify(stateRef, (state) => {
        if (!state.activeRefresh) return [undefined, state] as const;
        const activeRefresh = {
          ...state.activeRefresh,
          reloadCompleted: true,
        } satisfies ActiveMcpRefresh;
        return [activeRefresh, { ...state, activeRefresh }] as const;
      });
      if (completedReload) yield* completeIfTerminal(completedReload);

      const statuses = yield* Deferred.await(completion);
      const failures = statuses.flatMap((status) => {
        if (status.status !== "failed" && status.status !== "cancelled") return [];
        return [
          {
            name: status.name,
            status: status.status,
            ...(status.error ? { error: status.error } : {}),
            ...(status.failureReason ? { failureReason: status.failureReason } : {}),
          },
        ];
      });
      if (failures.length > 0) return yield* new CodexMcpStartupError({ failures });
    }).pipe(
      Effect.ensuring(
        Ref.update(stateRef, (state) => ({
          ...state,
          activeRefresh: undefined,
        })),
      ),
    );

  const refresh = <A, E>(reload: Effect.Effect<A, E>) =>
    refreshMutex.withPermits(1)(refreshUnlocked(reload));

  return { handleUpdate, refresh } as const;
});
