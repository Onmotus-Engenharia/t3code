import { effectiveSettled, effectiveSnoozed } from "@t3tools/client-runtime/state/thread-settled";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProjectId } from "@t3tools/contracts";

import type { PendingNewTask } from "../../state/use-pending-new-tasks";

/**
 * Thread List v2 model, ported from the web sidebar v2
 * (apps/web/src/components/Sidebar.logic.ts + SidebarV2.tsx).
 *
 * Four visual states, three colors: color is reserved for "act now"
 * (approval), "in motion" (working), and "broken" (failed). Ready is the
 * unlabeled resting state.
 */
export type ThreadListV2Status = "approval" | "input" | "working" | "failed" | "ready";

// Settled-tail paging: recent history is the common lookup; the deep tail
// stays behind an explicit Show more. Shared by the compact Home list and
// the iPad sidebar so both page identically.
export const THREAD_LIST_V2_SETTLED_INITIAL_COUNT = 10;
export const THREAD_LIST_V2_SETTLED_PAGE_COUNT = 25;

/**
 * Thread List v2 is on by default on every app variant; the Settings → Beta
 * toggle is an opt-out. Preferences persist as sparse patches, so `undefined`
 * genuinely means "never chosen".
 *
 * `preferencesLoaded` guards the startup window: preferences load
 * asynchronously, and rendering one list before the stored choice arrives would
 * remount the whole thing a tick later. While loading, hold the default — that
 * is where every device without an explicit opt-out lands anyway.
 */
export function resolveThreadListV2Enabled(input: {
  readonly preference: boolean | undefined;
  readonly preferencesLoaded: boolean;
}): boolean {
  if (!input.preferencesLoaded) {
    return true;
  }
  return input.preference ?? true;
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
  readonly isLast: boolean;
}

export interface ThreadListV2Layout {
  readonly items: ThreadListV2Item[];
  /** Settled threads beyond the render limit (behind "Show more"). */
  readonly hiddenSettledCount: number;
  /** Snoozed threads hidden from the list (visibility parity with web's
      collapsed Snoozed shelf; mobile has no shelf UI yet). */
  readonly snoozedCount: number;
  /** Soonest wake time among hidden snoozed threads, or null. Callers arm
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
}

export interface ThreadListV2PendingListItem {
  readonly type: "v2-pending";
  readonly key: string;
  readonly pendingTask: PendingNewTask;
  /** First queued row after the active block draws the PENDING divider. */
  readonly showPendingDivider: boolean;
}

export type ThreadListV2ListItem = ThreadListV2ThreadListItem | ThreadListV2PendingListItem;

/**
 * Splices queued tasks between the active block and the settled tail, so the
 * list reads active → pending → settled. Queued work sits below the live
 * threads because nothing can happen to it until its environment returns:
 * it is waiting, not asking. Shared by the compact Home list and the iPad
 * sidebar so both order and label the sections identically.
 */
export function buildThreadListV2ListItems(input: {
  readonly items: ReadonlyArray<ThreadListV2Item>;
  readonly pendingTasks: ReadonlyArray<PendingNewTask>;
}): ThreadListV2ListItem[] {
  const threadItems = input.items.map(
    (item): ThreadListV2ListItem => ({
      type: "v2-thread",
      key: `v2-thread:${item.thread.environmentId}:${item.thread.id}`,
      item,
    }),
  );
  if (input.pendingTasks.length === 0) return threadItems;

  const pendingItems = input.pendingTasks.map(
    (pendingTask, index): ThreadListV2ListItem => ({
      type: "v2-pending",
      key: `v2-pending:${pendingTask.message.messageId}`,
      pendingTask,
      showPendingDivider: index === 0,
    }),
  );
  // The settled tail begins at the row that draws the SETTLED divider; with
  // no settled rows the queued block simply ends the list.
  const settledStart = threadItems.findIndex(
    (entry) => entry.type === "v2-thread" && entry.item.showSettledDivider,
  );
  return settledStart === -1
    ? [...threadItems, ...pendingItems]
    : [...threadItems.slice(0, settledStart), ...pendingItems, ...threadItems.slice(settledStart)];
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
    if (query.length > 0 && !thread.title.toLocaleLowerCase().includes(query)) continue;
    const supportsSettlement = input.settlementEnvironmentIds?.has(thread.environmentId) ?? true;
    const supportsSnooze = input.snoozeEnvironmentIds?.has(thread.environmentId) ?? true;
    // Visibility parity with web: a snoozed thread leaves the list until it
    // wakes (or raises its hand — effectiveSnoozed refuses blocked/failed
    // work). Snooze outranks settled classification, same as web.
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
    if (supportsSettlement && effectiveSettled(thread, { now, autoSettleAfterDays })) {
      sections.settled.push(thread);
    } else {
      sections.active.push(thread);
    }
  }

  const orderedActive = sortThreadsForListV2(sections.active);
  const orderedSnoozed = sortThreadsForListV2(sections.snoozed);
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
  for (const group of groups) {
    if (group.rootSection === "snoozed") continue;
    if (group.rootSection !== "settled") {
      visibleGroups.push(group);
      continue;
    }
    settledRowsTotal += group.rows.length;
    if (settledRowsShown >= settledLimit) continue;
    visibleGroups.push(group);
    settledRowsShown += group.rows.length;
  }
  snoozedCount = groups
    .filter((group) => group.rootSection === "snoozed")
    .reduce((count, group) => count + group.rows.length, 0);
  const items = visibleGroups.flatMap((group) => group.rows);
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
    nextSnoozeWakeAt,
  };
}
