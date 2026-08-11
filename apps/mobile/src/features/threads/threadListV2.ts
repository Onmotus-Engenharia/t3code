import {
  effectiveSettled,
  effectiveSnoozed,
  hasQueuedTurnStart,
  QUEUED_TURN_START_GRACE_MS,
  resolveSnoozePresets,
  snoozeWakeLabel,
} from "@t3tools/client-runtime/state/thread-settled";
import type { SnoozePreset } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { threadSearchMatchKey } from "@t3tools/client-runtime/state/thread-search";
import { sortPinnedThreadsByOrderKey } from "@t3tools/client-runtime/state/thread-sort";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import type { PendingNewTask } from "../../state/use-pending-new-tasks";

export { snoozeWakeLabel };

/**
 * Thread List v2 model, ported from the web sidebar v2
 * (apps/web/src/components/Sidebar.logic.ts + SidebarV2.tsx).
 *
 * Four visual states, three colors: color is reserved for "act now"
 * (approval), "in motion" (working), and "broken" (failed). Ready is the
 * unlabeled resting state.
 */
export type ThreadListV2Status = "approval" | "input" | "working" | "failed" | "ready";
export type ThreadListV2SwipeAction = "archive" | "settle" | "unsettle" | "snooze" | "unsnooze";

export function resolveThreadListV2SnoozeMenuSelection(input: {
  readonly event: string;
  readonly displayedPresets: ReadonlyArray<SnoozePreset>;
  readonly now: Date;
}):
  | { readonly _tag: "selected"; readonly preset: SnoozePreset }
  | { readonly _tag: "expired" }
  | { readonly _tag: "not-snooze" } {
  if (!input.event.startsWith("snooze:")) return { _tag: "not-snooze" };

  const currentPreset = resolveSnoozePresets(input.now).find(
    (candidate) => input.event === `snooze:${candidate.id}`,
  );
  if (currentPreset) return { _tag: "selected", preset: currentPreset };

  const displayedPreset = input.displayedPresets.find(
    (candidate) => input.event === `snooze:${candidate.id}`,
  );
  if (displayedPreset && Date.parse(displayedPreset.snoozedUntil) > input.now.getTime()) {
    return { _tag: "selected", preset: displayedPreset };
  }
  return { _tag: "expired" };
}

export function resolveThreadListV2SwipeActions(input: {
  readonly variant: "card" | "slim";
  readonly settlementSupported: boolean;
  readonly snoozeSupported: boolean;
  readonly snoozable: boolean;
  /** Row is on the snoozed shelf. */
  readonly snoozed?: boolean;
}): {
  readonly primary: Exclude<ThreadListV2SwipeAction, "snooze">;
  readonly secondary: "snooze" | null;
} {
  if (input.snoozed === true) {
    return { primary: "unsnooze", secondary: null };
  }
  const primary = input.settlementSupported
    ? input.variant === "slim"
      ? "unsettle"
      : "settle"
    : "archive";
  return {
    primary,
    secondary: input.snoozeSupported && input.snoozable ? "snooze" : null,
  };
}

/**
 * The point at which a queued-turn snooze guard expires on its own. Rows arm
 * a one-shot timer for this boundary so Snooze appears without waiting for an
 * unrelated render. User-blocked threads return null because only fresh
 * server data can make them snoozable.
 */
export function resolveThreadListV2SnoozeGateExpiryMs(
  thread: Pick<
    EnvironmentThreadShell,
    "hasPendingApprovals" | "hasPendingUserInput" | "latestUserMessageAt" | "latestTurn" | "session"
  >,
  options: { readonly now: string },
): number | null {
  if (thread.hasPendingApprovals || thread.hasPendingUserInput) return null;
  if (!hasQueuedTurnStart(thread, options)) return null;
  const messageAtMs = Date.parse(thread.latestUserMessageAt ?? "");
  if (Number.isNaN(messageAtMs)) return null;
  return messageAtMs + QUEUED_TURN_START_GRACE_MS;
}

// Settled-tail paging: recent history is the common lookup; the deep tail
// stays behind an explicit Show more. Shared by the compact Home list and
// the iPad sidebar so both page identically.
export const THREAD_LIST_V2_SETTLED_INITIAL_COUNT = 10;
export const THREAD_LIST_V2_SETTLED_PAGE_COUNT = 25;

/**
 * The flat Thread List v2 is the default on every app variant; the Settings →
 * Legacy toggle opts a device back into the grouped legacy list. Preferences
 * persist as sparse patches, so `undefined` genuinely means "never chosen".
 *
 * `preferencesLoaded` guards the startup window: preferences load
 * asynchronously, and rendering one list before the stored choice arrives would
 * remount the whole thing a tick later. While loading, hold the default — that
 * is where every device without an explicit legacy opt-in lands anyway.
 */
export function resolveThreadListV2Enabled(input: {
  readonly legacyPreference: boolean | undefined;
  readonly preferencesLoaded: boolean;
}): boolean {
  if (!input.preferencesLoaded) {
    return true;
  }
  return input.legacyPreference !== true;
}

export function resolveThreadListV2Status(
  thread: Pick<EnvironmentThreadShell, "hasPendingApprovals" | "hasPendingUserInput" | "session">,
): ThreadListV2Status {
  if (thread.hasPendingApprovals) {
    return "approval";
  }
  if (thread.hasPendingUserInput) {
    return "input";
  }
  if (thread.session?.status === "running" || thread.session?.status === "starting") {
    return "working";
  }
  if (thread.session?.status === "error") {
    return "failed";
  }
  return "ready";
}

/** NaN-safe Date.parse for sort comparators: a malformed timestamp must not
    poison the whole ordering, so it sinks to the epoch instead. */
function parseTimestampMs(isoDate: string): number {
  const parsed = Date.parse(isoDate);
  return Number.isNaN(parsed) ? 0 : parsed;
}

/** First VALID timestamp wins: a present-yet-malformed string falls through
    to the next candidate rather than sinking the row to the epoch. */
function firstValidTimestampMs(...candidates: ReadonlyArray<string | null | undefined>): number {
  for (const candidate of candidates) {
    if (candidate == null) continue;
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return 0;
}

/**
 * v2 sort: static creation order, newest thread on top. Activity NEVER
 * reorders the list — a row holds its position from open until settled, so
 * the screen only moves at lifecycle transitions. Mirrors web's
 * sortThreadsForSidebarV2.
 */
export function sortThreadsForListV2<T extends { readonly id: string; readonly createdAt: string }>(
  threads: readonly T[],
): T[] {
  // .sort() on a copy, not .toSorted(): Hermes doesn't ship the ES2023
  // change-by-copy array methods.
  return [...threads].sort(
    (left, right) =>
      parseTimestampMs(right.createdAt) - parseTimestampMs(left.createdAt) ||
      left.id.localeCompare(right.id),
  );
}

/** During the v0.0.33 transition, persisted shells can carry the original
 * boolean pin state or the newer timestamp. Treat either as pinned so an
 * upgraded client neither hides a legacy pin nor auto-settles it. */
export function isThreadListV2Pinned(
  thread: Pick<EnvironmentThreadShell, "pinned" | "pinnedAt">,
): boolean {
  return thread.pinned === true || thread.pinnedAt != null;
}

export interface ThreadListV2Item {
  readonly thread: EnvironmentThreadShell;
  /** Visual density only. Nested descendants are always compact. */
  readonly variant: "card" | "slim";
  /** Own lifecycle controls row action independently from density. */
  readonly lifecycle: ThreadSection;
  readonly threadKey: string;
  readonly rootThreadKey: string;
  readonly depth: number;
  readonly hasTaskParent: boolean;
  readonly visuallyUnnested: boolean;
  /** First settled row after the card block draws the SETTLED divider. */
  readonly showSettledDivider: boolean;
  /** Snoozed-shelf row: shows the wake countdown and offers Wake. */
  readonly snoozed: boolean;
  /** Pinned-block row: renders the pin glyph and offers Unpin. */
  readonly pinned: boolean;
  readonly isLast: boolean;
}

export interface ThreadListV2Layout {
  readonly items: ThreadListV2Item[];
  /** Settled threads beyond the render limit (behind "Show more"). */
  readonly hiddenSettledCount: number;
  /** Snoozed threads matching the current filters. */
  readonly snoozedCount: number;
  /** Index in `items` where the Snoozed shelf header belongs. The header is
      still rendered when the shelf is collapsed and no snoozed rows exist. */
  readonly snoozedShelfHeaderIndex: number | null;
  /** Total settled threads in scope, including rows hidden by collapse/paging. */
  readonly settledCount: number;
  /** Index in `items` where the Settled shelf header belongs. */
  readonly settledShelfHeaderIndex: number | null;
  /** Soonest wake time among snoozed threads, or null. Callers arm
      a timeout at this boundary so the list re-partitions the moment a
      snooze expires instead of on the next minute tick. */
  readonly nextSnoozeWakeAt: string | null;
}

export type ThreadSection = "active" | "snoozed" | "settled";
export type ThreadListV2LifecycleAction = "settle" | "unsettle" | "wake";

export function threadListV2LifecycleAction(lifecycle: ThreadSection): ThreadListV2LifecycleAction {
  if (lifecycle === "settled") return "unsettle";
  if (lifecycle === "snoozed") return "wake";
  return "settle";
}

export interface ThreadListV2CascadeStep {
  readonly threadKey: string;
  readonly action: "wake" | "settle";
}

export function threadListV2SettleOrder(
  items: ReadonlyArray<Pick<ThreadListV2Item, "threadKey" | "rootThreadKey" | "depth">>,
  targetThreadKey: string,
): readonly string[] {
  const target = items.find((item) => item.threadKey === targetThreadKey);
  if (target === undefined || target.rootThreadKey !== targetThreadKey) return [targetThreadKey];
  return items
    .filter((item) => item.rootThreadKey === targetThreadKey)
    .slice()
    .sort((left, right) => right.depth - left.depth)
    .map((item) => item.threadKey);
}

/** Visual-only task folding. Keep the root row and hide its descendants;
 * lifecycle operations continue to receive the complete layout. */
export function visibleThreadListV2Items(
  items: ReadonlyArray<ThreadListV2Item>,
  collapsedRootThreadKeys: ReadonlySet<string>,
): ThreadListV2Item[] {
  if (collapsedRootThreadKeys.size === 0) return [...items];
  return items.filter(
    (item) =>
      item.threadKey === item.rootThreadKey || !collapsedRootThreadKeys.has(item.rootThreadKey),
  );
}

export function threadListV2RootCascadeSteps(
  items: ReadonlyArray<
    Pick<ThreadListV2Item, "threadKey" | "rootThreadKey" | "depth" | "lifecycle">
  >,
  targetThreadKey: string,
): readonly ThreadListV2CascadeStep[] {
  const itemByKey = new Map(items.map((item) => [item.threadKey, item] as const));
  const target = itemByKey.get(targetThreadKey);
  if (target === undefined || target.rootThreadKey !== targetThreadKey) {
    return [{ threadKey: targetThreadKey, action: "settle" }];
  }
  return threadListV2SettleOrder(items, targetThreadKey).flatMap((threadKey) => {
    const row = itemByKey.get(threadKey);
    if (row?.lifecycle === "settled") return [];
    return row?.lifecycle === "snoozed"
      ? [
          { threadKey, action: "wake" as const },
          { threadKey, action: "settle" as const },
        ]
      : [{ threadKey, action: "settle" as const }];
  });
}

export interface ThreadListV2ThreadListItem {
  readonly type: "v2-thread";
  readonly key: string;
  readonly item: ThreadListV2Item;
  /** Precomputed so recycled-list equality can see a minute-tick change. */
  readonly snoozeWakeLabelText: string | undefined;
}

export interface ThreadListV2PendingListItem {
  readonly type: "v2-pending";
  readonly key: string;
  readonly pendingTask: PendingNewTask;
  /** First queued row after the active block draws the PENDING divider. */
  readonly showPendingDivider: boolean;
}

export interface ThreadListV2SnoozedShelfListItem {
  readonly type: "v2-snoozed-shelf";
  readonly key: "v2-snoozed-shelf";
  readonly count: number;
  readonly expanded: boolean;
}

export interface ThreadListV2SettledShelfListItem {
  readonly type: "v2-settled-shelf";
  readonly key: "v2-settled-shelf";
  readonly count: number;
  readonly expanded: boolean;
}

export type ThreadListV2ListItem =
  | ThreadListV2ThreadListItem
  | ThreadListV2PendingListItem
  | ThreadListV2SnoozedShelfListItem
  | ThreadListV2SettledShelfListItem;

/**
 * Builds the shared mobile order: active → pending → snoozed shelf → settled.
 * Pending tasks are waiting rather than asking, and parked work remains
 * reachable without competing with either the inbox or settled history.
 */
export function buildThreadListV2ListItems(input: {
  readonly items: ReadonlyArray<ThreadListV2Item>;
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
  readonly snoozedCount?: number;
  readonly snoozedShelfExpanded?: boolean;
  readonly snoozedShelfHeaderIndex?: number | null;
  readonly settledCount?: number;
  readonly settledShelfExpanded?: boolean;
  readonly settledShelfHeaderIndex?: number | null;
  readonly snoozeLabelNow?: string;
}): ThreadListV2ListItem[] {
  const threadItems = input.items.map(
    (item): ThreadListV2ListItem => ({
      type: "v2-thread",
      key: `v2-thread:${item.thread.environmentId}:${item.thread.id}`,
      item,
      snoozeWakeLabelText:
        item.snoozed && item.thread.snoozedUntil != null && input.snoozeLabelNow !== undefined
          ? snoozeWakeLabel(item.thread.snoozedUntil, { now: input.snoozeLabelNow })
          : undefined,
    }),
  );
  const pendingItems = input.pendingTasks.map(
    (pendingTask, index): ThreadListV2ListItem => ({
      type: "v2-pending",
      key: `v2-pending:${pendingTask.message.messageId}`,
      pendingTask,
      showPendingDivider: index === 0,
    }),
  );
  const snoozedCount = input.snoozedCount ?? 0;
  const snoozedShelfHeaderIndex = input.snoozedShelfHeaderIndex ?? null;
  const settledCount = input.settledCount ?? 0;
  const settledShelfHeaderIndex = input.settledShelfHeaderIndex ?? null;
  const activeEnd = snoozedShelfHeaderIndex ?? settledShelfHeaderIndex ?? threadItems.length;
  const snoozedEnd = settledShelfHeaderIndex ?? threadItems.length;
  const result: ThreadListV2ListItem[] = [...threadItems.slice(0, activeEnd), ...pendingItems];
  if (snoozedShelfHeaderIndex !== null && snoozedCount > 0) {
    result.push({
      type: "v2-snoozed-shelf",
      key: "v2-snoozed-shelf",
      count: snoozedCount,
      expanded: input.snoozedShelfExpanded === true,
    });
    result.push(...threadItems.slice(snoozedShelfHeaderIndex, snoozedEnd));
  }
  if (settledShelfHeaderIndex !== null && settledCount > 0) {
    result.push({
      type: "v2-settled-shelf",
      key: "v2-settled-shelf",
      count: settledCount,
      expanded: input.settledShelfExpanded !== false,
    });
    result.push(...threadItems.slice(settledShelfHeaderIndex));
  }
  return result;
}

/**
 * Partitions visible threads into the active card block (creation order) and
 * the settled recency tail, matching the web v2 list. `autoSettleAfterDays`
 * mirrors the web default of 3 — mobile has no client-settings sync yet, so
 * the default is fixed here rather than user-configurable.
 */
export function buildThreadListV2Items(input: {
  readonly threads: ReadonlyArray<EnvironmentThreadShell>;
  readonly environmentId: EnvironmentId | null;
  readonly projectRefs?: ReadonlyArray<{
    readonly environmentId: EnvironmentId;
    readonly projectId: ProjectId;
  }> | null;
  readonly searchQuery: string;
  readonly matchedThreadKeys?: ReadonlySet<string>;
  /** Per-row PR state reported up by visible rows ("env:threadId" keys). */
  readonly changeRequestStateByKey?: ReadonlyMap<string, "open" | "closed" | "merged">;
  /** Environments whose server supports thread.settle/unsettle. Threads on
      other environments never classify as settled — the user could neither
      un-settle nor pin them. Absent = no gating (tests). */
  readonly settlementEnvironmentIds?: ReadonlySet<EnvironmentId>;
  /** Environments whose server supports thread.snooze/unsnooze. Same
      contract as settlementEnvironmentIds. */
  readonly snoozeEnvironmentIds?: ReadonlySet<EnvironmentId>;
  /** Device-local visual override. Does not change orchestration ownership. */
  readonly unnestedThreadKeys?: ReadonlySet<string>;
  readonly autoSettleAfterDays?: number;
  /** Max settled rows to render; the rest are counted, not built. */
  readonly settledLimit?: number;
  /** Injectable for tests; defaults to now. */
  readonly now?: string;
  /** Second-precise clock for snooze classification. Callers pass a
      minute-quantized `now` for memoization; snooze wake times are
      second-precise, so classifying with the floored minute would hold a
      woken thread hidden for up to a minute. Defaults to `now`. */
  readonly snoozeNow?: string;
  /** Expands the snoozed shelf into rows. Collapsed is the default. */
  readonly snoozedShelfExpanded?: boolean;
  /** Expands the settled shelf into rows. Expanded is the default. */
  readonly settledShelfExpanded?: boolean;
  /** The selected thread remains visible on an otherwise collapsed shelf so
      a split-view detail can never lose its navigation row. */
  readonly selectedThreadKey?: string | null;
}): ThreadListV2Layout {
  const now = input.now ?? new Date().toISOString();
  const snoozeNow = input.snoozeNow ?? now;
  const autoSettleAfterDays = input.autoSettleAfterDays ?? 3;
  const query = input.searchQuery.trim().toLocaleLowerCase();
  const projectKeys = input.projectRefs
    ? new Set(input.projectRefs.map((ref) => `${ref.environmentId}:${ref.projectId}`))
    : null;

  const sections: Record<ThreadSection, EnvironmentThreadShell[]> = {
    active: [],
    snoozed: [],
    settled: [],
  };
  let snoozedCount = 0;
  let nextSnoozeWakeAt: string | null = null;
  for (const thread of input.threads) {
    // Callers pass live (unarchived) shells; settled threads are among them
    // and partition into the tail via effectiveSettled.
    if (input.environmentId !== null && thread.environmentId !== input.environmentId) continue;
    if (projectKeys !== null && !projectKeys.has(`${thread.environmentId}:${thread.projectId}`)) {
      continue;
    }
    if (
      query.length > 0 &&
      !thread.title.toLocaleLowerCase().includes(query) &&
      input.matchedThreadKeys?.has(
        threadSearchMatchKey({
          environmentId: thread.environmentId,
          threadId: thread.id,
        }),
      ) !== true
    ) {
      continue;
    }
    const supportsSettlement = input.settlementEnvironmentIds?.has(thread.environmentId) ?? true;
    const supportsSnooze = input.snoozeEnvironmentIds?.has(thread.environmentId) ?? true;
    // Visibility parity with web: a snoozed thread leaves the list until it
    // wakes (or raises its hand — effectiveSnoozed refuses blocked/failed
    // work). Snooze outranks settled classification, same as web.
    const changeRequestState =
      input.changeRequestStateByKey?.get(`${thread.environmentId}:${thread.id}`) ?? null;
    // Visibility parity with web: snooze outranks everything, including a
    // pin — a snoozed thread leaves the list until it wakes (or raises its
    // hand). The pin (and its pinOrderKey) survives underneath, so a woken
    // thread reappears at its exact spot in the pinned block.
    if (supportsSnooze && effectiveSnoozed(thread, { now: snoozeNow })) {
      sections.snoozed.push(thread);
      if (
        thread.snoozedUntil != null &&
        (nextSnoozeWakeAt === null ||
          parseTimestampMs(thread.snoozedUntil) < parseTimestampMs(nextSnoozeWakeAt))
      ) {
        nextSnoozeWakeAt = thread.snoozedUntil;
      }
      continue;
    }
    if (
      supportsSettlement &&
      !isThreadListV2Pinned(thread) &&
      effectiveSettled(thread, { now, autoSettleAfterDays, changeRequestState })
    ) {
      sections.settled.push(thread);
    } else {
      sections.active.push(thread);
    }
  }

  const orderedActive = [
    ...sortPinnedThreadsByOrderKey(sections.active.filter(isThreadListV2Pinned)),
    ...sortThreadsForListV2(sections.active.filter((thread) => !isThreadListV2Pinned(thread))),
  ];
  const orderedSnoozed = [...sections.snoozed].sort(
    (left, right) =>
      firstValidTimestampMs(left.snoozedUntil, left.createdAt) -
      firstValidTimestampMs(right.snoozedUntil, right.createdAt),
  );
  const orderedSettled = [...sections.settled].sort(
    (left, right) =>
      firstValidTimestampMs(right.latestUserMessageAt, right.updatedAt) -
      firstValidTimestampMs(left.latestUserMessageAt, left.updatedAt),
  );
  const orderedBySection = {
    active: orderedActive,
    snoozed: orderedSnoozed,
    settled: orderedSettled,
  } satisfies Record<ThreadSection, EnvironmentThreadShell[]>;
  const threadByKey = new Map<string, EnvironmentThreadShell>();
  const sectionByKey = new Map<string, ThreadSection>();
  for (const section of ["active", "snoozed", "settled"] as const) {
    for (const thread of orderedBySection[section]) {
      const key = `${thread.environmentId}:${thread.id}`;
      if (threadByKey.has(key)) continue;
      threadByKey.set(key, thread);
      sectionByKey.set(key, section);
    }
  }
  const parentByKey = new Map<string, string>();
  const childrenByKey = new Map<string, EnvironmentThreadShell[]>();
  for (const [key, thread] of threadByKey) {
    if (input.unnestedThreadKeys?.has(key) === true || thread.taskRelation === null) continue;
    const parentKey = `${thread.environmentId}:${thread.taskRelation.parentThreadId}`;
    if (parentKey === key || !threadByKey.has(parentKey)) continue;
    parentByKey.set(key, parentKey);
    const children = childrenByKey.get(parentKey) ?? [];
    children.push(thread);
    childrenByKey.set(parentKey, children);
  }
  for (const [key, children] of childrenByKey) {
    childrenByKey.set(key, sortThreadsForListV2(children));
  }

  const groups: Array<{ rootSection: ThreadSection; rows: ThreadListV2Item[] }> = [];
  const visited = new Set<string>();
  const appendGroup = (root: EnvironmentThreadShell) => {
    const rootThreadKey = `${root.environmentId}:${root.id}`;
    if (visited.has(rootThreadKey)) return;
    const rows: ThreadListV2Item[] = [];
    const append = (thread: EnvironmentThreadShell, depth: number) => {
      const threadKey = `${thread.environmentId}:${thread.id}`;
      if (visited.has(threadKey)) return;
      visited.add(threadKey);
      const section = sectionByKey.get(threadKey) ?? "active";
      rows.push({
        thread,
        threadKey,
        rootThreadKey,
        depth,
        hasTaskParent: thread.taskRelation !== null,
        visuallyUnnested: input.unnestedThreadKeys?.has(threadKey) === true,
        variant: depth > 0 || section === "settled" ? "slim" : "card",
        lifecycle: section,
        snoozed: section === "snoozed",
        pinned: isThreadListV2Pinned(thread),
        showSettledDivider: false,
        isLast: false,
      });
      for (const child of childrenByKey.get(threadKey) ?? []) append(child, depth + 1);
    };
    append(root, 0);
    groups.push({ rootSection: sectionByKey.get(rootThreadKey) ?? "active", rows });
  };
  for (const section of ["active", "snoozed", "settled"] as const) {
    for (const thread of orderedBySection[section]) {
      if (!parentByKey.has(`${thread.environmentId}:${thread.id}`)) appendGroup(thread);
    }
  }
  // Cycles/malformed relations: every shell still becomes a visible root.
  for (const section of ["active", "snoozed", "settled"] as const) {
    for (const thread of orderedBySection[section]) appendGroup(thread);
  }

  const settledLimit = input.settledLimit ?? Number.POSITIVE_INFINITY;
  const visibleGroups: typeof groups = [];
  let settledRowsShown = 0;
  let settledRowsTotal = 0;
  const selectedThreadKey = input.selectedThreadKey ?? null;
  for (const group of groups) {
    if (group.rootSection === "snoozed") {
      if (
        input.snoozedShelfExpanded === true ||
        group.rows.some((row) => row.threadKey === selectedThreadKey)
      ) {
        visibleGroups.push(group);
      }
      continue;
    }
    if (group.rootSection !== "settled") {
      visibleGroups.push(group);
      continue;
    }
    settledRowsTotal += group.rows.length;
    if (input.settledShelfExpanded !== false && settledRowsShown < settledLimit) {
      visibleGroups.push(group);
      settledRowsShown += group.rows.length;
    } else if (group.rows.some((row) => row.threadKey === selectedThreadKey)) {
      visibleGroups.push(group);
    }
  }
  snoozedCount = groups
    .filter((group) => group.rootSection === "snoozed")
    .reduce((count, group) => count + group.rows.length, 0);
  const items = visibleGroups.flatMap((group) => group.rows);
  const activeRowCount = visibleGroups
    .filter((group) => group.rootSection === "active")
    .reduce((count, group) => count + group.rows.length, 0);
  const visibleSnoozedRowCount = visibleGroups
    .filter((group) => group.rootSection === "snoozed")
    .reduce((count, group) => count + group.rows.length, 0);
  const snoozedShelfHeaderIndex = snoozedCount > 0 ? activeRowCount : null;
  const settledShelfHeaderIndex =
    settledRowsTotal > 0 ? activeRowCount + visibleSnoozedRowCount : null;
  const firstSettledIndex = visibleGroups
    .flatMap((group, index) => (group.rootSection === "settled" ? [index] : []))
    .at(0);
  if (firstSettledIndex !== undefined) {
    const itemIndex = visibleGroups
      .slice(0, firstSettledIndex)
      .reduce((count, group) => count + group.rows.length, 0);
    const firstSettled = items[itemIndex];
    if (firstSettled) items[itemIndex] = { ...firstSettled, showSettledDivider: true };
  }
  const last = items.at(-1);
  if (last) {
    items[items.length - 1] = { ...last, isLast: true };
  }
  return {
    items,
    hiddenSettledCount: settledRowsTotal - settledRowsShown,
    snoozedCount,
    snoozedShelfHeaderIndex,
    settledCount: settledRowsTotal,
    settledShelfHeaderIndex,
    nextSnoozeWakeAt,
  };
}
