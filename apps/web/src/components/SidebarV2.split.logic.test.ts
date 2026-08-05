import { describe, expect, it } from "vite-plus/test";
import { THREAD_SPLIT_MAX_PANES } from "../threadSplitStore";
import {
  resolveSidebarV2SingleSplitActionIds,
  resolveSidebarV2SplitSelection,
} from "./SidebarV2.split.logic";

describe("SidebarV2 split integration logic", () => {
  it("preserves rendered order and enforces the 2–12 multi-select constraint", () => {
    expect(resolveSidebarV2SplitSelection(["a", "b", "c"], new Set(["c", "a"]))).toEqual({
      threadKeys: ["a", "c"],
      targetKeys: ["server:a", "server:c"],
      label: "Open in split view (2)",
      disabled: false,
    });
    expect(resolveSidebarV2SplitSelection(["a"], new Set(["a"])).disabled).toBe(true);
    const overLimit = Array.from({ length: THREAD_SPLIT_MAX_PANES + 1 }, (_, index) =>
      String(index),
    );
    expect(resolveSidebarV2SplitSelection(overLimit, new Set(overLimit)).disabled).toBe(true);
  });

  it("offers grouped, ungrouped, and task-tree alternatives contextually", () => {
    expect(
      resolveSidebarV2SingleSplitActionIds({
        grouped: true,
        activeGroupPaneCount: 2,
        hasDifferentFocusedTarget: true,
        hasTaskDescendants: true,
        hasTaskSplitGroup: false,
      }),
    ).toEqual(["focus-in-split-view", "remove-from-split-view", "split-task-tree"]);
    expect(
      resolveSidebarV2SingleSplitActionIds({
        grouped: false,
        activeGroupPaneCount: 12,
        hasDifferentFocusedTarget: true,
        hasTaskDescendants: true,
        hasTaskSplitGroup: true,
      }),
    ).toEqual(["open-in-current-split-view", "start-split-view", "open-task-split-view"]);
  });
});
