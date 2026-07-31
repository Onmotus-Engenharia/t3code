import {
  Columns2Icon,
  LayoutGridIcon,
  ListPlusIcon,
  MoreHorizontalIcon,
  Rows2Icon,
  SplitIcon,
  XIcon,
} from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "~/lib/utils";
import type {
  ThreadSplitGroup,
  ThreadSplitLayoutMode,
  ThreadSplitTargetKey,
} from "../../threadSplitStore";

export interface ThreadSplitShelfTarget {
  title: string;
  statusLabel: string;
  icon?: ReactNode;
  splitIndicator?: ReactNode;
}

export interface ThreadSplitShelfGroup extends ThreadSplitGroup {
  availableDescendantKeys?: readonly ThreadSplitTargetKey[];
}

export interface ThreadSplitShelfProps {
  groups: readonly ThreadSplitShelfGroup[];
  activeGroupId: string | null;
  resolveTarget: (targetKey: ThreadSplitTargetKey) => ThreadSplitShelfTarget;
  onFocusTarget: (targetKey: ThreadSplitTargetKey) => void;
  onRemoveTarget: (targetKey: ThreadSplitTargetKey) => void;
  onSetLayout: (groupId: string, layoutMode: ThreadSplitLayoutMode) => void;
  onCloseGroup: (groupId: string) => void;
  onAddThreads: (groupId: string) => void;
  onAddDescendants: (groupId: string, availableTargetKeys: readonly ThreadSplitTargetKey[]) => void;
  className?: string;
}

const layoutCopy: Record<ThreadSplitLayoutMode, { label: string; icon: typeof LayoutGridIcon }> = {
  auto: { label: "Auto layout", icon: LayoutGridIcon },
  columns: { label: "Side by side", icon: Columns2Icon },
  rows: { label: "Top and bottom", icon: Rows2Icon },
};

export function ThreadSplitIndicator({ className }: { className?: string }) {
  return (
    <SplitIcon
      aria-label="In split view"
      className={cn("size-3 shrink-0 text-muted-foreground", className)}
    />
  );
}

export function ThreadSplitShelf({
  groups,
  activeGroupId,
  resolveTarget,
  onFocusTarget,
  onRemoveTarget,
  onSetLayout,
  onCloseGroup,
  onAddThreads,
  onAddDescendants,
  className,
}: ThreadSplitShelfProps) {
  if (groups.length === 0) return null;
  return (
    <section aria-label="Split views" className={cn("px-2 py-2", className)}>
      <div className="mb-1.5 flex items-center gap-1.5 px-1 font-medium text-muted-foreground text-xs">
        <SplitIcon aria-hidden className="size-3.5" />
        <span>Split views</span>
      </div>
      <div className="space-y-2">
        {groups.map((group) => (
          <ThreadSplitShelfCard
            active={group.id === activeGroupId}
            group={group}
            key={group.id}
            onAddDescendants={onAddDescendants}
            onAddThreads={onAddThreads}
            onCloseGroup={onCloseGroup}
            onFocusTarget={onFocusTarget}
            onRemoveTarget={onRemoveTarget}
            onSetLayout={onSetLayout}
            resolveTarget={resolveTarget}
          />
        ))}
      </div>
    </section>
  );
}

function ThreadSplitShelfCard({
  group,
  active,
  resolveTarget,
  onFocusTarget,
  onRemoveTarget,
  onSetLayout,
  onCloseGroup,
  onAddThreads,
  onAddDescendants,
}: Omit<ThreadSplitShelfProps, "groups" | "activeGroupId" | "className"> & {
  group: ThreadSplitShelfGroup;
  active: boolean;
}) {
  const layout = layoutCopy[group.layoutMode];
  const LayoutIcon = layout.icon;
  const available = group.availableDescendantKeys ?? [];
  return (
    <article
      aria-label={`${group.targetKeys.length}-pane split view`}
      className={cn(
        "rounded-xl border bg-background/50 p-1.5",
        active ? "border-primary/50 bg-primary/[0.04] ring-1 ring-primary/15" : "border-border/70",
      )}
      data-active={active || undefined}
    >
      <div className="mb-1 flex min-h-6 items-center gap-1 px-1">
        <LayoutIcon aria-hidden className="size-3.5 text-muted-foreground" />
        <span className="text-muted-foreground text-xs">
          {layout.label} · {group.targetKeys.length} panes
        </span>
        {available.length > 0 ? (
          <button
            aria-label={`Add descendants (${available.length} available)`}
            className="ms-auto rounded-full bg-accent px-1.5 py-0.5 font-medium text-[10px] text-accent-foreground"
            onClick={() => onAddDescendants(group.id, available)}
            type="button"
          >
            +{available.length}
          </button>
        ) : (
          <span className="ms-auto" />
        )}
        <details className="relative">
          <summary
            aria-label={`Split view actions for ${group.targetKeys.length} panes`}
            className="flex size-6 cursor-pointer list-none items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
          >
            <MoreHorizontalIcon aria-hidden className="size-4" />
          </summary>
          <div className="absolute end-0 z-50 mt-1 w-44 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
            {(["auto", "columns", "rows"] as const).map((mode) => {
              const item = layoutCopy[mode];
              const Icon = item.icon;
              return (
                <button
                  aria-pressed={group.layoutMode === mode}
                  className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                  key={mode}
                  onClick={() => onSetLayout(group.id, mode)}
                  type="button"
                >
                  <Icon aria-hidden className="size-3.5" />
                  {item.label}
                </button>
              );
            })}
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
              onClick={() => onAddThreads(group.id)}
              type="button"
            >
              <ListPlusIcon aria-hidden className="size-3.5" />
              Add threads…
            </button>
            {available.length > 0 && (
              <button
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent"
                onClick={() => onAddDescendants(group.id, available)}
                type="button"
              >
                <ListPlusIcon aria-hidden className="size-3.5" />
                Add descendants… ({available.length})
              </button>
            )}
            <button
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs text-destructive hover:bg-accent"
              onClick={() => onCloseGroup(group.id)}
              type="button"
            >
              <XIcon aria-hidden className="size-3.5" />
              Close split view
            </button>
          </div>
        </details>
      </div>
      <div className="grid grid-cols-2 gap-1" role="list">
        {group.targetKeys.map((targetKey) => {
          const target = resolveTarget(targetKey);
          const focused = targetKey === group.focusedTargetKey;
          return (
            <div
              className={cn(
                "group/chip flex min-w-0 items-center rounded-full border bg-muted/40 ps-2",
                focused && active
                  ? "border-primary/50 bg-primary/10 text-foreground"
                  : "border-transparent text-muted-foreground",
              )}
              data-focused={focused || undefined}
              key={targetKey}
              role="listitem"
            >
              <button
                aria-current={focused && active ? "page" : undefined}
                aria-label={`Focus ${target.title} in split view, ${target.statusLabel}`}
                className="flex min-w-0 flex-1 items-center gap-1.5 py-1.5 text-left text-xs"
                onClick={() => onFocusTarget(targetKey)}
                type="button"
              >
                {target.icon ?? <ThreadSplitIndicator />}
                <span className="truncate">{target.title}</span>
              </button>
              <button
                aria-label={`Remove ${target.title} from split view`}
                className="me-0.5 flex size-5 shrink-0 items-center justify-center rounded-full opacity-70 hover:bg-background hover:opacity-100"
                onClick={() => onRemoveTarget(targetKey)}
                type="button"
              >
                <XIcon aria-hidden className="size-3" />
              </button>
            </div>
          );
        })}
      </div>
    </article>
  );
}
