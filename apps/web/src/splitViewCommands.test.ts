import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { EnvironmentId, ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ThreadNavigation } from "./threadSplitNavigation";
import {
  buildSplitTaskCatalog,
  executeSplitViewCommand,
  resolveFocusedSplitViewContext,
} from "./splitViewCommands";
import { createThreadSplitStore } from "./threadSplitStore";

const environmentId = EnvironmentId.make("environment-1");
const rootId = ThreadId.make("root");
const childId = ThreadId.make("child");
const otherId = ThreadId.make("other");
const rootTarget = { kind: "server" as const, threadRef: scopeThreadRef(environmentId, rootId) };
const childTarget = { kind: "server" as const, threadRef: scopeThreadRef(environmentId, childId) };
const otherTarget = { kind: "server" as const, threadRef: scopeThreadRef(environmentId, otherId) };
const rootKey = `server:${environmentId}:${rootId}` as const;
const childKey = `server:${environmentId}:${childId}` as const;
const otherKey = `server:${environmentId}:${otherId}` as const;

const threads = [
  { environmentId, id: rootId, updatedAt: "2026-01-01", taskRelation: null },
  {
    environmentId,
    id: childId,
    updatedAt: "2026-01-02",
    taskRelation: { rootThreadId: rootId },
  },
  { environmentId, id: otherId, updatedAt: "2026-01-03", taskRelation: null },
] as const;

function setup() {
  const store = createThreadSplitStore({ storage: null, createGroupId: () => "group-1" });
  const groupId = store
    .getState()
    .openTargets([rootKey, childKey, otherKey], { focusTargetKey: childKey })!;
  const openTarget = vi.fn(async () => undefined);
  const navigation: ThreadNavigation = {
    getFocusedTarget: () => childTarget,
    openTarget,
    promoteDraft: vi.fn(async () => undefined),
  };
  return { store, groupId, navigation, openTarget };
}

describe("resolveFocusedSplitViewContext", () => {
  it("uses the active group's focused target instead of the URL target", () => {
    const { store, groupId } = setup();
    const context = resolveFocusedSplitViewContext(store.getState(), rootTarget);

    expect(context.splitViewActive).toBe(true);
    expect(context.group?.id).toBe(groupId);
    expect(context.focusedTarget).toEqual(childTarget);
    expect(context.focusedTargetKey).toBe(childKey);
  });

  it("falls back to the route target without an active split", () => {
    const store = createThreadSplitStore({ storage: null });
    expect(resolveFocusedSplitViewContext(store.getState(), rootTarget)).toEqual({
      focusedTarget: rootTarget,
      focusedTargetKey: null,
      group: null,
      splitViewActive: false,
    });
  });

  it("ignores a saved active group when the route target is standalone", () => {
    const { store } = setup();
    const standaloneTarget = {
      kind: "draft" as const,
      draftId: "standalone-draft" as never,
    };

    expect(resolveFocusedSplitViewContext(store.getState(), standaloneTarget)).toEqual({
      focusedTarget: standaloneTarget,
      focusedTargetKey: null,
      group: null,
      splitViewActive: false,
    });
  });
});

describe("executeSplitViewCommand", () => {
  it("focuses previous and next panes cyclically through navigation", async () => {
    const { store, navigation, openTarget } = setup();

    await executeSplitViewCommand({
      command: "splitView.focusPrevious",
      state: store.getState(),
      navigation,
      routeTarget: rootTarget,
      threads,
    });
    expect(openTarget).toHaveBeenLastCalledWith(rootTarget, {
      history: "replace",
      disposition: "activate-existing-group",
    });

    store.getState().focusTarget(rootKey);
    await executeSplitViewCommand({
      command: "splitView.focusPrevious",
      state: store.getState(),
      navigation,
      routeTarget: rootTarget,
      threads,
    });
    expect(openTarget).toHaveBeenLastCalledWith(otherTarget, {
      history: "replace",
      disposition: "activate-existing-group",
    });

    store.getState().focusTarget(childKey);
    await executeSplitViewCommand({
      command: "splitView.focusNext",
      state: store.getState(),
      navigation,
      routeTarget: rootTarget,
      threads,
    });
    expect(openTarget).toHaveBeenLastCalledWith(otherTarget, {
      history: "replace",
      disposition: "activate-existing-group",
    });
  });

  it("executes remove, close, and every layout command", async () => {
    const { store, groupId, navigation } = setup();
    for (const [command, mode] of [
      ["splitView.layoutAuto", "auto"],
      ["splitView.layoutColumns", "columns"],
      ["splitView.layoutRows", "rows"],
    ] as const) {
      await executeSplitViewCommand({
        command,
        state: store.getState(),
        navigation,
        routeTarget: rootTarget,
        threads,
      });
      expect(store.getState().groups[groupId]?.layoutMode).toBe(mode);
    }

    await executeSplitViewCommand({
      command: "splitView.removeFocusedPane",
      state: store.getState(),
      navigation,
      routeTarget: rootTarget,
      threads,
    });
    expect(store.getState().groups[groupId]?.targetKeys).toEqual([rootKey, otherKey]);

    await executeSplitViewCommand({
      command: "splitView.closeGroup",
      state: store.getState(),
      navigation,
      routeTarget: rootTarget,
      threads,
    });
    expect(store.getState().groups[groupId]).toBeUndefined();
  });

  it("binds the focused task tree using the full catalog", async () => {
    const { store, groupId, navigation } = setup();

    await executeSplitViewCommand({
      command: "splitView.toggleTaskTree",
      state: store.getState(),
      navigation,
      routeTarget: rootTarget,
      threads,
    });

    expect(store.getState().groups[groupId]?.taskTreeBinding?.rootThreadKey).toBe(
      `${environmentId}:${rootId}`,
    );
    expect(buildSplitTaskCatalog(threads)).toEqual([
      { targetKey: rootKey, rootThreadKey: null, updatedAt: "2026-01-01", treeOrder: 0 },
      {
        targetKey: childKey,
        rootThreadKey: `${environmentId}:${rootId}`,
        updatedAt: "2026-01-02",
        treeOrder: 1,
      },
      { targetKey: otherKey, rootThreadKey: null, updatedAt: "2026-01-03", treeOrder: 2 },
    ]);
  });
});
