import * as Context from "effect/Context";
import type * as Effect from "effect/Effect";

import type { T3TaskToolCall } from "./T3TaskToolBridge.ts";
import type { DynamicToolCallResponse } from "effect-codex-app-server/schema";

export interface T3TasksShape {
  readonly execute: (call: T3TaskToolCall) => Effect.Effect<DynamicToolCallResponse, never>;
}

export class T3Tasks extends Context.Service<T3Tasks, T3TasksShape>()(
  "t3/task-orchestration/Services/T3Tasks",
) {}
