import { describe, expect, it } from "vite-plus/test";

import { THREAD_SPLIT_MAX_PANES } from "../threadSplitStore";
import { buildThreadActionMenuItems, type ThreadActionMenuState } from "./threadActionMenu.logic";

const baseState: ThreadActionMenuState = {
  branch: null,
  isPinned: false,
  isSettled: false,
  isSnoozed: false,
  canSnoozeNow: true,
  isRegeneratingTitle: false,
  supports: { settlement: true, snooze: true, pinning: true, titleRegeneration: true },
  snoozePresets: [
    { id: "hour", label: "In 1 hour", whenLabel: "3:00 PM", snoozedUntil: "2026-08-07T15:00:00Z" },
  ],
};

function ids(state: ThreadActionMenuState): string[] {
  return buildThreadActionMenuItems(state).map((item) => item.id);
}

describe("buildThreadActionMenuItems", () => {
  it("hides lifecycle items when the environment lacks the capabilities", () => {
    expect(
      ids({
        ...baseState,
        supports: { settlement: false, snooze: false, pinning: false, titleRegeneration: false },
      }),
    ).toEqual(["rename", "mark-unread", "copy-path", "copy-thread-id", "delete"]);
  });

  it("includes branch items only for threads with a branch", () => {
    const withBranch = ids({ ...baseState, branch: "feat/menu" });
    expect(withBranch).toContain("new-thread-on-branch");
    expect(withBranch).toContain("copy-branch");
    expect(ids(baseState)).not.toContain("new-thread-on-branch");
    expect(ids(baseState)).not.toContain("copy-branch");
  });

  it("flips lifecycle labels with thread state", () => {
    expect(ids({ ...baseState, isPinned: true, isSettled: true, isSnoozed: true })).toEqual(
      expect.arrayContaining(["unpin", "unsettle", "unsnooze"]),
    );
    expect(ids(baseState)).toEqual(expect.arrayContaining(["pin", "settle", "snooze"]));
  });

  it("disables snooze when the thread cannot snooze, keeping presets visible", () => {
    const snooze = buildThreadActionMenuItems({ ...baseState, canSnoozeNow: false }).find(
      (item) => item.id === "snooze",
    );
    expect(snooze?.disabled).toBe(true);
    expect(snooze?.children?.map((child) => child.id)).toEqual(["snooze:hour"]);
  });

  it("disables title regeneration while one is in flight", () => {
    const item = buildThreadActionMenuItems({ ...baseState, isRegeneratingTitle: true }).find(
      (candidate) => candidate.id === "regenerate-title",
    );
    expect(item).toMatchObject({ label: "Regenerating…", disabled: true });
  });

  it("marks delete as destructive and keeps it last", () => {
    const items = buildThreadActionMenuItems({ ...baseState, branch: "main" });
    expect(items.at(-1)).toMatchObject({ id: "delete", destructive: true });
  });

  it("keeps Copy thread ID in the shared per-thread menu after the v0.0.33 rewrite", () => {
    expect(buildThreadActionMenuItems(baseState)).toContainEqual(
      expect.objectContaining({ id: "copy-thread-id", label: "Copy thread ID" }),
    );
  });

  it("keeps split actions in the shared current-sidebar menu after the v0.0.33 rewrite", () => {
    const splitItems = ids({
      ...baseState,
      split: {
        grouped: false,
        activeGroupPaneCount: 2,
        hasDifferentFocusedTarget: true,
        hasTaskDescendants: true,
        hasTaskSplitGroup: false,
      },
    });
    expect(splitItems).toEqual(
      expect.arrayContaining(["open-in-current-split-view", "start-split-view", "split-task-tree"]),
    );

    const groupedItems = buildThreadActionMenuItems({
      ...baseState,
      split: {
        grouped: true,
        activeGroupPaneCount: THREAD_SPLIT_MAX_PANES,
        hasDifferentFocusedTarget: true,
        hasTaskDescendants: true,
        hasTaskSplitGroup: true,
      },
    });
    expect(groupedItems.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        "focus-in-split-view",
        "remove-from-split-view",
        "open-task-split-view",
      ]),
    );
    expect(groupedItems.map((item) => item.id)).not.toContain("start-split-view");
  });

  it("keeps the sidebar's local task nesting action gated to task children", () => {
    expect(ids({ ...baseState, taskNesting: { unnested: false } })).toContain("unnest-task");
    expect(ids({ ...baseState, taskNesting: { unnested: true } })).toContain("renest-task");
    expect(ids(baseState)).not.toEqual(expect.arrayContaining(["unnest-task", "renest-task"]));
  });
});
