import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { describe, expect, it } from "vite-plus/test";
import {
  EnvironmentId,
  ProjectId,
  ProviderInstanceId,
  ThreadId,
  type ServerConfig,
} from "@t3tools/contracts";

import { deriveThreadOrchestrationControlModel } from "./thread-orchestration-controls";

const environmentId = EnvironmentId.make("environment");
const projectId = ProjectId.make("project");

function thread(
  id: string,
  overrides: Partial<EnvironmentThreadShell> = {},
): EnvironmentThreadShell {
  return {
    environmentId,
    id: ThreadId.make(id),
    projectId,
    title: id,
    modelSelection: { instanceId: ProviderInstanceId.make("codex"), model: "gpt-5.4" },
    runtimeMode: "full-access",
    interactionMode: "default",
    branch: null,
    worktreePath: null,
    latestTurn: null,
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    archivedAt: null,
    settledOverride: null,
    settledAt: null,
    snoozedUntil: null,
    snoozedAt: null,
    taskOrchestrationEnabled: false,
    taskRelation: null,
    pinned: false,
    session: null,
    latestUserMessageAt: null,
    hasPendingApprovals: false,
    hasPendingUserInput: false,
    hasActionableProposedPlan: false,
    ...overrides,
  } as EnvironmentThreadShell;
}

function config(driver = "codex"): ServerConfig {
  return {
    providers: [
      {
        instanceId: ProviderInstanceId.make("codex"),
        driver,
        enabled: true,
        installed: true,
        availability: "available",
      },
    ],
  } as unknown as ServerConfig;
}

describe("deriveThreadOrchestrationControlModel", () => {
  it("shows both reverse states for supported Codex threads", () => {
    expect(
      deriveThreadOrchestrationControlModel({
        thread: thread("root"),
        threadShells: [],
        serverConfig: config(),
        pending: false,
      }),
    ).toMatchObject({ showControl: true, enabled: false, toggleLabel: "Tasks off" });

    expect(
      deriveThreadOrchestrationControlModel({
        thread: thread("root", { taskOrchestrationEnabled: true }),
        threadShells: [],
        serverConfig: config(),
        pending: true,
      }),
    ).toMatchObject({
      showControl: true,
      enabled: true,
      toggleLabel: "Updating task orchestration",
    });
  });

  it("hides control for unsupported providers", () => {
    const model = deriveThreadOrchestrationControlModel({
      thread: thread("root"),
      threadShells: [],
      serverConfig: config("claudeAgent"),
      pending: false,
    });

    expect(model.showControl).toBe(false);
  });

  it("resolves parent only inside same environment and project", () => {
    const child = thread("child", {
      taskRelation: {
        parentThreadId: ThreadId.make("parent"),
        rootThreadId: ThreadId.make("parent"),
        depth: 1,
        workspaceMode: "shared",
        createdBy: "agent",
      },
    });
    const parent = thread("parent");

    expect(
      deriveThreadOrchestrationControlModel({
        thread: child,
        threadShells: [parent],
        serverConfig: config(),
        pending: false,
      }),
    ).toMatchObject({
      parentTarget: { environmentId, threadId: parent.id },
      hasStaleParent: false,
    });

    expect(
      deriveThreadOrchestrationControlModel({
        thread: child,
        threadShells: [],
        serverConfig: config(),
        pending: false,
      }),
    ).toMatchObject({ parentTarget: null, hasStaleParent: true });
  });
});
