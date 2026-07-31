import { useRouter } from "@tanstack/react-router";
import { useCallback, useEffect, useMemo, useSyncExternalStore } from "react";
import type { DraftId } from "./composerDraftStore";
import {
  buildDraftThreadRouteParams,
  buildThreadRouteParams,
  splitKeyToThreadRouteTarget,
  threadRouteTargetToSplitKey,
  type ThreadRouteTarget,
} from "./threadRoutes";
import {
  getThreadSplitGroupForTarget,
  threadSplitStore,
  type PersistedThreadSplitState,
} from "./threadSplitStore";

export type ThreadNavigationHistory = "push" | "replace";
export type ThreadNavigationDisposition =
  | "activate-existing-group"
  | "replace-focused-pane"
  | "standalone";

export interface OpenThreadTargetOptions {
  history?: ThreadNavigationHistory;
  disposition?: ThreadNavigationDisposition;
}

export interface ThreadNavigation {
  getFocusedTarget(): ThreadRouteTarget | null;
  openTarget(target: ThreadRouteTarget, options?: OpenThreadTargetOptions): Promise<void>;
  promoteDraft(
    draftId: DraftId,
    target: Extract<ThreadRouteTarget, { kind: "server" }>,
  ): Promise<void>;
}

export interface ThreadRouteNavigator {
  navigate(target: ThreadRouteTarget, history: ThreadNavigationHistory): Promise<void>;
}

export function createStandaloneThreadNavigation(input: {
  getRouteTarget: () => ThreadRouteTarget | null;
  router: ThreadRouteNavigator;
}): ThreadNavigation {
  return {
    getFocusedTarget: input.getRouteTarget,
    openTarget(target, options) {
      return input.router.navigate(target, options?.history ?? "push");
    },
    promoteDraft(_draftId, target) {
      return input.router.navigate(target, "replace");
    },
  };
}

export function createSplitThreadNavigation(input: {
  getRouteTarget: () => ThreadRouteTarget | null;
  router: ThreadRouteNavigator;
  store?: typeof threadSplitStore;
}): ThreadNavigation {
  const store = input.store ?? threadSplitStore;
  const getFocusedTarget = () => {
    const state = store.getState();
    const routeTarget = input.getRouteTarget();
    const group = routeTarget
      ? getThreadSplitGroupForTarget(state, threadRouteTargetToSplitKey(routeTarget))
      : undefined;
    return group ? splitKeyToThreadRouteTarget(group.focusedTargetKey) : routeTarget;
  };

  return {
    getFocusedTarget,
    async openTarget(target, options = {}) {
      const targetKey = threadRouteTargetToSplitKey(target);
      const state = store.getState();
      const owner = getThreadSplitGroupForTarget(state, targetKey);
      const routeTarget = input.getRouteTarget();
      const routeOwner = routeTarget
        ? getThreadSplitGroupForTarget(state, threadRouteTargetToSplitKey(routeTarget))
        : undefined;
      const disposition = options.disposition ?? "activate-existing-group";

      if (owner) {
        state.focusTarget(targetKey);
      } else if (disposition === "replace-focused-pane" && routeOwner) {
        state.openTargets([targetKey], {
          groupId: routeOwner.id,
          mode: "replace-focused",
          focusTargetKey: targetKey,
        });
      }

      await input.router.navigate(target, options.history ?? "push");
    },
    async promoteDraft(draftId, target) {
      store.getState().promoteDraftTarget(`draft:${draftId}`, threadRouteTargetToSplitKey(target));
      await input.router.navigate(target, "replace");
    },
  };
}

export function restoreSplitGroupForRoute(
  state: PersistedThreadSplitState,
  target: ThreadRouteTarget | null,
): string | null {
  if (!target) return null;
  return getThreadSplitGroupForTarget(state, threadRouteTargetToSplitKey(target))?.id ?? null;
}

function useSplitState() {
  return useSyncExternalStore(
    threadSplitStore.subscribe,
    threadSplitStore.getState,
    threadSplitStore.getInitialState,
  );
}

export function useThreadNavigation(routeTarget: ThreadRouteTarget | null): ThreadNavigation {
  const router = useRouter();
  const splitState = useSplitState();
  const routeTargetKey = routeTarget ? threadRouteTargetToSplitKey(routeTarget) : null;
  const getRouteTarget = useCallback(() => routeTarget, [routeTarget]);
  const routeNavigator = useMemo<ThreadRouteNavigator>(
    () => ({
      async navigate(target, history) {
        if (target.kind === "server") {
          await router.navigate({
            to: "/$environmentId/$threadId",
            params: buildThreadRouteParams(target.threadRef),
            replace: history === "replace",
          });
        } else {
          await router.navigate({
            to: "/draft/$draftId",
            params: buildDraftThreadRouteParams(target.draftId),
            replace: history === "replace",
          });
        }
      },
    }),
    [router],
  );
  const navigation = useMemo(
    () => createSplitThreadNavigation({ getRouteTarget, router: routeNavigator }),
    [getRouteTarget, routeNavigator],
  );

  useEffect(() => {
    if (!routeTargetKey) return;
    if (getThreadSplitGroupForTarget(threadSplitStore.getState(), routeTargetKey)) {
      threadSplitStore.getState().focusTarget(routeTargetKey);
    }
  }, [routeTargetKey]);

  // Subscribe so consumers re-read the focused target when focus or group activation changes.
  void splitState.activeGroupId;
  return navigation;
}
