import { CommandId, MessageId, ThreadId, type OrchestrationThread } from "@t3tools/contracts";
import * as Crypto from "effect/Crypto";
import * as Cause from "effect/Cause";
import * as DateTime from "effect/DateTime";
import * as Duration from "effect/Duration";
import * as Effect from "effect/Effect";
import * as Fiber from "effect/Fiber";
import * as Layer from "effect/Layer";
import * as Option from "effect/Option";
import * as Queue from "effect/Queue";
import * as Stream from "effect/Stream";

import { GitWorkflowService } from "../../git/GitWorkflowService.ts";
import { OrchestrationEngineService } from "../../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionSnapshotQuery } from "../../orchestration/Services/ProjectionSnapshotQuery.ts";
import { ProviderRegistry } from "../../provider/Services/ProviderRegistry.ts";
import { T3Tasks } from "../Services/T3Tasks.ts";
import { type T3TaskToolCall, installT3TaskToolHandler } from "../Services/T3TaskToolBridge.ts";
import {
  ToolFailure,
  createLimitForCaller,
  fail,
  hasTaskWaitChange,
  isTerminal,
  jsonResponse,
  object,
  optionalString,
  ownsThread,
  requiredString,
  selectOwnedTaskSummaries,
  taskOutputToken,
  taskSummary,
  threadStatus,
} from "../domain.ts";
import { executeCreate } from "../create.ts";

const MAX_CREATE_BATCH = 10;
const MAX_WAIT_BATCH = 4;
const MAX_READ_MESSAGES = 20;
const MAX_READ_CHARS = 12_000;
const MAX_WAIT_SECONDS = 60;

export const makeT3Tasks = Effect.gen(function* () {
  const query = yield* ProjectionSnapshotQuery;
  const engine = yield* OrchestrationEngineService;
  const providers = yield* ProviderRegistry;
  const git = yield* GitWorkflowService;
  const crypto = yield* Crypto.Crypto;

  const commandId = crypto.randomUUIDv4.pipe(Effect.map(CommandId.make));
  const messageId = crypto.randomUUIDv4.pipe(Effect.map(MessageId.make));
  const nowIso = DateTime.now.pipe(Effect.map(DateTime.formatIso));

  const snapshotContext = Effect.fn("T3Tasks.snapshotContext")(function* (
    callerThreadId: ThreadId,
  ) {
    const snapshot = yield* query.getSnapshot();
    const caller = snapshot.threads.find((thread) => thread.id === callerThreadId);
    if (!caller || caller.deletedAt !== null || caller.archivedAt !== null) {
      return fail("not_found", `Calling thread '${callerThreadId}' is not active.`);
    }
    if (!caller.taskOrchestrationEnabled) {
      return fail(
        "permission_denied",
        "Task orchestration is disabled for this thread. Enable it explicitly before using t3_tasks.",
      );
    }
    const project = snapshot.projects.find(
      (candidate) => candidate.id === caller.projectId && candidate.deletedAt === null,
    );
    if (!project) return fail("not_found", `Project '${caller.projectId}' is not active.`);
    return { snapshot, caller, project };
  });

  const ownedTarget = (
    caller: OrchestrationThread,
    threads: ReadonlyArray<OrchestrationThread>,
    rawThreadId: string,
  ) => {
    const target = threads.find((thread) => thread.id === rawThreadId);
    if (!target) return fail("not_found", `Task '${rawThreadId}' was not found.`);
    if (!ownsThread(caller, target)) {
      return fail(
        "ownership_denied",
        `Task '${rawThreadId}' is not a child task of this orchestrator.`,
      );
    }
    return target;
  };

  const dispatchTurn = Effect.fn("T3Tasks.dispatchTurn")(function* (
    thread: OrchestrationThread,
    text: string,
  ) {
    const createdAt = yield* nowIso;
    yield* engine.dispatch({
      type: "thread.turn.start",
      commandId: yield* commandId,
      threadId: thread.id,
      message: {
        messageId: yield* messageId,
        role: "user",
        text,
        attachments: [],
      },
      modelSelection: thread.modelSelection,
      runtimeMode: thread.runtimeMode,
      interactionMode: thread.interactionMode,
      createdAt,
    });
  });

  const executeUnsafe = Effect.fn("T3Tasks.executeUnsafe")(function* (
    callerThreadId: ThreadId,
    tool: string,
    rawArguments: unknown,
  ) {
    const args = object(rawArguments);
    const { snapshot, caller, project } = yield* snapshotContext(callerThreadId);

    if (tool === "list") {
      const statusFilter = optionalString(args, "status");
      return {
        tasks: selectOwnedTaskSummaries(caller, snapshot.threads, statusFilter),
      };
    }

    if (tool === "read") {
      const target = ownedTarget(caller, snapshot.threads, requiredString(args, "threadId"));
      const cursorValue = args.cursor;
      const cursor =
        cursorValue === undefined
          ? 0
          : typeof cursorValue === "number" && Number.isInteger(cursorValue) && cursorValue >= 0
            ? cursorValue
            : fail("invalid_arguments", "'cursor' must be a non-negative integer.");
      const limitValue = args.limit;
      const limit =
        limitValue === undefined
          ? MAX_READ_MESSAGES
          : typeof limitValue === "number" &&
              Number.isInteger(limitValue) &&
              limitValue >= 1 &&
              limitValue <= MAX_READ_MESSAGES
            ? limitValue
            : fail("invalid_arguments", `'limit' must be between 1 and ${MAX_READ_MESSAGES}.`);
      const selected: Array<OrchestrationThread["messages"][number]> = [];
      let chars = 0;
      for (const message of target.messages.slice(cursor, cursor + limit)) {
        if (selected.length > 0 && chars + message.text.length > MAX_READ_CHARS) break;
        selected.push({ ...message, text: message.text.slice(0, MAX_READ_CHARS - chars) });
        chars += Math.min(message.text.length, MAX_READ_CHARS - chars);
        if (chars >= MAX_READ_CHARS) break;
      }
      const tail = selected.at(-1);
      const nextCursor =
        tail?.streaming === true ? cursor + selected.length - 1 : cursor + selected.length;
      return {
        threadId: target.id,
        status: threadStatus(target),
        summary: taskSummary(target),
        messages: selected.map((message) => ({
          id: message.id,
          role: message.role,
          text: message.text,
          createdAt: message.createdAt,
          streaming: message.streaming,
        })),
        nextCursor,
        outputToken: tail?.streaming === true ? taskOutputToken(target, nextCursor) : null,
        truncated: nextCursor < target.messages.length,
      };
    }

    if (tool === "wait") {
      const waitsValue = args.tasks;
      if (
        !Array.isArray(waitsValue) ||
        waitsValue.length < 1 ||
        waitsValue.length > MAX_WAIT_BATCH
      ) {
        return fail("invalid_arguments", "'tasks' must contain one to four wait cursors.");
      }
      const waits = waitsValue.map((value) => {
        const wait = object(value);
        const cursorValue = wait.cursor;
        const cursor =
          cursorValue === undefined
            ? 0
            : typeof cursorValue === "number" && Number.isInteger(cursorValue) && cursorValue >= 0
              ? cursorValue
              : fail("invalid_arguments", "Each wait cursor must be a non-negative integer.");
        return {
          threadId: ThreadId.make(requiredString(wait, "threadId")),
          cursor,
          outputToken: optionalString(wait, "outputToken"),
        };
      });
      const ids = waits.map((wait) => wait.threadId);
      for (const id of ids) ownedTarget(caller, snapshot.threads, id);
      const timeoutValue = args.timeoutSeconds;
      const timeoutSeconds =
        timeoutValue === undefined
          ? MAX_WAIT_SECONDS
          : typeof timeoutValue === "number" &&
              Number.isInteger(timeoutValue) &&
              timeoutValue >= 0 &&
              timeoutValue <= MAX_WAIT_SECONDS
            ? timeoutValue
            : fail("invalid_arguments", `'timeoutSeconds' must be between 0 and 60.`);

      const readStatuses = query.getSnapshot().pipe(
        Effect.map((current) =>
          waits.map((wait) => {
            const target = ownedTarget(caller, current.threads, wait.threadId);
            const outputToken = taskOutputToken(target, wait.cursor);
            return {
              threadId: wait.threadId,
              status: threadStatus(target),
              terminal: isTerminal(target),
              outputChanged:
                outputToken !== null &&
                (wait.outputToken === undefined || outputToken !== wait.outputToken),
              nextCursor: wait.cursor,
              outputToken,
            };
          }),
        ),
      );
      const baselineStatuses = waits.map((wait) => {
        const target = ownedTarget(caller, snapshot.threads, wait.threadId);
        const outputToken = taskOutputToken(target, wait.cursor);
        return {
          threadId: wait.threadId,
          status: threadStatus(target),
          terminal: isTerminal(target),
          outputChanged:
            outputToken !== null &&
            (wait.outputToken === undefined || outputToken !== wait.outputToken),
          nextCursor: wait.cursor,
          outputToken,
        };
      });
      const signals = yield* Queue.unbounded<void>();
      // The request snapshot is the baseline. Subscribe before re-reading so
      // a transition is observed either in that read or by a queued event.
      const wake = yield* engine.streamDomainEvents.pipe(
        Stream.filter((event) => ids.includes(event.aggregateId as ThreadId)),
        Stream.runForEach(() => Queue.offer(signals, undefined).pipe(Effect.asVoid)),
        Effect.forkChild,
      );
      let statuses = yield* readStatuses;
      const initiallyChanged =
        baselineStatuses.some((status) => status.terminal || status.outputChanged) ||
        hasTaskWaitChange(baselineStatuses, statuses);
      let timedOut = false;
      if (!initiallyChanged && timeoutSeconds > 0) {
        const completed = yield* Stream.fromQueue(signals).pipe(
          Stream.mapEffect(() => Effect.sleep("25 millis").pipe(Effect.andThen(readStatuses))),
          Stream.filter((current) => hasTaskWaitChange(baselineStatuses, current)),
          Stream.runHead,
          Effect.timeout(Duration.seconds(timeoutSeconds)),
          Effect.option,
        );
        if (Option.isSome(completed) && Option.isSome(completed.value)) {
          statuses = completed.value.value;
        } else {
          timedOut = true;
        }
      } else if (!initiallyChanged) {
        timedOut = true;
      }
      yield* Fiber.interrupt(wake);
      return {
        tasks: statuses,
        timedOut,
      };
    }

    if (tool === "message") {
      const target = ownedTarget(caller, snapshot.threads, requiredString(args, "threadId"));
      if (
        target.latestTurn?.state === "running" ||
        target.session?.status === "starting" ||
        target.session?.status === "running"
      ) {
        return fail(
          "invalid_arguments",
          `Task '${target.id}' is active and cannot accept another message yet.`,
        );
      }
      yield* dispatchTurn(target, requiredString(args, "message"));
      yield* Effect.sleep("25 millis");
      const projected = yield* query.getThreadDetailById(target.id);
      const updated = Option.getOrUndefined(projected);
      return {
        threadId: target.id,
        turnId: updated?.latestTurn?.turnId ?? null,
        status: updated ? threadStatus(updated) : "requested",
      };
    }

    if (tool === "interrupt") {
      const target = ownedTarget(caller, snapshot.threads, requiredString(args, "threadId"));
      yield* engine.dispatch({
        type: "thread.turn.interrupt",
        commandId: yield* commandId,
        threadId: target.id,
        ...(target.latestTurn ? { turnId: target.latestTurn.turnId } : {}),
        createdAt: yield* nowIso,
      });
      return { threadId: target.id, status: "interrupt_requested" };
    }

    if (tool === "pin") {
      const target = ownedTarget(caller, snapshot.threads, requiredString(args, "threadId"));
      if (typeof args.pinned !== "boolean") {
        return fail("invalid_arguments", "'pinned' must be a boolean.");
      }
      yield* engine.dispatch({
        type: "thread.pin.set",
        commandId: yield* commandId,
        threadId: target.id,
        pinned: args.pinned,
      });
      return { threadId: target.id, pinned: args.pinned };
    }

    if (tool === "orchestration") {
      if (caller.taskRelation !== null) {
        return fail("depth_limit", "Only a root orchestrator may change child task orchestration.");
      }
      const target = ownedTarget(caller, snapshot.threads, requiredString(args, "threadId"));
      if (target.taskRelation?.depth !== 1 || target.taskRelation.rootThreadId !== caller.id) {
        return fail(
          "depth_limit",
          `Task '${target.id}' is not a valid direct child of root orchestrator '${caller.id}'.`,
        );
      }
      if (typeof args.enabled !== "boolean") {
        return fail("invalid_arguments", "'enabled' must be a boolean.");
      }
      yield* engine.dispatch({
        type: "thread.task-orchestration.set",
        commandId: yield* commandId,
        threadId: target.id,
        enabled: args.enabled,
      });
      return { threadId: target.id, enabled: args.enabled };
    }

    if (tool !== "create") {
      return fail("invalid_arguments", `Unknown t3_tasks tool '${tool}'.`);
    }

    const taskValues = args.tasks;
    if (
      !Array.isArray(taskValues) ||
      taskValues.length < 1 ||
      taskValues.length > MAX_CREATE_BATCH
    ) {
      return fail(
        "invalid_arguments",
        `'tasks' must contain one to ${createLimitForCaller(caller)} task definitions for this caller.`,
      );
    }
    return yield* executeCreate({
      taskValues,
      caller,
      project,
      threads: snapshot.threads,
      providerSnapshots: yield* providers.getProviders,
      engine,
      git,
      crypto,
    });
  });

  const execute = (call: T3TaskToolCall) =>
    (call.payload.namespace === "t3_tasks"
      ? executeUnsafe(call.callerThreadId, call.payload.tool, call.payload.arguments)
      : Effect.fail(
          new ToolFailure(
            "invalid_arguments",
            "Dynamic task calls must use the 't3_tasks' namespace.",
          ),
        )
    ).pipe(
      Effect.map((result) => jsonResponse(true, result)),
      Effect.catchCause((effectCause) => {
        const cause = Cause.squash(effectCause);
        const failure =
          cause instanceof ToolFailure
            ? cause
            : new ToolFailure(
                "orchestration_failed",
                cause instanceof Error ? cause.message : "Task orchestration failed.",
              );
        return Effect.succeed(
          jsonResponse(false, {
            error: {
              code: failure.code,
              message: failure.message,
            },
          }),
        );
      }),
    );

  const service = T3Tasks.of({ execute });
  installT3TaskToolHandler(service.execute);
  return service;
});

export const T3TasksLive = Layer.effect(T3Tasks, makeT3Tasks);
