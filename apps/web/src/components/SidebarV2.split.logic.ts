import type { ThreadSplitTargetKey } from "../threadSplitStore";

export function resolveSidebarV2SplitSelection(
  orderedThreadKeys: readonly string[],
  selectedThreadKeys: ReadonlySet<string>,
) {
  const threadKeys = orderedThreadKeys.filter((threadKey) => selectedThreadKeys.has(threadKey));
  return {
    threadKeys,
    targetKeys: threadKeys.map((threadKey) => `server:${threadKey}` as ThreadSplitTargetKey),
    label: `Open in split view (${threadKeys.length})`,
    disabled: threadKeys.length < 2 || threadKeys.length > 12,
  };
}

export function resolveSidebarV2SingleSplitActionIds(input: {
  grouped: boolean;
  activeGroupPaneCount: number | null;
  hasDifferentFocusedTarget: boolean;
  hasTaskDescendants: boolean;
  hasTaskSplitGroup: boolean;
}) {
  const actions: string[] = [];
  if (input.grouped) {
    actions.push("focus-in-split-view", "remove-from-split-view");
  } else {
    if (input.activeGroupPaneCount !== null) actions.push("open-in-current-split-view");
    if (input.hasDifferentFocusedTarget) actions.push("start-split-view");
  }
  if (input.hasTaskDescendants) {
    actions.push(input.hasTaskSplitGroup ? "open-task-split-view" : "split-task-tree");
  }
  return actions;
}
