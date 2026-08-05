import { describe, expect, it, vi } from "vite-plus/test";
import {
  createThreadSplitStore,
  getAvailableTaskDescendants,
  repairPersistedThreadSplitState,
  THREAD_SPLIT_MAX_PANES,
  THREAD_SPLIT_STORAGE_KEY,
  type ThreadSplitCatalogThread,
  type ThreadSplitStorage,
  type ThreadSplitTargetKey,
} from "./threadSplitStore";

const server = (environment: string, thread: string) =>
  `server:${environment}:${thread}` as ThreadSplitTargetKey;
const draft = (id: string) => `draft:${id}` as ThreadSplitTargetKey;

function memoryStorage(initial?: unknown): ThreadSplitStorage & { value: string | null } {
  return {
    value: initial === undefined ? null : JSON.stringify(initial),
    getItem: vi.fn(function (this: { value: string | null }) {
      return this.value;
    }),
    setItem: vi.fn(function (this: { value: string | null }, _key: string, value: string) {
      this.value = value;
    }),
  };
}

function makeStore(initial?: unknown) {
  let id = 0;
  return createThreadSplitStore({
    storage: memoryStorage(initial),
    createGroupId: () => `group-${++id}`,
  });
}

function descendants(root: ThreadSplitTargetKey, count: number): ThreadSplitCatalogThread[] {
  const rootThreadKey = root.slice("server:".length);
  return Array.from({ length: count }, (_, index) => ({
    targetKey: server("env", `child-${index + 1}`),
    rootThreadKey,
    updatedAt: index,
    treeOrder: index,
  }));
}

function catalog(threads: readonly ThreadSplitCatalogThread[]) {
  return {
    environmentCatalogHydrated: true,
    environments: { env: { threadCatalogHydrated: true } },
    threads,
    draftsHydrated: true,
    draftTargetKeys: [] as ThreadSplitTargetKey[],
  };
}

describe("thread split groups", () => {
  it("creates, adds, reorders, removes, closes, and dissolves groups", () => {
    const store = makeStore();
    const a = server("env", "a");
    const b = server("env", "b");
    const c = server("env", "c");
    const id = store.getState().openTargets([a, b]);

    expect(id).toBe("group-1");
    store.getState().openTargets([c], { groupId: id!, mode: "add", afterTargetKey: a });
    expect(store.getState().groups[id!]?.targetKeys).toEqual([a, c, b]);

    store.getState().configureGroup(id!, { targetKeys: [b, a, c], layoutMode: "rows" });
    expect(store.getState().groups[id!]).toMatchObject({
      targetKeys: [b, a, c],
      layoutMode: "rows",
    });

    store.getState().removeTarget(a);
    expect(store.getState().groups[id!]?.targetKeys).toEqual([b, c]);
    store.getState().removeTarget(b);
    expect(store.getState().groups[id!]).toBeUndefined();

    const next = store.getState().openTargets([a, b]);
    store.getState().closeGroup(next!);
    expect(store.getState().groupOrder).toEqual([]);
  });

  it("supports cross-project/environment targets and unique ownership across groups", () => {
    const store = makeStore();
    const a = server("local", "project-a-thread");
    const b = server("remote", "project-b-thread");
    const c = server("local", "other");
    const d = draft("new");
    const first = store.getState().openTargets([a, b])!;
    const second = store.getState().openTargets([c, d])!;

    store.getState().openTargets([b], { groupId: second, mode: "add" });

    expect(store.getState().groups[first]).toBeUndefined();
    expect(store.getState().groups[second]?.targetKeys).toEqual([c, d, b]);
    expect(store.getState().groupOrder).toEqual([second]);
  });

  it("enforces the fifty-pane cap and assigns normalized average weights", () => {
    const store = makeStore();
    const targets = Array.from({ length: THREAD_SPLIT_MAX_PANES + 2 }, (_, index) =>
      server("env", `${index}`),
    );
    const id = store.getState().openTargets(targets)!;
    const group = store.getState().groups[id]!;

    expect(group.targetKeys).toHaveLength(THREAD_SPLIT_MAX_PANES);
    expect(group.weights.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    expect(new Set(group.weights).size).toBe(1);
  });

  it("does not evict a target from its current group when the destination is full", () => {
    const store = makeStore();
    const fullTargets = Array.from({ length: THREAD_SPLIT_MAX_PANES }, (_, index) =>
      server("env", `full-${index}`),
    );
    const moving = server("env", "moving");
    const peer = server("env", "peer");
    const full = store.getState().openTargets(fullTargets)!;
    const source = store.getState().openTargets([moving, peer])!;

    store.getState().openTargets([moving], { groupId: full, mode: "add" });

    expect(store.getState().groups[full]?.targetKeys).not.toContain(moving);
    expect(store.getState().groups[source]?.targetKeys).toContain(moving);
  });

  it("focuses an existing destination member instead of duplicating it during replacement", () => {
    const store = makeStore();
    const a = server("env", "a");
    const b = server("env", "b");
    const c = server("env", "c");
    const id = store.getState().openTargets([a, b, c])!;
    store.getState().focusTarget(a);

    store.getState().openTargets([c], { groupId: id, mode: "replace-focused" });

    expect(store.getState().groups[id]?.targetKeys).toEqual([a, b, c]);
    expect(store.getState().groups[id]?.focusedTargetKey).toBe(c);
  });

  it("does not publish when the requested target is already focused", () => {
    const store = makeStore();
    const a = server("env", "a");
    const b = server("env", "b");
    store.getState().openTargets([a, b], { focusTargetKey: a });
    const listener = vi.fn();
    const unsubscribe = store.subscribe(listener);

    store.getState().focusTarget(a);

    expect(listener).not.toHaveBeenCalled();
    unsubscribe();
  });

  it("repairs focus, malformed weights, invalid groups, and duplicate ownership", () => {
    const a = server("env", "a");
    const b = server("env", "b");
    const c = server("env", "c");
    const repaired = repairPersistedThreadSplitState({
      version: 999,
      groupOrder: ["one", "two", "bad"],
      activeGroupId: "missing",
      groups: {
        one: {
          id: "wrong",
          targetKeys: [a, b, b],
          focusedTargetKey: c,
          layoutMode: "wat",
          weights: [NaN, -1],
        },
        two: {
          id: "two",
          targetKeys: [b, c],
          focusedTargetKey: b,
          layoutMode: "columns",
          weights: [3, 1],
        },
        bad: { targetKeys: [draft("only")] },
      },
    });

    expect(repaired.version).toBe(1);
    expect(repaired.groupOrder).toEqual(["one"]);
    expect(repaired.activeGroupId).toBe("one");
    expect(repaired.groups.one).toMatchObject({
      id: "one",
      targetKeys: [a, b],
      focusedTargetKey: a,
      layoutMode: "auto",
      weights: [0.5, 0.5],
    });
  });

  it("hydrates and persists the versioned local state", () => {
    const a = server("env", "a");
    const b = server("env", "b");
    const storage = memoryStorage({
      version: 1,
      groupOrder: ["saved"],
      activeGroupId: "saved",
      groups: {
        saved: {
          id: "saved",
          targetKeys: [a, b],
          focusedTargetKey: b,
          layoutMode: "columns",
          weights: [1, 3],
        },
      },
    });
    const store = createThreadSplitStore({ storage });

    expect(store.getState().groups.saved?.weights).toEqual([0.25, 0.75]);
    store.getState().focusTarget(a);
    expect(storage.setItem).toHaveBeenCalledWith(THREAD_SPLIT_STORAGE_KEY, expect.any(String));
    expect(JSON.parse(storage.value!).groups.saved.focusedTargetKey).toBe(a);
  });

  it("normalizes persisted grid settings without changing an existing layout mode", () => {
    const a = server("env", "a");
    const b = server("env", "b");
    const repaired = repairPersistedThreadSplitState({
      version: 1,
      groupOrder: ["saved"],
      activeGroupId: "saved",
      groups: {
        saved: {
          targetKeys: [a, b],
          focusedTargetKey: a,
          layoutMode: "columns",
          gridColumns: 99,
          gridRows: 0,
          weights: [1, 1],
        },
      },
    });

    expect(repaired.groups.saved).toMatchObject({
      layoutMode: "columns",
      gridColumns: 12,
      gridRows: 1,
    });
  });

  it("logs persistence failure once while retaining memory state", () => {
    const onPersistenceError = vi.fn();
    const storage = memoryStorage();
    storage.setItem = vi.fn(() => {
      throw new Error("quota");
    });
    const store = createThreadSplitStore({ storage, onPersistenceError });
    const a = server("env", "a");
    const b = server("env", "b");
    const c = server("env", "c");
    const id = store.getState().openTargets([a, b])!;
    store.getState().openTargets([c], { groupId: id, mode: "add" });

    expect(store.getState().groups[id]?.targetKeys).toEqual([a, b, c]);
    expect(onPersistenceError).toHaveBeenCalledTimes(1);
  });

  it("preserves focus and weights while promoting a draft", () => {
    const store = makeStore();
    const a = server("env", "a");
    const pending = draft("pending");
    const promoted = server("env", "promoted");
    const id = store.getState().openTargets([a, pending])!;
    store.getState().configureGroup(id, { weights: [1, 3] });
    store.getState().focusTarget(pending);

    store.getState().promoteDraftTarget(pending, promoted);

    expect(store.getState().groups[id]).toMatchObject({
      targetKeys: [a, promoted],
      focusedTargetKey: promoted,
      weights: [0.25, 0.75],
    });
  });

  it("collapses a same-group canonical collision at the promoted draft position", () => {
    const store = makeStore();
    const a = server("env", "a");
    const pending = draft("pending");
    const b = server("env", "b");
    const promoted = server("env", "promoted");
    const id = store.getState().openTargets([a, pending, b, promoted])!;
    store.getState().configureGroup(id, { weights: [1, 4, 3, 2] });
    store.getState().focusTarget(pending);

    store.getState().promoteDraftTarget(pending, promoted);

    expect(store.getState().groups[id]).toMatchObject({
      targetKeys: [a, promoted, b],
      focusedTargetKey: promoted,
    });
    expect(store.getState().groups[id]?.weights[0]).toBeCloseTo(0.125);
    expect(store.getState().groups[id]?.weights[1]).toBeCloseTo(0.5);
    expect(store.getState().groups[id]?.weights[2]).toBeCloseTo(0.375);
    expect(new Set(store.getState().groups[id]?.targetKeys).size).toBe(3);
  });

  it("moves a cross-group canonical target without changing the promoted draft slot", () => {
    const store = makeStore();
    const a = server("env", "a");
    const pending = draft("pending");
    const promoted = server("env", "promoted");
    const source = store.getState().openTargets([a, pending])!;
    const other = store.getState().openTargets([promoted, server("env", "peer")])!;
    store.getState().configureGroup(source, { weights: [1, 3] });
    store.getState().focusTarget(pending);

    store.getState().promoteDraftTarget(pending, promoted);

    expect(store.getState().groups[source]).toMatchObject({
      targetKeys: [a, promoted],
      focusedTargetKey: promoted,
      weights: [0.25, 0.75],
    });
    expect(store.getState().groups[other]).toBeUndefined();
  });
});

describe("catalog reconciliation", () => {
  it("preserves disconnected catalogs but prunes hydrated missing threads and drafts", () => {
    const store = makeStore();
    const existing = server("env", "existing");
    const missing = server("env", "missing");
    const pending = draft("pending");
    const id = store.getState().openTargets([existing, missing, pending])!;

    store.getState().reconcile({
      environmentCatalogHydrated: true,
      environments: { env: { threadCatalogHydrated: false } },
      threads: [],
      draftsHydrated: false,
      draftTargetKeys: [],
    });
    expect(store.getState().groups[id]?.targetKeys).toEqual([existing, missing, pending]);

    store.getState().reconcile({
      environmentCatalogHydrated: true,
      environments: { env: { threadCatalogHydrated: true } },
      threads: [{ targetKey: existing, treeOrder: 0 }],
      draftsHydrated: true,
      draftTargetKeys: [],
    });
    expect(store.getState().groups[id]).toBeUndefined();
  });

  it("preserves an unbootstrapped absent environment, then prunes after catalog hydration", () => {
    const store = makeStore();
    const a = server("remote", "a");
    const b = server("remote", "b");
    const id = store.getState().openTargets([a, b])!;

    store.getState().reconcile({
      environmentCatalogHydrated: false,
      environments: {},
      threads: [],
      draftsHydrated: false,
      draftTargetKeys: [],
    });
    expect(store.getState().groups[id]).toBeDefined();

    store.getState().reconcile({
      environmentCatalogHydrated: true,
      environments: {},
      threads: [],
      draftsHydrated: false,
      draftTargetKeys: [],
    });
    expect(store.getState().groups[id]).toBeUndefined();
  });
});

describe("task-tree binding", () => {
  it("keeps the root first and selects descendants through the fifty-pane cap", () => {
    const store = makeStore();
    const root = server("env", "root");
    const entries = descendants(root, THREAD_SPLIT_MAX_PANES + 1);
    entries[0]!.updatedAt = 100;
    const result = store.getState().openTaskTree(root, entries);
    const group = store.getState().groups[result.groupId!]!;

    expect(result.omittedCount).toBe(2);
    expect(group.targetKeys[0]).toBe(root);
    expect(group.targetKeys).toHaveLength(THREAD_SPLIT_MAX_PANES);
    expect(group.targetKeys).toContain(entries[0]!.targetKey);
    expect(group.targetKeys).not.toContain(entries[1]!.targetKey);
    expect(group.taskTreeBinding?.observedDescendantKeys).toHaveLength(THREAD_SPLIT_MAX_PANES + 1);
  });

  it("converts the root's manual group and reuses an existing task-bound group", () => {
    const store = makeStore();
    const root = server("env", "root");
    const peer = server("env", "peer");
    const manual = store.getState().openTargets([peer, root])!;
    const entries = descendants(root, 2);

    expect(store.getState().openTaskTree(root, entries).groupId).toBe(manual);
    expect(store.getState().openTaskTree(root, entries).groupId).toBe(manual);
    expect(store.getState().groups[manual]?.targetKeys[0]).toBe(root);
  });

  it("auto-adds only genuinely new descendants and records every observation", () => {
    const store = makeStore();
    const root = server("env", "root");
    const initial = descendants(root, 1);
    const id = store.getState().openTaskTree(root, initial).groupId!;
    const next = descendants(root, 3);

    store.getState().reconcile(catalog([{ targetKey: root, treeOrder: 0 }, ...next]));

    expect(store.getState().groups[id]?.targetKeys).toEqual([
      root,
      initial[0]!.targetKey,
      next[1]!.targetKey,
      next[2]!.targetKey,
    ]);
    expect(store.getState().groups[id]?.taskTreeBinding?.observedDescendantKeys).toHaveLength(3);
  });

  it("records exclusions and manual re-addition clears them", () => {
    const store = makeStore();
    const root = server("env", "root");
    const entries = descendants(root, 2);
    const id = store.getState().openTaskTree(root, entries).groupId!;
    const removed = entries[0]!.targetKey;

    store.getState().removeTarget(removed);
    expect(store.getState().groups[id]?.taskTreeBinding?.excludedDescendantKeys).toContain(
      removed.slice("server:".length),
    );
    store.getState().reconcile(catalog([{ targetKey: root, treeOrder: 0 }, ...entries]));
    expect(store.getState().groups[id]?.targetKeys).not.toContain(removed);

    store.getState().openTargets([removed], { groupId: id, mode: "add" });
    expect(store.getState().groups[id]?.taskTreeBinding?.excludedDescendantKeys).not.toContain(
      removed.slice("server:".length),
    );
  });

  it("observes descendants discovered while full without later silently filling a slot", () => {
    const store = makeStore();
    const root = server("env", "root");
    const initial = descendants(root, THREAD_SPLIT_MAX_PANES - 1);
    const id = store.getState().openTaskTree(root, initial).groupId!;
    const later = descendants(root, THREAD_SPLIT_MAX_PANES);
    const omitted = later[THREAD_SPLIT_MAX_PANES - 1]!;

    store.getState().reconcile(catalog([{ targetKey: root, treeOrder: 0 }, ...later]));
    expect(store.getState().groups[id]?.targetKeys).not.toContain(omitted.targetKey);
    expect(store.getState().groups[id]?.taskTreeBinding?.observedDescendantKeys).toContain(
      omitted.targetKey.slice("server:".length),
    );

    store.getState().removeTarget(initial[0]!.targetKey);
    store.getState().reconcile(catalog([{ targetKey: root, treeOrder: 0 }, ...later]));
    expect(store.getState().groups[id]?.targetKeys).not.toContain(omitted.targetKey);
    expect(getAvailableTaskDescendants(store.getState(), id, later)).toContainEqual(omitted);
  });

  it("drops a deleted root binding while preserving a viable manual group", () => {
    const store = makeStore();
    const root = server("env", "root");
    const entries = descendants(root, 3);
    const id = store.getState().openTaskTree(root, entries).groupId!;

    store.getState().reconcile(catalog(entries));

    expect(store.getState().groups[id]?.targetKeys).toEqual(
      entries.map((entry) => entry.targetKey),
    );
    expect(store.getState().groups[id]?.taskTreeBinding).toBeUndefined();
  });
});
