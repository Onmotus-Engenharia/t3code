import { scopedThreadKey, scopeThreadRef } from "@t3tools/client-runtime/environment";
import type { KeybindingCommand } from "@t3tools/contracts";
import { useCallback, useSyncExternalStore } from "react";
import { useThreadShells } from "./state/entities";
import {
  splitKeyToThreadRouteTarget,
  threadRouteTargetToSplitKey,
  type ThreadRouteTarget,
} from "./threadRoutes";
import { useThreadNavigation, type ThreadNavigation } from "./threadSplitNavigation";
import {
  getThreadSplitGroupForTarget,
  threadSplitStore,
  type PersistedThreadSplitState,
  type ThreadSplitCatalogThread,
  type ThreadSplitGroup,
  type ThreadSplitLayoutMode,
  type ThreadSplitState,
  type ThreadSplitTargetKey,
} from "./threadSplitStore";

type SplitCommandThread = {
  readonly environmentId: Parameters<typeof scopeThreadRef>[0];
  readonly id: Parameters<typeof scopeThreadRef>[1];
  readonly updatedAt?: string | number | null;
  readonly taskRelation: { readonly rootThreadId: Parameters<typeof scopeThreadRef>[1] } | null;
};

export interface FocusedSplitViewContext {
  readonly focusedTarget: ThreadRouteTarget | null;
  readonly focusedTargetKey: ThreadSplitTargetKey | null;
  readonly group: ThreadSplitGroup | null;
  readonly splitViewActive: boolean;
}

export function resolveFocusedSplitViewContext(
  state: PersistedThreadSplitState,
  routeTarget: ThreadRouteTarget | null,
): FocusedSplitViewContext {
  const routeGroup = routeTarget
    ? getThreadSplitGroupForTarget(state, threadRouteTargetToSplitKey(routeTarget))
    : undefined;
  const focusedTargetKey = routeGroup?.focusedTargetKey ?? null;
  const focusedTarget = focusedTargetKey
    ? splitKeyToThreadRouteTarget(focusedTargetKey)
    : routeTarget;
  return {
    focusedTarget,
    focusedTargetKey,
    group: routeGroup ?? null,
    splitViewActive: routeGroup !== undefined,
  };
}

export function buildSplitTaskCatalog(
  threads: readonly SplitCommandThread[],
): ThreadSplitCatalogThread[] {
  return threads.map((thread, treeOrder) => ({
    targetKey: `server:${scopedThreadKey(scopeThreadRef(thread.environmentId, thread.id))}`,
    rootThreadKey: thread.taskRelation
      ? scopedThreadKey(scopeThreadRef(thread.environmentId, thread.taskRelation.rootThreadId))
      : null,
    ...(thread.updatedAt !== undefined ? { updatedAt: thread.updatedAt } : {}),
    treeOrder,
  }));
}

function taskRootTargetKey(
  focusedTarget: ThreadRouteTarget | null,
  threads: readonly SplitCommandThread[],
): ThreadSplitTargetKey | null {
  if (focusedTarget?.kind !== "server") return null;
  const thread = threads.find(
    (candidate) =>
      candidate.environmentId === focusedTarget.threadRef.environmentId &&
      candidate.id === focusedTarget.threadRef.threadId,
  );
  const rootThreadId = thread?.taskRelation?.rootThreadId ?? focusedTarget.threadRef.threadId;
  return `server:${scopedThreadKey(
    scopeThreadRef(focusedTarget.threadRef.environmentId, rootThreadId),
  )}`;
}

export interface ExecuteSplitViewCommandInput {
  readonly command: KeybindingCommand;
  readonly state: ThreadSplitState;
  readonly navigation: ThreadNavigation;
  readonly routeTarget: ThreadRouteTarget | null;
  readonly threads: readonly SplitCommandThread[];
}

export async function executeSplitViewCommand(
  input: ExecuteSplitViewCommandInput,
): Promise<boolean> {
  const context = resolveFocusedSplitViewContext(input.state, input.routeTarget);
  const group = context.group;
  if (!group) return false;

  const navigateToKey = async (targetKey: ThreadSplitTargetKey) => {
    const target = splitKeyToThreadRouteTarget(targetKey);
    if (target) {
      await input.navigation.openTarget(target, {
        history: "replace",
        disposition: "activate-existing-group",
      });
    }
  };
  const focusOffset = async (offset: -1 | 1) => {
    const index = group.targetKeys.indexOf(group.focusedTargetKey);
    const nextIndex = (index + offset + group.targetKeys.length) % group.targetKeys.length;
    const nextTargetKey = group.targetKeys[nextIndex];
    if (nextTargetKey) await navigateToKey(nextTargetKey);
  };
  const setLayout = (layoutMode: ThreadSplitLayoutMode) => {
    input.state.configureGroup(group.id, { layoutMode });
  };

  switch (input.command) {
    case "splitView.focusPrevious":
      await focusOffset(-1);
      return true;
    case "splitView.focusNext":
      await focusOffset(1);
      return true;
    case "splitView.removeFocusedPane": {
      const nextTargetKey = group.targetKeys.find((key) => key !== group.focusedTargetKey);
      input.state.removeTarget(group.focusedTargetKey);
      if (nextTargetKey) await navigateToKey(nextTargetKey);
      return true;
    }
    case "splitView.closeGroup":
      input.state.closeGroup(group.id);
      return true;
    case "splitView.toggleTaskTree": {
      const rootTargetKey = taskRootTargetKey(context.focusedTarget, input.threads);
      if (!rootTargetKey) return true;
      input.state.openTaskTree(rootTargetKey, buildSplitTaskCatalog(input.threads));
      await navigateToKey(rootTargetKey);
      return true;
    }
    case "splitView.layoutAuto":
      setLayout("auto");
      return true;
    case "splitView.layoutColumns":
      setLayout("columns");
      return true;
    case "splitView.layoutRows":
      setLayout("rows");
      return true;
    default:
      return false;
  }
}

export function useSplitViewCommands(routeTarget: ThreadRouteTarget | null) {
  const state = useSyncExternalStore(
    threadSplitStore.subscribe,
    threadSplitStore.getState,
    threadSplitStore.getInitialState,
  );
  const threads = useThreadShells();
  const navigation = useThreadNavigation(routeTarget);
  const context = resolveFocusedSplitViewContext(state, routeTarget);
  const execute = useCallback(
    (command: KeybindingCommand) =>
      executeSplitViewCommand({
        command,
        state: threadSplitStore.getState(),
        navigation,
        routeTarget,
        threads,
      }),
    [navigation, routeTarget, threads],
  );
  const splitTaskTree = useCallback(async () => {
    const current = resolveFocusedSplitViewContext(threadSplitStore.getState(), routeTarget);
    const rootTargetKey = taskRootTargetKey(current.focusedTarget, threads);
    if (!rootTargetKey) return null;
    const result = threadSplitStore
      .getState()
      .openTaskTree(rootTargetKey, buildSplitTaskCatalog(threads));
    const rootTarget = splitKeyToThreadRouteTarget(rootTargetKey);
    if (result.groupId && rootTarget) {
      await navigation.openTarget(rootTarget, {
        history: "push",
        disposition: "activate-existing-group",
      });
    }
    return result;
  }, [navigation, routeTarget, threads]);

  return {
    ...context,
    execute,
    splitTaskTree,
    threads,
    navigation,
  };
}

export function useFocusedSplitViewContext(
  routeTarget: ThreadRouteTarget | null,
): FocusedSplitViewContext {
  const state = useSyncExternalStore(
    threadSplitStore.subscribe,
    threadSplitStore.getState,
    threadSplitStore.getInitialState,
  );
  return resolveFocusedSplitViewContext(state, routeTarget);
}
