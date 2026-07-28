import type { V2ThreadStartParams__DynamicToolSpec } from "effect-codex-app-server/schema";

const functionTool = (
  name: string,
  description: string,
  properties: Record<string, unknown>,
  required: ReadonlyArray<string> = [],
) => ({
  type: "function" as const,
  name,
  description,
  inputSchema: {
    type: "object",
    additionalProperties: false,
    properties,
    ...(required.length > 0 ? { required } : {}),
  },
});

/**
 * Codex app-server only accepts dynamic tools at `thread/start`, so this
 * namespace is advertised on every orchestrator-owned Codex thread. The live
 * handler rechecks the persisted per-thread opt-in on every call.
 */
export const T3_TASK_DYNAMIC_TOOLS: ReadonlyArray<V2ThreadStartParams__DynamicToolSpec> = [
  {
    type: "namespace",
    name: "t3_tasks",
    description:
      "Create and coordinate bounded T3 Code child tasks. Calls are authorized against the persisted parent thread on every invocation.",
    tools: [
      functionTool(
        "create",
        "Create up to four child tasks and start their initial turns.",
        {
          tasks: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                title: { type: "string", minLength: 1, maxLength: 160 },
                prompt: { type: "string", minLength: 1, maxLength: 100000 },
                workspaceMode: { type: "string", enum: ["shared", "isolated"] },
                projectId: { type: "string", minLength: 1 },
                workspacePath: { type: "string", minLength: 1 },
                model: { type: "string", minLength: 1 },
                reasoningEffort: { type: "string", minLength: 1 },
                pinned: { type: "boolean" },
              },
              required: ["prompt"],
            },
          },
        },
        ["tasks"],
      ),
      functionTool("list", "List tasks created by this orchestrator thread.", {
        status: { type: "string", minLength: 1 },
      }),
      functionTool(
        "read",
        "Read bounded projected messages for one owned task.",
        {
          threadId: { type: "string", minLength: 1 },
          cursor: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
        },
        ["threadId"],
      ),
      functionTool(
        "wait",
        "Wait for status changes, new output, or timeout across up to four owned tasks.",
        {
          tasks: {
            type: "array",
            minItems: 1,
            maxItems: 4,
            items: {
              type: "object",
              additionalProperties: false,
              properties: {
                threadId: { type: "string", minLength: 1 },
                cursor: { type: "integer", minimum: 0 },
                outputToken: { type: "string", minLength: 1 },
              },
              required: ["threadId"],
            },
          },
          timeoutSeconds: { type: "integer", minimum: 0, maximum: 60 },
        },
        ["tasks"],
      ),
      functionTool(
        "message",
        "Send a new user turn to one owned task.",
        {
          threadId: { type: "string", minLength: 1 },
          message: { type: "string", minLength: 1, maxLength: 100000 },
        },
        ["threadId", "message"],
      ),
      functionTool(
        "interrupt",
        "Interrupt the active turn of one owned task.",
        { threadId: { type: "string", minLength: 1 } },
        ["threadId"],
      ),
      functionTool(
        "pin",
        "Set the pinned state of one owned task.",
        {
          threadId: { type: "string", minLength: 1 },
          pinned: { type: "boolean" },
        },
        ["threadId", "pinned"],
      ),
    ],
  },
];
