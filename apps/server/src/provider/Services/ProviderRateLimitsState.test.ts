import { EventId, ProviderDriverKind, ProviderInstanceId, ThreadId } from "@t3tools/contracts";
import { it } from "@effect/vitest";
import { expect } from "vite-plus/test";
import * as Effect from "effect/Effect";
import * as Option from "effect/Option";
import * as Stream from "effect/Stream";
import { ProviderRateLimitsState } from "./ProviderRateLimitsState.ts";

it.effect("merges sparse updates by provider instance", () =>
  Effect.gen(function* () {
    const state = yield* ProviderRateLimitsState;
    const base = {
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: ProviderInstanceId.make("codex_personal"),
      threadId: ThreadId.make("thread-1"),
      providerRefs: {},
    } as const;
    yield* state.update({
      ...base,
      type: "account.rate-limits.updated",
      eventId: EventId.make("rate-1"),
      createdAt: "2026-07-29T12:00:00.000Z",
      payload: {
        rateLimits: {
          primary: { usedPercent: 10, resetsAt: 100, windowDurationMins: 300 },
          secondary: { usedPercent: 20, windowDurationMins: 10_080 },
        },
      },
    });
    yield* state.update({
      ...base,
      type: "account.rate-limits.updated",
      eventId: EventId.make("rate-2"),
      createdAt: "2026-07-29T12:01:00.000Z",
      payload: { rateLimits: { primary: { usedPercent: 11 } } },
    });
    const entries = yield* Stream.runHead(state.changes);
    expect(Option.getOrThrow(entries)[0]?.rateLimits).toEqual({
      primary: { usedPercent: 11, resetsAt: 100, windowDurationMins: 300 },
      secondary: { usedPercent: 20, windowDurationMins: 10_080 },
    });
  }).pipe(Effect.provide(ProviderRateLimitsState.layer)),
);
