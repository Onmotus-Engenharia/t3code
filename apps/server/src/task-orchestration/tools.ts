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
 * namespaces are advertised on every Codex thread. The live handler rechecks
 * the persisted per-thread opt-in for mutating task-orchestration calls.
 */
export const T3_TASK_DYNAMIC_TOOLS: ReadonlyArray<V2ThreadStartParams__DynamicToolSpec> = [
  {
    type: "namespace",
    name: "t3_threads",
    description:
      "Inspect known T3 Code threads in this environment. These read-only calls work for any known thread ID, not only child tasks.",
    tools: [
      functionTool(
        "read",
        "Read a known thread's bounded conversation, activity/tool-call log, current status, and workspace context.",
        {
          threadId: { type: "string", minLength: 1 },
          cursor: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
          activityCursor: { type: "integer", minimum: 0 },
          activityLimit: { type: "integer", minimum: 1, maximum: 20 },
        },
        ["threadId"],
      ),
      functionTool(
        "wait",
        "Wait for status or output changes on up to four known thread IDs.",
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
    ],
  },
  {
    type: "namespace",
    name: "t3_tasks",
    description:
      "Create and coordinate bounded T3 Code child tasks. Calls are authorized against the persisted parent thread on every invocation.",
    tools: [
      functionTool(
        "create",
        "Create direct child tasks and start their initial turns. Root orchestrators may create up to ten; enabled depth-1 children may create up to four.",
        {
          tasks: {
            type: "array",
            minItems: 1,
            maxItems: 10,
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
      functionTool("list", "List owned tasks, each with contextHealth.", {
        status: { type: "string", minLength: 1 },
      }),
      functionTool(
        "read",
        "Read bounded projected messages, activity/tool-call log, and contextHealth for one owned task.",
        {
          threadId: { type: "string", minLength: 1 },
          cursor: { type: "integer", minimum: 0 },
          limit: { type: "integer", minimum: 1, maximum: 20 },
          activityCursor: { type: "integer", minimum: 0 },
          activityLimit: { type: "integer", minimum: 1, maximum: 20 },
        },
        ["threadId"],
      ),
      functionTool(
        "wait",
        "Wait for status changes, new output, or timeout across up to four owned tasks, returning contextHealth for each task.",
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
        "Immediately before dispatch, recompute contextHealth and reject unsafe reuse with machine-readable error code unsafe_reuse; never create a replacement task server-side.",
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
      functionTool(
        "orchestration",
        "Enable or disable task orchestration on an owned direct child. Only a root orchestrator may use this operation.",
        {
          threadId: { type: "string", minLength: 1 },
          enabled: { type: "boolean" },
        },
        ["threadId", "enabled"],
      ),
    ],
  },
];
