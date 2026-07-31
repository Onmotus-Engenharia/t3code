import {
  THREAD_SPLIT_MAX_PANES,
  type PersistedThreadSplitState,
  type ThreadSplitTargetKey,
} from "../../threadSplitStore";

export const THREAD_SPLIT_DRAG_TYPE = "thread-split-target";
export const THREAD_SPLIT_DROP_TYPE = "thread-split-drop";
export const THREAD_SPLIT_DRAG_ACTIVATION_DISTANCE = 4;

export interface ThreadSplitDragData {
  type: typeof THREAD_SPLIT_DRAG_TYPE;
  targetKey: ThreadSplitTargetKey;
  title: string;
}

export type ThreadSplitDropData =
  | {
      type: typeof THREAD_SPLIT_DROP_TYPE;
      kind: "target";
      targetKey: ThreadSplitTargetKey;
    }
  | {
      type: typeof THREAD_SPLIT_DROP_TYPE;
      kind: "group";
      groupId: string;
    }
  | {
      type: typeof THREAD_SPLIT_DROP_TYPE;
      kind: "group-card";
      groupId: string;
    };

export const threadSplitDragData = (
  targetKey: ThreadSplitTargetKey,
  title: string,
): ThreadSplitDragData => ({ type: THREAD_SPLIT_DRAG_TYPE, targetKey, title });

export const threadSplitTargetDropData = (
  targetKey: ThreadSplitTargetKey,
): ThreadSplitDropData => ({ type: THREAD_SPLIT_DROP_TYPE, kind: "target", targetKey });

export const threadSplitGroupDropData = (groupId: string): ThreadSplitDropData => ({
  type: THREAD_SPLIT_DROP_TYPE,
  kind: "group",
  groupId,
});

export const threadSplitGroupCardData = (groupId: string): ThreadSplitDropData => ({
  type: THREAD_SPLIT_DROP_TYPE,
  kind: "group-card",
  groupId,
});

export function isThreadSplitDragData(value: unknown): value is ThreadSplitDragData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ThreadSplitDragData>;
  return (
    data.type === THREAD_SPLIT_DRAG_TYPE &&
    typeof data.targetKey === "string" &&
    (data.targetKey.startsWith("server:") || data.targetKey.startsWith("draft:")) &&
    typeof data.title === "string"
  );
}

export function isThreadSplitDropData(value: unknown): value is ThreadSplitDropData {
  if (!value || typeof value !== "object") return false;
  const data = value as Partial<ThreadSplitDropData>;
  if (data.type !== THREAD_SPLIT_DROP_TYPE) return false;
  if (data.kind === "target")
    return (
      typeof data.targetKey === "string" &&
      (data.targetKey.startsWith("server:") || data.targetKey.startsWith("draft:"))
    );
  return (data.kind === "group" || data.kind === "group-card") && typeof data.groupId === "string";
}

export type ThreadSplitDropIntent =
  | {
      type: "create";
      targetKeys: readonly [ThreadSplitTargetKey, ThreadSplitTargetKey];
      focusTargetKey: ThreadSplitTargetKey;
    }
  | {
      type: "insert";
      groupId: string;
      targetKey: ThreadSplitTargetKey;
      afterTargetKey?: ThreadSplitTargetKey;
    }
  | {
      type: "reorder";
      groupId: string;
      targetKeys: readonly ThreadSplitTargetKey[];
    };

export type ThreadSplitDropResult =
  | { accepted: true; intent: ThreadSplitDropIntent }
  | {
      accepted: false;
      reason: "invalid-payload" | "same-target" | "group-card" | "full" | "no-change";
      message?: string;
    };

function ownerOf(state: PersistedThreadSplitState, targetKey: ThreadSplitTargetKey) {
  return state.groupOrder.find((groupId) => state.groups[groupId]?.targetKeys.includes(targetKey));
}

export function resolveThreadSplitDrop(
  state: PersistedThreadSplitState,
  activeData: unknown,
  overData: unknown,
): ThreadSplitDropResult {
  if (!isThreadSplitDragData(activeData) || !isThreadSplitDropData(overData)) {
    return { accepted: false, reason: "invalid-payload" };
  }
  if (overData.kind === "group-card") {
    return { accepted: false, reason: "group-card" };
  }

  const sourceKey = activeData.targetKey;
  const sourceGroupId = ownerOf(state, sourceKey);
  let destinationGroupId: string | undefined;
  let afterTargetKey: ThreadSplitTargetKey | undefined;

  if (overData.kind === "target") {
    if (sourceKey === overData.targetKey) return { accepted: false, reason: "same-target" };
    destinationGroupId = ownerOf(state, overData.targetKey);
    afterTargetKey = overData.targetKey;
    if (!destinationGroupId) {
      return {
        accepted: true,
        intent: {
          type: "create",
          targetKeys: [overData.targetKey, sourceKey],
          focusTargetKey: sourceKey,
        },
      };
    }
  } else {
    destinationGroupId = overData.groupId;
  }

  const destination = state.groups[destinationGroupId];
  if (!destination) return { accepted: false, reason: "invalid-payload" };

  if (sourceGroupId === destinationGroupId) {
    const withoutSource = destination.targetKeys.filter((key) => key !== sourceKey);
    const insertionIndex = afterTargetKey
      ? withoutSource.indexOf(afterTargetKey) + 1
      : withoutSource.length;
    const targetKeys = [...withoutSource];
    targetKeys.splice(Math.max(0, insertionIndex), 0, sourceKey);
    if (targetKeys.every((key, index) => key === destination.targetKeys[index])) {
      return { accepted: false, reason: "no-change" };
    }
    return {
      accepted: true,
      intent: { type: "reorder", groupId: destinationGroupId, targetKeys },
    };
  }

  if (destination.targetKeys.length >= THREAD_SPLIT_MAX_PANES) {
    return {
      accepted: false,
      reason: "full",
      message: `Split views support up to ${THREAD_SPLIT_MAX_PANES} panes.`,
    };
  }
  return {
    accepted: true,
    intent: {
      type: "insert",
      groupId: destinationGroupId,
      targetKey: sourceKey,
      ...(afterTargetKey ? { afterTargetKey } : {}),
    },
  };
}

export interface ThreadSplitDropActions {
  openTargets: (
    targetKeys: readonly ThreadSplitTargetKey[],
    options?: {
      groupId?: string;
      mode?: "new-group" | "add";
      afterTargetKey?: ThreadSplitTargetKey;
      focusTargetKey?: ThreadSplitTargetKey;
    },
  ) => string | null;
  configureGroup: (
    groupId: string,
    configuration: { targetKeys: readonly ThreadSplitTargetKey[] },
  ) => void;
}

export function applyThreadSplitDrop(
  result: ThreadSplitDropResult,
  actions: ThreadSplitDropActions,
): boolean {
  if (!result.accepted) return false;
  const intent = result.intent;
  if (intent.type === "reorder") {
    actions.configureGroup(intent.groupId, { targetKeys: intent.targetKeys });
    return true;
  }
  if (intent.type === "create") {
    return (
      actions.openTargets(intent.targetKeys, {
        mode: "new-group",
        focusTargetKey: intent.focusTargetKey,
      }) !== null
    );
  }
  return (
    actions.openTargets([intent.targetKey], {
      groupId: intent.groupId,
      mode: "add",
      ...(intent.afterTargetKey ? { afterTargetKey: intent.afterTargetKey } : {}),
      focusTargetKey: intent.targetKey,
    }) !== null
  );
}

export function isValidThreadSplitDropTarget(
  state: PersistedThreadSplitState,
  activeData: unknown,
  overData: unknown,
): boolean {
  const result = resolveThreadSplitDrop(state, activeData, overData);
  return result.accepted || result.reason === "no-change";
}
