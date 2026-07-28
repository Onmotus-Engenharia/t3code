import type { ThreadId } from "@t3tools/contracts";
import * as Effect from "effect/Effect";
import type {
  DynamicToolCallParams,
  DynamicToolCallResponse,
} from "effect-codex-app-server/schema";

export interface T3TaskToolCall {
  readonly callerThreadId: ThreadId;
  readonly payload: DynamicToolCallParams;
}

export type T3TaskToolHandler = (
  call: T3TaskToolCall,
) => Effect.Effect<DynamicToolCallResponse, never>;

let handler: T3TaskToolHandler = () =>
  Effect.succeed({
    success: false,
    contentItems: [
      {
        type: "inputText",
        text: JSON.stringify({
          error: {
            code: "task_orchestration_unavailable",
            message: "T3 task orchestration is not available in this server runtime.",
          },
        }),
      },
    ],
  });

export const executeT3TaskTool: T3TaskToolHandler = (call) => handler(call);

export const installT3TaskToolHandler = (next: T3TaskToolHandler): void => {
  handler = next;
};
