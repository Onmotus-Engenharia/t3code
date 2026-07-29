import type { ProviderRateLimitsSnapshot, ProviderRuntimeEvent } from "@t3tools/contracts";
import { mergeProviderRateLimits } from "@t3tools/shared/providerRateLimits";
import * as Context from "effect/Context";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Stream from "effect/Stream";
import * as SubscriptionRef from "effect/SubscriptionRef";

export class ProviderRateLimitsState extends Context.Service<
  ProviderRateLimitsState,
  {
    readonly update: (event: ProviderRuntimeEvent) => Effect.Effect<void>;
    readonly changes: Stream.Stream<ReadonlyArray<ProviderRateLimitsSnapshot>>;
  }
>()("t3/provider/Services/ProviderRateLimitsState") {
  static readonly layer = Layer.effect(
    ProviderRateLimitsState,
    Effect.gen(function* () {
      const state = yield* SubscriptionRef.make<ReadonlyArray<ProviderRateLimitsSnapshot>>([]);
      return ProviderRateLimitsState.of({
        update: (event) => {
          if (event.type !== "account.rate-limits.updated") return Effect.void;
          return SubscriptionRef.update(state, (entries) => {
            const index = entries.findIndex(
              (entry) =>
                entry.provider === event.provider &&
                entry.providerInstanceId === event.providerInstanceId,
            );
            const previous = index >= 0 ? entries[index] : undefined;
            const next = {
              provider: event.provider,
              ...(event.providerInstanceId ? { providerInstanceId: event.providerInstanceId } : {}),
              updatedAt: event.createdAt,
              rateLimits: mergeProviderRateLimits(previous?.rateLimits, event.payload.rateLimits),
            } satisfies ProviderRateLimitsSnapshot;
            return index < 0
              ? [...entries, next]
              : entries.map((entry, entryIndex) => (entryIndex === index ? next : entry));
          });
        },
        changes: SubscriptionRef.changes(state),
      });
    }),
  );
}
