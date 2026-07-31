import { scopeThreadRef } from "@t3tools/client-runtime/environment";
import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it, vi } from "vite-plus/test";
import { DraftId } from "./composerDraftStore";
import {
  createSplitThreadNavigation,
  createStandaloneThreadNavigation,
  restoreSplitGroupForRoute,
  type ThreadRouteNavigator,
} from "./threadSplitNavigation";
import { createThreadSplitStore } from "./threadSplitStore";

const serverTarget = (environmentId: string, threadId: string) =>
  ({
    kind: "server",
    threadRef: scopeThreadRef(environmentId as never, ThreadId.make(threadId)),
  }) as const;
const draftTarget = (draftId: string) =>
  ({ kind: "draft", draftId: DraftId.make(draftId) }) as const;

function setup() {
  const store = createThreadSplitStore({
    storage: null,
    createGroupId: (() => {
      let sequence = 0;
      return () => `group-${++sequence}`;
    })(),
  });
  const calls: Array<{
    target: ReturnType<typeof serverTarget> | ReturnType<typeof draftTarget>;
    history: string;
  }> = [];
  const router: ThreadRouteNavigator = {
    navigate: vi.fn(async (target, history) => {
      calls.push({ target: target as (typeof calls)[number]["target"], history });
    }),
  };
  return { calls, router, store };
}

describe("thread split navigation", () => {
  it("restores the owning local group for a direct route target", () => {
    const { store } = setup();
    const first = serverTarget("env-a", "one");
    const second = serverTarget("env-b", "two");
    store.getState().openTargets(["server:env-a:one", "server:env-b:two"], {
      focusTargetKey: "server:env-a:one",
    });

    expect(restoreSplitGroupForRoute(store.getState(), second)).toBe("group-1");
    expect(restoreSplitGroupForRoute(store.getState(), draftTarget("other"))).toBeNull();
    expect(first.kind).toBe("server");
  });

  it("uses pushed navigation for activation and replacement history for pane focus", async () => {
    const { calls, router, store } = setup();
    store.getState().openTargets(["server:env:one", "server:env:two"]);
    const navigation = createSplitThreadNavigation({
      getRouteTarget: () => serverTarget("env", "one"),
      router,
      store,
    });

    await navigation.openTarget(serverTarget("env", "two"));
    await navigation.openTarget(serverTarget("env", "one"), { history: "replace" });

    expect(calls.map(({ history }) => history)).toEqual(["push", "replace"]);
    expect(store.getState().groups["group-1"]?.focusedTargetKey).toBe("server:env:one");
  });

  it("replaces only the focused pane for internal navigation", async () => {
    const { router, store } = setup();
    store.getState().openTargets(["server:env:one", "server:env:two", "server:env:three"], {
      focusTargetKey: "server:env:two",
    });
    const navigation = createSplitThreadNavigation({
      getRouteTarget: () => serverTarget("env", "two"),
      router,
      store,
    });

    await navigation.openTarget(draftTarget("new"), {
      disposition: "replace-focused-pane",
      history: "replace",
    });

    expect(store.getState().groups["group-1"]?.targetKeys).toEqual([
      "server:env:one",
      "draft:new",
      "server:env:three",
    ]);
    expect(store.getState().groups["group-1"]?.focusedTargetKey).toBe("draft:new");
  });

  it("activates another owning group instead of stealing its target", async () => {
    const { router, store } = setup();
    store.getState().openTargets(["server:env:one", "server:env:two"]);
    store.getState().openTargets(["server:env:three", "server:env:four"]);
    store.getState().focusTarget("server:env:one");
    const navigation = createSplitThreadNavigation({
      getRouteTarget: () => serverTarget("env", "one"),
      router,
      store,
    });

    await navigation.openTarget(serverTarget("env", "four"), {
      disposition: "replace-focused-pane",
    });

    expect(store.getState().activeGroupId).toBe("group-2");
    expect(store.getState().groups["group-1"]?.targetKeys).toEqual([
      "server:env:one",
      "server:env:two",
    ]);
  });

  it("opens standalone without deleting saved groups", async () => {
    const { router, store } = setup();
    store.getState().openTargets(["server:env:one", "server:env:two"]);
    const navigation = createSplitThreadNavigation({
      getRouteTarget: () => serverTarget("env", "one"),
      router,
      store,
    });

    await navigation.openTarget(serverTarget("env", "outside"), {
      disposition: "standalone",
    });

    expect(store.getState().groupOrder).toEqual(["group-1"]);
    expect(store.getState().groups["group-1"]?.targetKeys).toHaveLength(2);
  });

  it("reads an ungrouped route target after a previously active split", () => {
    const { router, store } = setup();
    store.getState().openTargets(["server:env:one", "server:env:two"], {
      focusTargetKey: "server:env:two",
    });
    const standaloneTarget = serverTarget("env", "outside");
    const navigation = createSplitThreadNavigation({
      getRouteTarget: () => standaloneTarget,
      router,
      store,
    });

    expect(store.getState().activeGroupId).toBe("group-1");
    expect(navigation.getFocusedTarget()).toEqual(standaloneTarget);
  });

  it("keeps internal replacement from a standalone route out of inactive groups", async () => {
    const { calls, router, store } = setup();
    store.getState().openTargets(["server:env:one", "server:env:two"], {
      focusTargetKey: "server:env:two",
    });
    const navigation = createSplitThreadNavigation({
      getRouteTarget: () => serverTarget("env", "outside"),
      router,
      store,
    });

    await navigation.openTarget(draftTarget("standalone-child"), {
      disposition: "replace-focused-pane",
      history: "replace",
    });

    expect(store.getState().groups["group-1"]?.targetKeys).toEqual([
      "server:env:one",
      "server:env:two",
    ]);
    expect(store.getState().groups["group-1"]?.focusedTargetKey).toBe("server:env:two");
    expect(calls).toEqual([
      {
        target: draftTarget("standalone-child"),
        history: "replace",
      },
    ]);
  });

  it("promotes a grouped draft atomically before canonical replacement navigation", async () => {
    const { store } = setup();
    store.getState().openTargets(["draft:new", "server:env:other"], {
      focusTargetKey: "draft:new",
    });
    const observedKeys: string[][] = [];
    const router: ThreadRouteNavigator = {
      async navigate() {
        observedKeys.push(store.getState().groups["group-1"]?.targetKeys ?? []);
      },
    };
    const navigation = createSplitThreadNavigation({
      getRouteTarget: () => draftTarget("new"),
      router,
      store,
    });

    await navigation.promoteDraft(DraftId.make("new"), serverTarget("env", "canonical"));

    expect(observedKeys).toEqual([["server:env:canonical", "server:env:other"]]);
    expect(store.getState().groups["group-1"]?.focusedTargetKey).toBe("server:env:canonical");
  });

  it("keeps standalone navigation independent of split state", async () => {
    const { calls, router } = setup();
    const routeTarget = draftTarget("current");
    const navigation = createStandaloneThreadNavigation({
      getRouteTarget: () => routeTarget,
      router,
    });

    expect(navigation.getFocusedTarget()).toEqual(routeTarget);
    await navigation.openTarget(serverTarget("env", "next"), { history: "replace" });
    expect(calls[0]?.history).toBe("replace");
  });
});
