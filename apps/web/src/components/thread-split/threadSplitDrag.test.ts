import { describe, expect, it, vi } from "vite-plus/test";
import {
  createThreadSplitStore,
  THREAD_SPLIT_MAX_PANES,
  type PersistedThreadSplitState,
  type ThreadSplitGroup,
  type ThreadSplitTargetKey,
} from "../../threadSplitStore";
import {
  applyThreadSplitDrop,
  resolveThreadSplitDrop,
  threadSplitDragData,
  threadSplitGroupCardData,
  threadSplitGroupDropData,
  threadSplitTargetDropData,
} from "./threadSplitDrag";

const key = (id: string) => `draft:${id}` as ThreadSplitTargetKey;
const group = (id: string, ids: string[]): ThreadSplitGroup => ({
  id,
  targetKeys: ids.map(key),
  focusedTargetKey: key(ids[0]!),
  layoutMode: "auto",
  weights: ids.map(() => 1 / ids.length),
});
const state = (...groups: ThreadSplitGroup[]): PersistedThreadSplitState => ({
  version: 1,
  groupOrder: groups.map((item) => item.id),
  groups: Object.fromEntries(groups.map((item) => [item.id, item])),
  activeGroupId: groups[0]?.id ?? null,
});

describe("thread split drag coordination", () => {
  it("creates [drop target, dragged target] for two ungrouped threads", () => {
    expect(
      resolveThreadSplitDrop(
        state(),
        threadSplitDragData(key("a"), "A"),
        threadSplitTargetDropData(key("b")),
      ),
    ).toEqual({
      accepted: true,
      intent: { type: "create", targetKeys: [key("b"), key("a")], focusTargetKey: key("a") },
    });
  });

  it("inserts after a grouped member and moves only the dragged member", () => {
    expect(
      resolveThreadSplitDrop(
        state(group("source", ["a", "x"]), group("destination", ["b", "c"])),
        threadSplitDragData(key("a"), "A"),
        threadSplitTargetDropData(key("b")),
      ),
    ).toEqual({
      accepted: true,
      intent: {
        type: "insert",
        groupId: "destination",
        targetKey: key("a"),
        afterTargetKey: key("b"),
      },
    });
  });

  it("reorders inside the same group", () => {
    expect(
      resolveThreadSplitDrop(
        state(group("g", ["a", "b", "c"])),
        threadSplitDragData(key("a"), "A"),
        threadSplitTargetDropData(key("b")),
      ),
    ).toEqual({
      accepted: true,
      intent: { type: "reorder", groupId: "g", targetKeys: [key("b"), key("a"), key("c")] },
    });
  });

  it("rejects the fifty-first pane with concise feedback", () => {
    const full = group(
      "full",
      Array.from({ length: THREAD_SPLIT_MAX_PANES }, (_, index) => `${index}`),
    );
    expect(
      resolveThreadSplitDrop(
        state(full),
        threadSplitDragData(key("extra"), "Extra"),
        threadSplitGroupDropData("full"),
      ),
    ).toEqual({
      accepted: false,
      reason: "full",
      message: `Split views support up to ${THREAD_SPLIT_MAX_PANES} panes.`,
    });
  });

  it("never accepts group cards as merge targets", () => {
    expect(
      resolveThreadSplitDrop(
        state(group("g", ["a", "b"])),
        threadSplitDragData(key("x"), "X"),
        threadSplitGroupCardData("g"),
      ),
    ).toEqual({ accepted: false, reason: "group-card" });
  });

  it("executes intents only through high-level store actions", () => {
    const openTargets = vi.fn(() => "g");
    const configureGroup = vi.fn();
    const result = resolveThreadSplitDrop(
      state(group("g", ["a", "b"])),
      threadSplitDragData(key("x"), "X"),
      threadSplitTargetDropData(key("a")),
    );
    expect(applyThreadSplitDrop(result, { openTargets, configureGroup })).toBe(true);
    expect(openTargets).toHaveBeenCalledWith([key("x")], {
      groupId: "g",
      mode: "add",
      afterTargetKey: key("a"),
      focusTargetKey: key("x"),
    });
    expect(configureGroup).not.toHaveBeenCalled();
  });

  it("lets store invariants dissolve a source group when its member moves", () => {
    let id = 0;
    const store = createThreadSplitStore({
      storage: null,
      createGroupId: () => `group-${++id}`,
    });
    const sourceId = store.getState().openTargets([key("a"), key("x")]);
    const destinationId = store.getState().openTargets([key("b"), key("c")]);

    const result = resolveThreadSplitDrop(
      store.getState(),
      threadSplitDragData(key("a"), "A"),
      threadSplitTargetDropData(key("b")),
    );
    expect(applyThreadSplitDrop(result, store.getState())).toBe(true);
    expect(store.getState().groups[sourceId!]).toBeUndefined();
    expect(store.getState().groups[destinationId!]?.targetKeys).toEqual([
      key("b"),
      key("a"),
      key("c"),
    ]);
  });
});
