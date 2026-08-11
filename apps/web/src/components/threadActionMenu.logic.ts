import type { ContextMenuItem } from "@t3tools/contracts";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import { THREAD_SPLIT_MAX_PANES } from "../threadSplitStore";

/**
 * Ids for the per-thread action menu. Snooze presets are dispatched as
 * `snooze:<presetId>` so the union stays closed while the preset list
 * remains data-driven.
 */
export type ThreadActionMenuId =
  | "new-thread-on-branch"
  | "focus-in-split-view"
  | "remove-from-split-view"
  | "open-in-current-split-view"
  | "start-split-view"
  | "split-task-tree"
  | "open-task-split-view"
  | "unnest-task"
  | "renest-task"
  | "pin"
  | "unpin"
  | "settle"
  | "unsettle"
  | "snooze"
  | `snooze:${string}`
  | "unsnooze"
  | "rename"
  | "regenerate-title"
  | "mark-unread"
  | "copy-path"
  | "copy-thread-id"
  | "copy-branch"
  | "delete";

export interface ThreadActionMenuState {
  readonly branch: string | null;
  readonly isPinned: boolean;
  readonly isSettled: boolean;
  readonly isSnoozed: boolean;
  readonly canSnoozeNow: boolean;
  readonly isRegeneratingTitle: boolean;
  readonly supports: {
    readonly settlement: boolean;
    readonly snooze: boolean;
    readonly pinning: boolean;
    readonly titleRegeneration: boolean;
  };
  readonly snoozePresets: ReadonlyArray<SnoozePreset>;
  /**
   * Sidebar and header menus use the same split actions. The state stays
   * declarative so either surface can provide its own navigation dispatcher.
   */
  readonly split?: {
    readonly grouped: boolean;
    readonly activeGroupPaneCount: number | null;
    readonly hasDifferentFocusedTarget: boolean;
    readonly hasTaskDescendants: boolean;
    readonly hasTaskSplitGroup: boolean;
  };
  /** Sidebar-only visual nesting preference for task children. */
  readonly taskNesting?: {
    readonly unnested: boolean;
  };
}

/**
 * Single source for the per-thread action menu: the sidebar row's right-click
 * menu and the chat header menu both render exactly this list, so labels,
 * ordering, and capability gating cannot drift between the two surfaces.
 */
export function buildThreadActionMenuItems(
  state: ThreadActionMenuState,
): ReadonlyArray<ContextMenuItem<ThreadActionMenuId>> {
  return [
    ...(state.branch
      ? [
          {
            id: "new-thread-on-branch" as const,
            label: `New thread on ${state.branch}`,
          },
        ]
      : []),
    ...(state.split?.grouped
      ? [
          { id: "focus-in-split-view" as const, label: "Focus in split view" },
          { id: "remove-from-split-view" as const, label: "Remove from split view" },
        ]
      : [
          ...(state.split?.activeGroupPaneCount !== null &&
          state.split?.activeGroupPaneCount !== undefined
            ? [
                {
                  id: "open-in-current-split-view" as const,
                  label: "Open in current split view",
                  disabled: state.split.activeGroupPaneCount >= THREAD_SPLIT_MAX_PANES,
                },
              ]
            : []),
          ...(state.split?.hasDifferentFocusedTarget
            ? [
                {
                  id: "start-split-view" as const,
                  label: "Start split view with current thread",
                },
              ]
            : []),
        ]),
    ...(state.split?.hasTaskDescendants
      ? [
          state.split.hasTaskSplitGroup
            ? { id: "open-task-split-view" as const, label: "Open task split view" }
            : { id: "split-task-tree" as const, label: "Split task tree" },
        ]
      : []),
    ...(state.taskNesting
      ? [
          state.taskNesting.unnested
            ? { id: "renest-task" as const, label: "Nest under parent task" }
            : { id: "unnest-task" as const, label: "Show as root task" },
        ]
      : []),
    ...(state.supports.pinning
      ? [
          state.isPinned
            ? { id: "unpin" as const, label: "Unpin thread" }
            : { id: "pin" as const, label: "Pin thread" },
        ]
      : []),
    // Both lifecycle actions stay available on pinned threads: settling
    // clears the pin ("done" beats "keep on top"), and snoozing hides the
    // card until wake with the pin intact.
    ...(state.supports.settlement
      ? [
          state.isSettled
            ? { id: "unsettle" as const, label: "Un-settle thread" }
            : { id: "settle" as const, label: "Settle thread" },
        ]
      : []),
    ...(state.supports.snooze
      ? [
          state.isSnoozed
            ? { id: "unsnooze" as const, label: "Wake thread" }
            : {
                id: "snooze" as const,
                label: "Snooze",
                disabled: !state.canSnoozeNow,
                children: state.snoozePresets.map((preset) => ({
                  id: `snooze:${preset.id}` as const,
                  label: `${preset.label} (${preset.whenLabel})`,
                })),
              },
        ]
      : []),
    { id: "rename", label: "Rename thread" },
    ...(state.supports.titleRegeneration
      ? [
          {
            id: "regenerate-title" as const,
            label: state.isRegeneratingTitle ? "Regenerating…" : "Regenerate title",
            disabled: state.isRegeneratingTitle,
          },
        ]
      : []),
    { id: "mark-unread", label: "Mark unread" },
    { id: "copy-path", label: "Copy path", icon: "copy" },
    { id: "copy-thread-id", label: "Copy thread ID", icon: "copy" },
    ...(state.branch ? [{ id: "copy-branch" as const, label: "Copy branch", icon: "copy" }] : []),
    { id: "delete", label: "Delete", destructive: true, icon: "trash" },
  ];
}
