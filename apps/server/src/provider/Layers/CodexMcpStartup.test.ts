import * as NodeAssert from "node:assert/strict";

import { it } from "@effect/vitest";
import * as Deferred from "effect/Deferred";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Schema from "effect/Schema";

import { CodexMcpStartupError, makeCodexMcpStartupGate } from "./CodexMcpStartup.ts";

const isCodexMcpStartupError = Schema.is(CodexMcpStartupError);

const update = (
  name: string,
  status: "starting" | "ready" | "failed" | "cancelled",
  error?: string,
) => ({ name, status, ...(error ? { error } : {}) });

it.effect("waits for every MCP server to reach a terminal startup state", () =>
  Effect.gen(function* () {
    const gate = yield* makeCodexMcpStartupGate();
    yield* gate.handleUpdate(update("t3-code", "starting"));
    yield* gate.handleUpdate(update("codebase-memory-mcp", "starting"));
    const refreshActive = yield* Deferred.make<void>();
    const refreshFiber = yield* gate
      .refresh(Deferred.succeed(refreshActive, undefined))
      .pipe(Effect.forkChild);

    yield* Deferred.await(refreshActive);
    yield* gate.handleUpdate(update("t3-code", "ready"));
    NodeAssert.equal(refreshFiber.pollUnsafe(), undefined);

    yield* gate.handleUpdate(update("codebase-memory-mcp", "ready"));
    yield* Fiber.join(refreshFiber);
  }),
);

it.effect("reports the MCP server startup error instead of starting an under-tooled turn", () =>
  Effect.gen(function* () {
    const gate = yield* makeCodexMcpStartupGate();
    yield* gate.handleUpdate(update("t3-code", "starting"));
    yield* gate.handleUpdate(update("codebase-memory-mcp", "starting"));
    const refreshActive = yield* Deferred.make<void>();
    const refreshFiber = yield* gate
      .refresh(Deferred.succeed(refreshActive, undefined))
      .pipe(Effect.forkChild);

    yield* Deferred.await(refreshActive);
    yield* gate.handleUpdate(update("t3-code", "ready"));
    yield* gate.handleUpdate(
      update("codebase-memory-mcp", "failed", "MCP startup timed out after 30 seconds"),
    );

    const error = yield* Fiber.join(refreshFiber).pipe(Effect.flip);
    NodeAssert.ok(isCodexMcpStartupError(error));
    NodeAssert.match(error.message, /codebase-memory-mcp/);
    NodeAssert.match(error.message, /timed out after 30 seconds/);
  }),
);

it.effect("accepts terminal startup notifications received before reload completes", () =>
  Effect.gen(function* () {
    const gate = yield* makeCodexMcpStartupGate();
    yield* gate.handleUpdate(update("t3-code", "ready"));
    yield* gate.handleUpdate(update("codebase-memory-mcp", "ready"));
    yield* gate.refresh(Effect.void);
  }),
);
