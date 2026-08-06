import type { ThreadSplitDivider, ThreadSplitLayoutMode } from "../../threadSplitLayout";
import type { ThreadSplitGroup, ThreadSplitTargetKey } from "../../threadSplitStore";

export const THREAD_SPLIT_MEANINGFUL_SIZE_DELTA = 8;

type TerminalUiStateByThreadKey = Readonly<Record<string, { readonly terminalOpen: boolean }>>;

const openTerminalKeysCache = new WeakMap<TerminalUiStateByThreadKey, readonly string[]>();

export function hasMeaningfulThreadSplitSizeChange(
  previous: { width: number; height: number },
  next: { width: number; height: number },
): boolean {
  return (
    Math.abs(previous.width - next.width) >= THREAD_SPLIT_MEANINGFUL_SIZE_DELTA ||
    Math.abs(previous.height - next.height) >= THREAD_SPLIT_MEANINGFUL_SIZE_DELTA
  );
}

export function resolveThreadSplitRenderTargets(
  routeTargetKey: ThreadSplitTargetKey,
  group: ThreadSplitGroup | undefined,
  compact: boolean,
): readonly ThreadSplitTargetKey[] {
  if (!group) return [routeTargetKey];
  return compact ? [group.focusedTargetKey] : group.targetKeys;
}

export function resolveThreadPaneAuxiliaryPanelPresentation(
  placement: { readonly width: number } | null,
  compact: boolean,
): "auto" | "inline" | "sheet" {
  if (compact) return "sheet";
  if (!placement) return "auto";
  return placement.width >= 720 ? "inline" : "sheet";
}

export function reconcileThreadSplitDrawerOwnerKeys(
  currentKeys: readonly string[],
  activeKeys: readonly string[],
  openKeys: readonly string[],
  hiddenLimit: number,
): string[] {
  const active = new Set(activeKeys);
  const open = new Set(openKeys);
  const retained = currentKeys.filter((key) => !active.has(key) && open.has(key));
  const hidden = retained.slice(-Math.max(0, hiddenLimit));
  return [...activeKeys, ...hidden.filter((key) => !active.has(key))];
}

export function selectOpenTerminalKeys(
  terminalUiStateByThreadKey: TerminalUiStateByThreadKey,
): readonly string[] {
  const cached = openTerminalKeysCache.get(terminalUiStateByThreadKey);
  if (cached) return cached;

  const keys = Object.entries(terminalUiStateByThreadKey)
    .filter(([, terminal]) => terminal.terminalOpen)
    .map(([key]) => key);
  openTerminalKeysCache.set(terminalUiStateByThreadKey, keys);
  return keys;
}

export function threadSplitSeparatorLabel(before: string, after: string): string {
  return `Resize panes between ${before} and ${after}`;
}

export function threadSplitDividerRenderKey(
  mode: ThreadSplitLayoutMode,
  divider: ThreadSplitDivider,
): string {
  return `${mode}:${divider.axis}:${divider.before}:${divider.after}`;
}

export function resolveShiftGridScrollDelta(deltaX: number, deltaY: number): number {
  return Math.abs(deltaX) > Math.abs(deltaY) ? deltaX : deltaY;
}

export function resolveVisibleGridRowRange(input: {
  scrollTop: number;
  paneHeight: number;
  visibleRows: number;
  totalRows: number;
}): { start: number; end: number } {
  if (input.totalRows <= 0) return { start: 0, end: 0 };
  const start = Math.min(
    input.totalRows - 1,
    Math.max(0, Math.floor(input.scrollTop / Math.max(1, input.paneHeight))),
  );
  return { start: start + 1, end: Math.min(input.totalRows, start + input.visibleRows) };
}
