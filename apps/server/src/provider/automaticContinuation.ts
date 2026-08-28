import { IsoDateTime, PositiveInt } from "@t3tools/contracts";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Option from "effect/Option";
import * as Schema from "effect/Schema";

/** Durable retry metadata kept in the provider session binding's runtime payload. */
export const AUTOMATIC_CONTINUATION_RETRY_STATE_KEY = "automaticContinuation";
export const AUTOMATIC_CONTINUATION_RETRY_SOURCE = "restart-orphaned-provider-session";

export const AutomaticContinuationRetryState = Schema.Struct({
  source: Schema.Literal(AUTOMATIC_CONTINUATION_RETRY_SOURCE),
  consecutiveAttempts: PositiveInt,
  lastAttemptedAt: IsoDateTime,
});
export type AutomaticContinuationRetryState = typeof AutomaticContinuationRetryState.Type;

const AutomaticContinuationRetryStateEnvelope = Schema.Struct({
  [AUTOMATIC_CONTINUATION_RETRY_STATE_KEY]: Schema.optionalKey(AutomaticContinuationRetryState),
});
const decodeRetryStateEnvelope = Schema.decodeUnknownOption(
  AutomaticContinuationRetryStateEnvelope,
);

export function readAutomaticContinuationRetryState(
  runtimePayload: unknown | null | undefined,
): AutomaticContinuationRetryState | undefined {
  return Option.match(decodeRetryStateEnvelope(runtimePayload), {
    onNone: () => undefined,
    onSome: (payload) => payload[AUTOMATIC_CONTINUATION_RETRY_STATE_KEY],
  });
}

export function nextAutomaticContinuationRetryState(input: {
  readonly previous: AutomaticContinuationRetryState | undefined;
  readonly attemptedAt: string;
}): AutomaticContinuationRetryState {
  return {
    source: AUTOMATIC_CONTINUATION_RETRY_SOURCE,
    consecutiveAttempts: (input.previous?.consecutiveAttempts ?? 0) + 1,
    lastAttemptedAt: input.attemptedAt,
  };
}

/**
 * Returns the remaining cooldown, or `undefined` when this is the first
 * attempt or the cooldown has elapsed. An invalid persisted time fails closed
 * so corrupt state cannot turn into an immediate billing loop.
 */
export function automaticContinuationRetryDelay(input: {
  readonly retryState: AutomaticContinuationRetryState | undefined;
  readonly now: DateTime.DateTime;
  readonly cooldown: Duration.Duration;
}): Duration.Duration | null | undefined {
  if (input.retryState === undefined) {
    return undefined;
  }
  const lastAttemptedAt = DateTime.make(input.retryState.lastAttemptedAt);
  if (Option.isNone(lastAttemptedAt)) {
    return null;
  }
  const retryAt = DateTime.add(lastAttemptedAt.value, {
    milliseconds: Duration.toMillis(input.cooldown),
  });
  const remainingMs = DateTime.toEpochMillis(retryAt) - DateTime.toEpochMillis(input.now);
  return remainingMs > 0 ? Duration.millis(remainingMs) : undefined;
}

export function automaticContinuationRetryPayload(
  retryState: AutomaticContinuationRetryState | undefined,
): Record<typeof AUTOMATIC_CONTINUATION_RETRY_STATE_KEY, AutomaticContinuationRetryState | null> {
  // Provider runtime payloads merge object fields, so `undefined` would leave
  // an old persisted value intact on storage backends that preserve it. Null
  // is an explicit tombstone that decodes as no retry state.
  return { [AUTOMATIC_CONTINUATION_RETRY_STATE_KEY]: retryState ?? null };
}
