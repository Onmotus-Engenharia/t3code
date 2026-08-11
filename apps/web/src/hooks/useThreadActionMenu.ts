import {
  scopeProjectRef,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import {
  type AtomCommandResult,
  isAtomCommandInterrupted,
  settlePromise,
  squashAtomCommandFailure,
} from "@t3tools/client-runtime/state/runtime";
import {
  canSnooze,
  effectiveSettled,
  effectiveSnoozed,
} from "@t3tools/client-runtime/state/thread-settled";
import type { ScopedThreadRef } from "@t3tools/contracts";
import { useParams } from "@tanstack/react-router";
import { useCallback, useMemo } from "react";

import { resolveSnoozePresets, snoozeWakeDescription } from "../components/Sidebar.snooze";
import {
  buildThreadActionMenuItems,
  type ThreadActionMenuId,
} from "../components/threadActionMenu.logic";
import { stackedThreadToast, toastManager } from "../components/ui/toast";
import { threadEnvironment } from "../state/threads";
import { useAtomCommand } from "../state/use-atom-command";
import {
  readEnvironmentSupportsPinning,
  readEnvironmentSupportsSettlement,
  readEnvironmentSupportsSnooze,
  readEnvironmentSupportsTitleRegeneration,
  readThreadShell,
  useThreadShells,
} from "../state/entities";
import { resolveThreadRouteTarget, threadRouteTargetToSplitKey } from "../threadRoutes";
import { useThreadNavigation } from "../threadSplitNavigation";
import {
  getThreadSplitGroupForTarget,
  THREAD_SPLIT_MAX_PANES,
  threadSplitStore,
  type ThreadSplitTargetKey,
} from "../threadSplitStore";
import { buildSplitTaskCatalog } from "../splitViewCommands";
import { readLocalApi } from "../localApi";
import { useUiStateStore } from "../uiStateStore";
import { useCopyToClipboard } from "./useCopyToClipboard";
import { useNewThreadHandler } from "./useHandleNewThread";
import { useClientSettings } from "./useSettings";
import { useThreadActions } from "./useThreadActions";

function failureToast(title: string, error: unknown) {
  toastManager.add(
    stackedThreadToast({
      type: "error",
      title,
      description: error instanceof Error ? error.message : "An error occurred.",
    }),
  );
}

/**
 * The per-thread action menu (pin, settle, snooze, rename, copy, delete…) as
 * a self-contained hook, for surfaces other than the sidebar row — today the
 * chat header. Renders through the native context-menu bridge and dispatches
 * through the same mutations the sidebar uses.
 *
 * Unlike the sidebar, settle and snooze here never navigate away: the caller
 * is acting on the thread they are reading, and ChatView's parked-thread
 * banner already offers the way back.
 */
export function useThreadActionMenu(input: {
  readonly threadRef: ScopedThreadRef | null;
  /** Fallback for "Copy path" when the thread has no worktree. */
  readonly projectCwd: string | null;
  readonly onStartRename: () => void;
}) {
  const { threadRef, projectCwd, onStartRename } = input;
  const {
    settleThread,
    unsettleThread,
    snoozeThread,
    unsnoozeThread,
    pinThread,
    unpinThread,
    deleteThread,
  } = useThreadActions();
  const updateThreadMetadata = useAtomCommand(threadEnvironment.updateMetadata, {
    reportFailure: false,
  });
  const handleNewThread = useNewThreadHandler();
  const markThreadUnread = useUiStateStore((s) => s.markThreadUnread);
  const autoSettleAfterDays = useClientSettings((s) => s.sidebarAutoSettleAfterDays);
  const confirmThreadDelete = useClientSettings((s) => s.confirmThreadDelete);
  const timestampFormat = useClientSettings((s) => s.timestampFormat);
  const routeTarget = useParams({
    strict: false,
    select: (params) => resolveThreadRouteTarget(params),
  });
  const threadNavigation = useThreadNavigation(routeTarget);
  const threads = useThreadShells();
  const splitCatalog = useMemo(() => buildSplitTaskCatalog(threads), [threads]);
  const { copyToClipboard: copyPathToClipboard } = useCopyToClipboard<{ path: string }>({
    onCopy: ({ path }) => {
      toastManager.add({ type: "success", title: "Path copied", description: path });
    },
    onError: (error) => failureToast("Failed to copy path", error),
  });
  const { copyToClipboard: copyThreadIdToClipboard } = useCopyToClipboard<{
    threadId: string;
  }>({
    target: "thread ID",
    onCopy: ({ threadId }) => {
      toastManager.add({ type: "success", title: "Thread ID copied", description: threadId });
    },
    onError: (error) => failureToast("Failed to copy thread ID", error),
  });
  const { copyToClipboard: copyBranchToClipboard } = useCopyToClipboard<{ branch: string }>({
    target: "branch name",
    onCopy: ({ branch }) => {
      toastManager.add({ type: "success", title: "Branch copied", description: branch });
    },
    onError: (error) => failureToast("Failed to copy branch", error),
  });

  const openMenu = useCallback(
    (position: { x: number; y: number }) => {
      if (threadRef === null) return;
      void (async () => {
        const api = readLocalApi();
        if (!api) return;
        // Snapshot at open time — the menu is modal, so state read now is
        // what the user is looking at.
        const thread = readThreadShell(threadRef);
        if (!thread) return;
        const now = new Date();
        const supports = {
          settlement: readEnvironmentSupportsSettlement(threadRef.environmentId),
          snooze: readEnvironmentSupportsSnooze(threadRef.environmentId),
          pinning: readEnvironmentSupportsPinning(threadRef.environmentId),
          titleRegeneration: readEnvironmentSupportsTitleRegeneration(threadRef.environmentId),
        };
        const isRegeneratingTitle = thread.titleRegeneration != null;
        const snoozePresets = resolveSnoozePresets(now, timestampFormat);
        const splitTargetKey = `server:${scopedThreadKey(threadRef)}` as ThreadSplitTargetKey;
        const splitSnapshot = threadSplitStore.getState();
        const owningSplitGroup = getThreadSplitGroupForTarget(splitSnapshot, splitTargetKey);
        const activeSplitGroup = splitSnapshot.activeGroupId
          ? splitSnapshot.groups[splitSnapshot.activeGroupId]
          : undefined;
        const focusedTarget = threadNavigation.getFocusedTarget();
        const focusedTargetKey = focusedTarget ? threadRouteTargetToSplitKey(focusedTarget) : null;
        const rootThreadId = thread.taskRelation?.rootThreadId ?? thread.id;
        const rootThreadKey = scopedThreadKey(
          scopeThreadRef(threadRef.environmentId, rootThreadId),
        );
        const taskSplitGroup = Object.values(splitSnapshot.groups).find(
          (group) => group.taskTreeBinding?.rootThreadKey === rootThreadKey,
        );
        const hasTaskDescendants = splitCatalog.some(
          (entry) => entry.rootThreadKey === rootThreadKey,
        );
        const items = buildThreadActionMenuItems({
          branch: thread.branch ?? null,
          isPinned: thread.pinnedAt != null,
          isSettled:
            supports.settlement &&
            effectiveSettled(thread, {
              // Minute-quantized like useNowMinute, so this classification
              // can never disagree with the sidebar partition or ChatView's
              // parked-thread banner within the same minute.
              now: `${now.toISOString().slice(0, 16)}:00.000Z`,
              autoSettleAfterDays,
            }),
          isSnoozed: supports.snooze && effectiveSnoozed(thread, { now: now.toISOString() }),
          canSnoozeNow: canSnooze(thread, { now: now.toISOString() }),
          isRegeneratingTitle,
          supports,
          snoozePresets,
          split: {
            grouped: owningSplitGroup !== undefined,
            activeGroupPaneCount: activeSplitGroup?.targetKeys.length ?? null,
            hasDifferentFocusedTarget:
              focusedTargetKey !== null && focusedTargetKey !== splitTargetKey,
            hasTaskDescendants,
            hasTaskSplitGroup: taskSplitGroup !== undefined,
          },
        });
        const clicked = await settlePromise(() => api.contextMenu.show(items, position));
        if (clicked._tag === "Failure" || clicked.value === null) return;
        const action: ThreadActionMenuId = clicked.value;
        if (action.startsWith("snooze:")) {
          const preset = snoozePresets.find((candidate) => `snooze:${candidate.id}` === action);
          if (!preset) return;
          const result = await snoozeThread(threadRef, preset.snoozedUntil);
          if (result._tag === "Failure") {
            if (!isAtomCommandInterrupted(result)) {
              failureToast("Failed to snooze thread", squashAtomCommandFailure(result));
            }
            return;
          }
          toastManager.add(
            stackedThreadToast({
              type: "success",
              title: `Snoozed until ${snoozeWakeDescription(preset.snoozedUntil, new Date(), timestampFormat)}`,
              timeout: 5_000,
              actionProps: {
                children: "Undo",
                onClick: () => {
                  void unsnoozeThread(threadRef).then((undone) => {
                    if (undone._tag === "Failure" && !isAtomCommandInterrupted(undone)) {
                      failureToast("Failed to wake thread", squashAtomCommandFailure(undone));
                    }
                  });
                },
              },
            }),
          );
          return;
        }
        const reportFailure = async (
          title: string,
          run: () => Promise<AtomCommandResult<unknown, unknown>>,
        ) => {
          const result = await run();
          if (result._tag === "Failure" && !isAtomCommandInterrupted(result)) {
            failureToast(title, squashAtomCommandFailure(result));
          }
        };
        switch (action) {
          case "focus-in-split-view":
            await threadNavigation.openTarget(
              { kind: "server", threadRef },
              { history: "push", disposition: "activate-existing-group" },
            );
            return;
          case "remove-from-split-view":
            threadSplitStore.getState().removeTarget(splitTargetKey);
            return;
          case "open-in-current-split-view": {
            const groupId = threadSplitStore.getState().activeGroupId;
            if (!groupId) return;
            const openedGroupId = threadSplitStore.getState().openTargets([splitTargetKey], {
              groupId,
              mode: "add",
              focusTargetKey: splitTargetKey,
            });
            if (openedGroupId) {
              await threadNavigation.openTarget(
                { kind: "server", threadRef },
                { history: "push", disposition: "activate-existing-group" },
              );
            }
            return;
          }
          case "start-split-view": {
            if (!focusedTargetKey || focusedTargetKey === splitTargetKey) return;
            const groupId = threadSplitStore
              .getState()
              .openTargets([focusedTargetKey, splitTargetKey], {
                mode: "new-group",
                focusTargetKey: splitTargetKey,
              });
            if (groupId) {
              await threadNavigation.openTarget(
                { kind: "server", threadRef },
                { history: "push", disposition: "activate-existing-group" },
              );
            }
            return;
          }
          case "split-task-tree":
          case "open-task-split-view": {
            const rootRef = scopeThreadRef(threadRef.environmentId, rootThreadId);
            const result = threadSplitStore
              .getState()
              .openTaskTree(
                `server:${scopedThreadKey(rootRef)}` as ThreadSplitTargetKey,
                splitCatalog,
              );
            if (result.omittedCount > 0) {
              toastManager.add({
                type: "info",
                title: `Task split view limited to ${THREAD_SPLIT_MAX_PANES} panes`,
                description: `${result.omittedCount} descendant${
                  result.omittedCount === 1 ? "" : "s"
                } remain available to add.`,
              });
            }
            if (result.groupId) {
              await threadNavigation.openTarget(
                { kind: "server", threadRef: rootRef },
                { history: "push", disposition: "activate-existing-group" },
              );
            }
            return;
          }
          case "new-thread-on-branch": {
            // Explicit branch carry-over: reuse the thread's worktree when it
            // has one, otherwise its branch on the local checkout.
            const result = await settlePromise(() =>
              handleNewThread(scopeProjectRef(threadRef.environmentId, thread.projectId), {
                branch: thread.branch,
                worktreePath: thread.worktreePath,
                envMode: thread.worktreePath ? "worktree" : "local",
                startFromOrigin: false,
              }),
            );
            if (result._tag === "Failure") {
              failureToast("Could not create thread", squashAtomCommandFailure(result));
            }
            return;
          }
          case "settle":
            await reportFailure("Failed to settle thread", () => settleThread(threadRef));
            return;
          case "unsettle":
            await reportFailure("Failed to un-settle thread", () => unsettleThread(threadRef));
            return;
          case "unsnooze":
            await reportFailure("Failed to wake thread", () => unsnoozeThread(threadRef));
            return;
          case "pin":
            await reportFailure("Failed to pin thread", () => pinThread(threadRef));
            return;
          case "unpin":
            await reportFailure("Failed to unpin thread", () => unpinThread(threadRef));
            return;
          case "rename":
            onStartRename();
            return;
          case "regenerate-title":
            if (isRegeneratingTitle) return;
            await reportFailure("Failed to regenerate thread title", () =>
              updateThreadMetadata({
                environmentId: threadRef.environmentId,
                input: { threadId: threadRef.threadId, regenerateTitle: true },
              }),
            );
            return;
          case "mark-unread":
            markThreadUnread(scopedThreadKey(threadRef), thread.latestTurn?.completedAt);
            return;
          case "copy-path": {
            const workspacePath = thread.worktreePath ?? projectCwd;
            if (!workspacePath) {
              toastManager.add(
                stackedThreadToast({
                  type: "error",
                  title: "Path unavailable",
                  description: "This thread does not have a workspace path to copy.",
                }),
              );
              return;
            }
            copyPathToClipboard(workspacePath, { path: workspacePath });
            return;
          }
          case "copy-thread-id":
            copyThreadIdToClipboard(thread.id, { threadId: thread.id });
            return;
          case "copy-branch":
            if (thread.branch) {
              copyBranchToClipboard(thread.branch, { branch: thread.branch });
            }
            return;
          case "delete": {
            if (confirmThreadDelete) {
              const confirmed = await settlePromise(() =>
                api.dialogs.confirm(
                  [
                    `Delete thread "${thread.title}"?`,
                    "This permanently clears conversation history for this thread.",
                  ].join("\n"),
                  { variant: "destructive" },
                ),
              );
              if (confirmed._tag === "Failure" || !confirmed.value) return;
            }
            const deleted = await deleteThread(threadRef);
            if (
              deleted._tag === "Failure" &&
              !isAtomCommandInterrupted(deleted) &&
              // A failure with the thread already gone is worktree cleanup
              // failing after a successful delete — deleteThread has toasted
              // that itself, and "Failed to delete thread" would be a lie.
              readThreadShell(threadRef) !== null
            ) {
              failureToast("Failed to delete thread", squashAtomCommandFailure(deleted));
            }
            return;
          }
          default:
            return;
        }
      })();
    },
    [
      autoSettleAfterDays,
      confirmThreadDelete,
      copyBranchToClipboard,
      copyPathToClipboard,
      copyThreadIdToClipboard,
      deleteThread,
      handleNewThread,
      markThreadUnread,
      onStartRename,
      pinThread,
      projectCwd,
      settleThread,
      snoozeThread,
      splitCatalog,
      threadRef,
      threadNavigation,
      timestampFormat,
      unpinThread,
      unsettleThread,
      unsnoozeThread,
      updateThreadMetadata,
    ],
  );

  return { openMenu };
}
