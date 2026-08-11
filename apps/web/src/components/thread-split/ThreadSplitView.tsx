import {
  parseScopedThreadKey,
  scopedThreadKey,
  scopeThreadRef,
} from "@t3tools/client-runtime/environment";
import type { ScopedThreadRef } from "@t3tools/contracts";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
} from "react";

import ChatView from "../ChatView";
import { MAX_HIDDEN_MOUNTED_TERMINAL_THREADS } from "../ChatView.logic";
import { DiffWorkerPoolProvider } from "../DiffWorkerPoolProvider";
import { useComposerDraftStore } from "../../composerDraftStore";
import {
  isCompactThreadSplitWorkspace,
  resizeThreadSplitDividerWeights,
  resolveThreadSplitLayout,
  type ThreadSplitDivider,
  type ThreadSplitPlacement,
} from "../../threadSplitLayout";
import {
  getThreadSplitGroupForTarget,
  threadSplitStore,
  type ThreadSplitGroup,
  type ThreadSplitLayoutMode,
  type ThreadSplitTargetKey,
} from "../../threadSplitStore";
import {
  splitKeyToThreadRouteTarget,
  threadRouteTargetToSplitKey,
  type ThreadRouteTarget,
} from "../../threadRoutes";
import { resolveThreadSyncPhase } from "../../threadSync";
import { useThreadNavigation, type ThreadNavigation } from "../../threadSplitNavigation";
import { selectThreadTerminalUiState, useTerminalUiStateStore } from "../../terminalUiStateStore";
import { useThreadDetail, useThreadShell, useThreadStatus } from "../../state/entities";
import {
  hasMeaningfulThreadSplitSizeChange,
  reconcileThreadSplitDrawerOwnerKeys,
  resolveThreadPaneAuxiliaryPanelPresentation,
  resolveShiftGridScrollDelta,
  resolveThreadSplitRenderTargets,
  resolveVisibleGridRowRange,
  selectOpenTerminalKeys,
  threadSplitDividerRenderKey,
  threadSplitSeparatorLabel,
} from "./ThreadSplitView.logic";
import { PersistentThreadTerminalDrawer } from "./PersistentThreadTerminalDrawer";
import {
  cachePersistentTerminalPaneRuntime,
  ThreadPaneRuntimeProvider,
  type PersistentTerminalPaneRuntime,
} from "./ThreadPaneRuntimeContext";
import { COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS } from "~/workspaceTitlebar";

export interface ThreadSplitViewProps {
  routeTarget: ThreadRouteTarget;
  forceExpandedMobileComposer?: boolean;
}

function useThreadSplitState() {
  return useSyncExternalStore(
    threadSplitStore.subscribe,
    threadSplitStore.getState,
    threadSplitStore.getInitialState,
  );
}

function useWorkspaceSize(containerRef: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 0, height: 0 });
  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const update = () => {
      const rect = container.getBoundingClientRect();
      const next = { width: Math.round(rect.width), height: Math.round(rect.height) };
      setSize((previous) =>
        previous.width === 0 ||
        previous.height === 0 ||
        isCompactThreadSplitWorkspace(previous.width, previous.height) !==
          isCompactThreadSplitWorkspace(next.width, next.height) ||
        hasMeaningfulThreadSplitSizeChange(previous, next)
          ? next
          : previous,
      );
    };
    update();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(update);
    observer.observe(container);
    return () => observer.disconnect();
  }, [containerRef]);
  return size;
}

function ThreadTargetChat({
  targetKey,
  reserveTitleBarControlInset,
  forceExpandedMobileComposer,
}: {
  targetKey: ThreadSplitTargetKey;
  reserveTitleBarControlInset: boolean;
  forceExpandedMobileComposer?: boolean;
}) {
  const draftId = targetKey.startsWith("draft:") ? targetKey.slice("draft:".length) : null;
  const serverThreadRef = targetKey.startsWith("server:")
    ? parseScopedThreadKey(targetKey.slice("server:".length))
    : null;
  const draftSession = useComposerDraftStore((state) =>
    draftId ? state.getDraftSession(draftId as never) : null,
  );
  const serverThreadShell = useThreadShell(serverThreadRef);
  const serverThreadDetail = useThreadDetail(serverThreadRef);
  const serverThreadStatus = useThreadStatus(serverThreadRef);
  const threadSyncPhase = resolveThreadSyncPhase({
    detailExists: serverThreadDetail !== null,
    shellExists: serverThreadShell !== null,
    status: serverThreadStatus,
  });
  if (targetKey.startsWith("draft:")) {
    if (!draftSession || !draftId) return null;
    return (
      <ChatView
        draftId={draftId as never}
        environmentId={draftSession.environmentId}
        threadId={draftSession.threadId}
        routeKind="draft"
        reserveTitleBarControlInset={reserveTitleBarControlInset}
        {...(forceExpandedMobileComposer ? { forceExpandedMobileComposer: true } : {})}
      />
    );
  }
  if (!serverThreadRef) return null;
  return (
    <ChatView
      environmentId={serverThreadRef.environmentId}
      threadId={serverThreadRef.threadId}
      routeKind="server"
      reserveTitleBarControlInset={reserveTitleBarControlInset}
      threadSyncPhase={threadSyncPhase}
    />
  );
}

function DrawerOwner({
  threadRef,
  visible,
  runtime,
}: {
  threadRef: ScopedThreadRef;
  visible: boolean;
  runtime: PersistentTerminalPaneRuntime | null;
}) {
  return (
    <PersistentThreadTerminalDrawer threadRef={threadRef} visible={visible} runtime={runtime} />
  );
}

function targetThreadRef(targetKey: ThreadSplitTargetKey): ScopedThreadRef | null {
  if (targetKey.startsWith("server:")) {
    return parseScopedThreadKey(targetKey.slice("server:".length));
  }
  const draft = useComposerDraftStore
    .getState()
    .getDraftSession(targetKey.slice("draft:".length) as never);
  return draft ? scopeThreadRef(draft.environmentId, draft.threadId) : null;
}

function ThreadPaneHost({
  targetKey,
  placement,
  compact,
  focused,
  navigation,
  onFocus,
  threadKey,
  publishPersistentTerminalRuntime,
  forceExpandedMobileComposer,
}: {
  targetKey: ThreadSplitTargetKey;
  placement: ThreadSplitPlacement<ThreadSplitTargetKey> | null;
  compact: boolean;
  focused: boolean;
  navigation: ThreadNavigation;
  onFocus: () => void;
  threadKey: string | null;
  publishPersistentTerminalRuntime: (
    threadKey: string,
    runtime: PersistentTerminalPaneRuntime,
  ) => void;
  forceExpandedMobileComposer?: boolean;
}) {
  const style: CSSProperties | undefined = placement
    ? {
        left: placement.x,
        top: placement.y,
        width: placement.width,
        height: placement.height,
      }
    : undefined;
  const reserveTitleBarControlInset =
    compact || !placement || (placement.x === 0 && placement.y === 0);
  const publishRuntime = useCallback(
    (runtime: PersistentTerminalPaneRuntime) => {
      if (threadKey) publishPersistentTerminalRuntime(threadKey, runtime);
    },
    [publishPersistentTerminalRuntime, threadKey],
  );
  return (
    <section
      data-thread-pane={targetKey}
      data-focused={focused ? "true" : "false"}
      className={`${placement ? "absolute" : "relative h-full w-full"} isolate flex min-h-0 min-w-0 flex-col overflow-hidden bg-background outline outline-2 -outline-offset-2 ${
        focused ? "z-10 outline-primary" : "z-0 outline-border/60"
      }`}
      style={style}
      onPointerDownCapture={onFocus}
      onFocusCapture={onFocus}
    >
      <ThreadPaneRuntimeProvider
        value={{
          isFocused: focused,
          navigation,
          presentation: compact ? "compact" : "pane",
          auxiliaryPanelPresentation: resolveThreadPaneAuxiliaryPanelPresentation(
            placement,
            compact,
          ),
          ownsPersistentTerminalDrawer: false,
          publishPersistentTerminalRuntime: publishRuntime,
        }}
      >
        <ThreadTargetChat
          targetKey={targetKey}
          reserveTitleBarControlInset={reserveTitleBarControlInset}
          {...(forceExpandedMobileComposer ? { forceExpandedMobileComposer: true } : {})}
        />
      </ThreadPaneRuntimeProvider>
    </section>
  );
}

function SplitSeparator({
  divider,
  layoutExtent,
  onResize,
}: {
  divider: ThreadSplitDivider<ThreadSplitTargetKey>;
  layoutExtent: number;
  onResize: (desiredPosition: number, commit: boolean) => void;
}) {
  const frameRef = useRef<number | null>(null);
  const latestPositionRef = useRef(divider.position);
  const flush = useCallback(
    (commit: boolean) => {
      if (frameRef.current !== null) cancelAnimationFrame(frameRef.current);
      frameRef.current = null;
      onResize(latestPositionRef.current, commit);
    },
    [onResize],
  );
  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    const separator = event.currentTarget;
    separator.focus({ preventScroll: true });
    event.preventDefault();
    separator.setPointerCapture(event.pointerId);
    const origin = divider.axis === "vertical" ? event.clientX : event.clientY;
    const startingPosition = divider.position;
    const move = (moveEvent: PointerEvent) => {
      const coordinate = divider.axis === "vertical" ? moveEvent.clientX : moveEvent.clientY;
      latestPositionRef.current = startingPosition + coordinate - origin;
      if (frameRef.current === null) {
        frameRef.current = requestAnimationFrame(() => flush(false));
      }
    };
    const finish = () => {
      separator.removeEventListener("pointermove", move);
      separator.removeEventListener("pointerup", finish);
      separator.removeEventListener("pointercancel", finish);
      flush(true);
    };
    separator.addEventListener("pointermove", move);
    separator.addEventListener("pointerup", finish);
    separator.addEventListener("pointercancel", finish);
  };
  const vertical = divider.axis === "vertical";
  if (!divider.draggable) {
    return (
      <div
        aria-hidden
        className="pointer-events-none absolute z-40 bg-border"
        style={
          vertical
            ? {
                left: divider.position,
                top: divider.start,
                width: 1,
                height: divider.end - divider.start,
              }
            : {
                top: divider.position,
                left: divider.start,
                width: divider.end - divider.start,
                height: 1,
              }
        }
      />
    );
  }
  return (
    <div
      role="separator"
      tabIndex={0}
      aria-label={threadSplitSeparatorLabel(divider.before, divider.after)}
      aria-orientation={vertical ? "vertical" : "horizontal"}
      aria-valuemin={0}
      aria-valuemax={Math.round(layoutExtent)}
      aria-valuenow={Math.round(divider.position)}
      className={`group/separator absolute z-40 touch-none bg-transparent ${
        vertical
          ? "w-3 cursor-col-resize after:absolute after:inset-y-0 after:left-1/2 after:w-px after:-translate-x-1/2 after:bg-border after:content-[''] hover:after:w-0.5 hover:after:bg-primary focus-visible:after:w-0.5 focus-visible:after:bg-primary"
          : "h-3 cursor-row-resize after:absolute after:inset-x-0 after:top-1/2 after:h-px after:-translate-y-1/2 after:bg-border after:content-[''] hover:after:h-0.5 hover:after:bg-primary focus-visible:after:h-0.5 focus-visible:after:bg-primary"
      }`}
      style={
        vertical
          ? { left: divider.position - 6, top: divider.start, height: divider.end - divider.start }
          : { top: divider.position - 6, left: divider.start, width: divider.end - divider.start }
      }
      onPointerDown={onPointerDown}
      onKeyDown={(event) => {
        const direction =
          vertical && event.key === "ArrowLeft"
            ? -1
            : vertical && event.key === "ArrowRight"
              ? 1
              : !vertical && event.key === "ArrowUp"
                ? -1
                : !vertical && event.key === "ArrowDown"
                  ? 1
                  : 0;
        if (direction === 0) return;
        event.preventDefault();
        onResize(divider.position + direction * layoutExtent * (event.shiftKey ? 0.1 : 0.05), true);
      }}
    />
  );
}

function LayoutControls({
  group,
  onLayout,
  onGrid,
  gridStatus,
  onRemove,
  onClose,
}: {
  group: ThreadSplitGroup;
  onLayout: (mode: ThreadSplitLayoutMode) => void;
  onGrid: (gridColumns: number, gridRows: number) => void;
  gridStatus: string | null;
  onRemove: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={`absolute inset-x-0 top-0 z-50 flex h-10 items-center gap-2 border-b border-border/60 bg-background px-2 ${COLLAPSED_SIDEBAR_TITLEBAR_INSET_CLASS}`}
    >
      <div className="flex min-w-0 items-center gap-1 rounded border border-border bg-background p-1">
        {(["auto", "columns", "rows", "grid"] as const).map((mode) => (
          <button
            key={mode}
            type="button"
            aria-pressed={group.layoutMode === mode}
            className="rounded px-2 py-1 text-xs aria-pressed:bg-accent"
            onClick={() => onLayout(mode)}
          >
            {mode === "auto"
              ? "Auto"
              : mode === "columns"
                ? "Side by side"
                : mode === "rows"
                  ? "Top and bottom"
                  : "Grid"}
          </button>
        ))}
        {group.layoutMode === "grid" ? (
          <label className="flex items-center gap-1 px-1 text-xs text-muted-foreground">
            <span>Columns × visible rows</span>
            <select
              aria-label="Grid columns"
              className="rounded border border-border bg-background px-1 py-0.5 text-foreground"
              value={group.gridColumns ?? 3}
              onChange={(event) => onGrid(Number(event.currentTarget.value), group.gridRows ?? 3)}
            >
              {[1, 2, 3, 4, 5, 6].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
            <span>×</span>
            <select
              aria-label="Grid visible rows"
              className="rounded border border-border bg-background px-1 py-0.5 text-foreground"
              value={group.gridRows ?? 3}
              onChange={(event) =>
                onGrid(group.gridColumns ?? 3, Number(event.currentTarget.value))
              }
            >
              {[1, 2, 3, 4, 5, 6].map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <button type="button" className="rounded px-2 py-1 text-xs" onClick={onRemove}>
          Remove pane
        </button>
        <button type="button" className="rounded px-2 py-1 text-xs" onClick={onClose}>
          Close split
        </button>
      </div>
      {gridStatus ? (
        <span className="ml-auto text-xs text-muted-foreground">{gridStatus}</span>
      ) : null}
    </div>
  );
}

export function ThreadSplitView({
  routeTarget,
  forceExpandedMobileComposer,
}: ThreadSplitViewProps) {
  const routeTargetKey = threadRouteTargetToSplitKey(routeTarget);
  const state = useThreadSplitState();
  const navigation = useThreadNavigation(routeTarget);
  const group = getThreadSplitGroupForTarget(state, routeTargetKey);
  const containerRef = useRef<HTMLDivElement>(null);
  const size = useWorkspaceSize(containerRef);
  const compact = Boolean(group) && isCompactThreadSplitWorkspace(size.width, size.height);
  const renderTargets = useMemo(
    () => resolveThreadSplitRenderTargets(routeTargetKey, group, compact),
    [compact, group, routeTargetKey],
  );
  const [previewWeights, setPreviewWeights] = useState<readonly number[] | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const gridScrollFrameRef = useRef<number | null>(null);
  const [gridScrollTop, setGridScrollTop] = useState(0);
  const splitToolbarHeight = group && !compact ? 40 : 0;
  const layout = group
    ? resolveThreadSplitLayout({
        targets: group.targetKeys,
        mode: group.layoutMode,
        width: size.width,
        height: Math.max(0, size.height - splitToolbarHeight),
        weights: previewWeights ?? group.weights,
        gridColumns: group.gridColumns ?? 3,
        gridRows: group.gridRows ?? 3,
      })
    : null;

  useEffect(() => {
    const current = threadSplitStore.getState();
    if (getThreadSplitGroupForTarget(current, routeTargetKey)) {
      current.focusTarget(routeTargetKey);
    }
  }, [routeTargetKey]);
  useEffect(() => setPreviewWeights(null), [group?.id, group?.weights]);
  useEffect(() => {
    setGridScrollTop(0);
    scrollRef.current?.scrollTo({ top: 0 });
  }, [group?.id, group?.layoutMode]);
  useEffect(
    () => () => {
      if (gridScrollFrameRef.current !== null) cancelAnimationFrame(gridScrollFrameRef.current);
    },
    [],
  );

  const openTerminalKeys = useTerminalUiStateStore((terminalState) =>
    selectOpenTerminalKeys(terminalState.terminalUiStateByThreadKey),
  );
  const ownerTargets = group?.targetKeys ?? renderTargets;
  const ownerThreadRefs = useMemo(
    () =>
      ownerTargets.flatMap((targetKey) => {
        const ref = targetThreadRef(targetKey);
        return ref ? [ref] : [];
      }),
    [ownerTargets],
  );
  const ownerThreadKeys = useMemo(() => ownerThreadRefs.map(scopedThreadKey), [ownerThreadRefs]);
  const renderedThreadKeys = useMemo(
    () =>
      renderTargets.flatMap((targetKey) => {
        const ref = targetThreadRef(targetKey);
        return ref ? [scopedThreadKey(ref)] : [];
      }),
    [renderTargets],
  );
  const [drawerOwnerKeys, setDrawerOwnerKeys] = useState<string[]>(ownerThreadKeys);
  const [persistentTerminalRuntimeByThreadKey, setPersistentTerminalRuntimeByThreadKey] = useState<
    Record<string, PersistentTerminalPaneRuntime>
  >({});
  const publishPersistentTerminalRuntime = useCallback(
    (threadKey: string, runtime: PersistentTerminalPaneRuntime) => {
      setPersistentTerminalRuntimeByThreadKey((current) =>
        cachePersistentTerminalPaneRuntime(current, threadKey, runtime),
      );
    },
    [],
  );
  useEffect(() => {
    setDrawerOwnerKeys((current) =>
      reconcileThreadSplitDrawerOwnerKeys(
        current,
        ownerThreadKeys,
        openTerminalKeys,
        MAX_HIDDEN_MOUNTED_TERMINAL_THREADS,
      ),
    );
  }, [openTerminalKeys, ownerThreadKeys]);
  const focusTarget = (targetKey: ThreadSplitTargetKey) => {
    if (group?.focusedTargetKey === targetKey) return;
    const target = splitKeyToThreadRouteTarget(targetKey);
    if (!target) return;
    void navigation.openTarget(target, { history: "replace" });
  };
  const removeTarget = (targetKey: ThreadSplitTargetKey) => {
    const current = threadSplitStore.getState();
    const owner = getThreadSplitGroupForTarget(current, targetKey);
    const nextTarget =
      owner?.focusedTargetKey !== targetKey
        ? owner?.focusedTargetKey
        : owner.targetKeys.find((key) => key !== targetKey);
    current.removeTarget(targetKey);
    if (nextTarget) focusTarget(nextTarget);
  };
  const gridOverflows = Boolean(
    group?.layoutMode === "grid" && layout && layout.overflowHeight > layout.height,
  );
  const gridStatus =
    group?.layoutMode === "grid" && layout && gridOverflows
      ? (() => {
          const paneHeight = layout.placements[0]?.height ?? layout.height;
          const range = resolveVisibleGridRowRange({
            scrollTop: gridScrollTop,
            paneHeight,
            visibleRows: Math.max(1, Math.round(layout.height / Math.max(1, paneHeight))),
            totalRows: layout.bands.length,
          });
          return `Visible rows ${range.start}–${range.end} · Shift + scroll`;
        })()
      : null;

  return (
    <DiffWorkerPoolProvider>
      <div ref={containerRef} className="relative min-h-0 min-w-0 flex-1">
        {group && compact ? (
          <label className="absolute inset-x-0 top-0 z-50 flex h-10 items-center gap-2 border-b border-border bg-background px-2 text-xs">
            <span>Split pane</span>
            <select
              aria-label="Focused split pane"
              className="min-w-0 flex-1 rounded border border-border bg-background px-2 py-1"
              value={group.focusedTargetKey}
              onChange={(event) => focusTarget(event.currentTarget.value as ThreadSplitTargetKey)}
            >
              {group.targetKeys.map((targetKey) => (
                <option key={targetKey} value={targetKey}>
                  {targetKey}
                </option>
              ))}
            </select>
            <button type="button" onClick={() => removeTarget(group.focusedTargetKey)}>
              Remove
            </button>
            <button type="button" onClick={() => threadSplitStore.getState().closeGroup(group.id)}>
              Close
            </button>
          </label>
        ) : null}
        {group && !compact ? (
          <LayoutControls
            group={group}
            onLayout={(layoutMode) =>
              threadSplitStore.getState().configureGroup(group.id, { layoutMode })
            }
            onGrid={(gridColumns, gridRows) =>
              threadSplitStore.getState().configureGroup(group.id, { gridColumns, gridRows })
            }
            gridStatus={gridStatus}
            onRemove={() => removeTarget(group.focusedTargetKey)}
            onClose={() => threadSplitStore.getState().closeGroup(group.id)}
          />
        ) : null}
        <div
          ref={scrollRef}
          className={`absolute inset-0 min-h-0 min-w-0 ${
            group?.layoutMode === "grid" && !compact
              ? "overflow-x-hidden overflow-y-auto [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
              : "overflow-x-auto overflow-y-hidden"
          }`}
          onWheelCapture={(event) => {
            if (!gridOverflows || !event.shiftKey) return;
            const delta = resolveShiftGridScrollDelta(event.deltaX, event.deltaY);
            if (delta === 0) return;
            event.preventDefault();
            event.currentTarget.scrollTop += delta;
          }}
          onScroll={(event) => {
            if (!gridOverflows || gridScrollFrameRef.current !== null) return;
            const scrollTop = event.currentTarget.scrollTop;
            gridScrollFrameRef.current = requestAnimationFrame(() => {
              gridScrollFrameRef.current = null;
              setGridScrollTop(scrollTop);
            });
          }}
        >
          <div
            className="relative min-h-0 min-w-0"
            style={{
              width: layout?.overflowWidth ?? "100%",
              height: layout?.overflowHeight ?? "100%",
              ...(compact ? { paddingTop: 40 } : splitToolbarHeight ? { marginTop: 40 } : {}),
            }}
          >
            {renderTargets.map((targetKey) => {
              const placement =
                group && !compact
                  ? (layout?.placements.find((entry) => entry.target === targetKey) ?? null)
                  : null;
              const ref = targetThreadRef(targetKey);
              const refKey = ref ? scopedThreadKey(ref) : null;
              return (
                <ThreadPaneHost
                  key={targetKey}
                  targetKey={targetKey}
                  placement={placement}
                  compact={compact}
                  focused={!group || group.focusedTargetKey === targetKey}
                  navigation={navigation}
                  onFocus={() => focusTarget(targetKey)}
                  threadKey={refKey}
                  publishPersistentTerminalRuntime={publishPersistentTerminalRuntime}
                  {...(forceExpandedMobileComposer ? { forceExpandedMobileComposer: true } : {})}
                />
              );
            })}
            {group && !compact
              ? layout?.dividers.map((divider) => (
                  <SplitSeparator
                    key={threadSplitDividerRenderKey(layout.mode, divider)}
                    divider={divider}
                    layoutExtent={
                      divider.axis === "vertical" ? layout.overflowWidth : layout.overflowHeight
                    }
                    onResize={(desiredPosition, commit) => {
                      if (divider.dividerIndex === null) return;
                      const vertical = divider.axis === "vertical";
                      const minimum = vertical ? 320 : 240;
                      const next = resizeThreadSplitDividerWeights(
                        previewWeights ?? group.weights,
                        group.targetKeys,
                        divider,
                        desiredPosition,
                        minimum,
                      );
                      setPreviewWeights(next);
                      if (commit) {
                        threadSplitStore.getState().configureGroup(group.id, { weights: next });
                        setPreviewWeights(null);
                      }
                    }}
                  />
                ))
              : null}
            {drawerOwnerKeys.map((key) => {
              const ref = parseScopedThreadKey(key);
              if (!ref) return null;
              const targetKey =
                ownerTargets.find((candidate) => {
                  const candidateRef = targetThreadRef(candidate);
                  return candidateRef ? scopedThreadKey(candidateRef) === key : false;
                }) ?? null;
              const placement =
                targetKey && group && !compact
                  ? (layout?.placements.find((entry) => entry.target === targetKey) ?? null)
                  : null;
              const visible = renderedThreadKeys.includes(key);
              const terminal = selectThreadTerminalUiState(
                useTerminalUiStateStore.getState().terminalUiStateByThreadKey,
                ref,
              );
              return (
                <div
                  key={key}
                  data-terminal-drawer-owner={key}
                  hidden={!visible}
                  className="pointer-events-none absolute z-20 [&>*]:pointer-events-auto"
                  style={
                    placement
                      ? {
                          left: placement.x,
                          top: placement.y,
                          width: placement.width,
                          height: placement.height,
                        }
                      : {
                          inset: 0,
                          ...(compact ? { top: 40 } : {}),
                        }
                  }
                >
                  <DrawerOwner
                    threadRef={ref}
                    visible={visible && terminal.terminalOpen}
                    runtime={persistentTerminalRuntimeByThreadKey[key] ?? null}
                  />
                </div>
              );
            })}
          </div>
        </div>
      </div>
    </DiffWorkerPoolProvider>
  );
}
