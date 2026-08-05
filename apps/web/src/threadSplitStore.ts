import { parseScopedThreadKey } from "@t3tools/client-runtime/environment";
import { createStore, type StoreApi } from "zustand/vanilla";

export const THREAD_SPLIT_STORAGE_KEY = "t3code:thread-splits:v1";
export const THREAD_SPLIT_SCHEMA_VERSION = 1;
export const THREAD_SPLIT_MAX_PANES = 50;

export type ThreadSplitTargetKey = `server:${string}` | `draft:${string}`;
export type ThreadSplitLayoutMode = "auto" | "columns" | "rows" | "grid";

export interface ThreadSplitTaskTreeBinding {
  rootThreadKey: string;
  observedDescendantKeys: string[];
  excludedDescendantKeys: string[];
}

export interface ThreadSplitGroup {
  id: string;
  targetKeys: ThreadSplitTargetKey[];
  focusedTargetKey: ThreadSplitTargetKey;
  layoutMode: ThreadSplitLayoutMode;
  gridColumns?: number;
  gridRows?: number;
  weights: number[];
  taskTreeBinding?: ThreadSplitTaskTreeBinding;
}

export interface PersistedThreadSplitState {
  version: typeof THREAD_SPLIT_SCHEMA_VERSION;
  groupOrder: string[];
  groups: Record<string, ThreadSplitGroup>;
  activeGroupId: string | null;
}

export interface ThreadSplitCatalogThread {
  targetKey: ThreadSplitTargetKey;
  rootThreadKey?: string | null;
  updatedAt?: string | number | null;
  treeOrder: number;
}

export interface ThreadSplitReconcileCatalog {
  environmentCatalogHydrated: boolean;
  environments: Record<string, { threadCatalogHydrated: boolean }>;
  threads: readonly ThreadSplitCatalogThread[];
  draftsHydrated: boolean;
  draftTargetKeys: readonly ThreadSplitTargetKey[];
}

export interface OpenTargetsOptions {
  groupId?: string;
  mode?: "new-group" | "add" | "replace-focused";
  afterTargetKey?: ThreadSplitTargetKey;
  focusTargetKey?: ThreadSplitTargetKey;
}

export interface ConfigureGroupOptions {
  layoutMode?: ThreadSplitLayoutMode;
  gridColumns?: number;
  gridRows?: number;
  targetKeys?: readonly ThreadSplitTargetKey[];
  weights?: readonly number[];
}

export interface OpenTaskTreeResult {
  groupId: string | null;
  omittedCount: number;
}

export interface ThreadSplitState extends PersistedThreadSplitState {
  openTargets: (
    targetKeys: readonly ThreadSplitTargetKey[],
    options?: OpenTargetsOptions,
  ) => string | null;
  openTaskTree: (
    rootTargetKey: ThreadSplitTargetKey,
    descendants: readonly ThreadSplitCatalogThread[],
  ) => OpenTaskTreeResult;
  focusTarget: (targetKey: ThreadSplitTargetKey) => void;
  removeTarget: (targetKey: ThreadSplitTargetKey) => void;
  configureGroup: (groupId: string, configuration: ConfigureGroupOptions) => void;
  closeGroup: (groupId: string) => void;
  promoteDraftTarget: (
    draftTargetKey: ThreadSplitTargetKey,
    serverTargetKey: ThreadSplitTargetKey,
  ) => void;
  reconcile: (catalog: ThreadSplitReconcileCatalog) => void;
}

export interface ThreadSplitStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface CreateThreadSplitStoreOptions {
  storage?: ThreadSplitStorage | null;
  createGroupId?: () => string;
  onPersistenceError?: (error: unknown) => void;
}

const EMPTY_STATE: PersistedThreadSplitState = {
  version: THREAD_SPLIT_SCHEMA_VERSION,
  groupOrder: [],
  groups: {},
  activeGroupId: null,
};
const THREAD_SPLIT_GRID_DEFAULT_COLUMNS = 3;
const THREAD_SPLIT_GRID_DEFAULT_ROWS = 3;
const THREAD_SPLIT_GRID_MAX_COLUMNS = 12;
const THREAD_SPLIT_GRID_MAX_ROWS = 12;
let fallbackGroupIdSequence = 0;

function uniqueTargets(values: readonly unknown[]): ThreadSplitTargetKey[] {
  const result: ThreadSplitTargetKey[] = [];
  const seen = new Set<string>();
  for (const value of values) {
    if (
      typeof value !== "string" ||
      (!value.startsWith("server:") && !value.startsWith("draft:")) ||
      value.length <= 6 ||
      seen.has(value)
    ) {
      continue;
    }
    seen.add(value);
    result.push(value as ThreadSplitTargetKey);
  }
  return result;
}

function normalizeWeights(values: readonly unknown[], count: number): number[] {
  if (count === 0) return [];
  const valid =
    values.length === count &&
    values.every((value) => typeof value === "number" && Number.isFinite(value) && value > 0);
  const source = valid ? (values as readonly number[]) : Array.from({ length: count }, () => 1);
  const total = source.reduce((sum, value) => sum + value, 0);
  return source.map((value) => value / total);
}

function normalizeGridDimension(value: unknown, fallback: number, maximum: number): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(1, Math.round(value)))
    : fallback;
}

function normalizeBinding(value: unknown): ThreadSplitTaskTreeBinding | undefined {
  if (!value || typeof value !== "object") return undefined;
  const candidate = value as Partial<ThreadSplitTaskTreeBinding>;
  if (
    typeof candidate.rootThreadKey !== "string" ||
    !parseScopedThreadKey(candidate.rootThreadKey)
  ) {
    return undefined;
  }
  const strings = (input: unknown) =>
    Array.isArray(input)
      ? [...new Set(input.filter((entry): entry is string => typeof entry === "string"))]
      : [];
  return {
    rootThreadKey: candidate.rootThreadKey,
    observedDescendantKeys: strings(candidate.observedDescendantKeys),
    excludedDescendantKeys: strings(candidate.excludedDescendantKeys),
  };
}

function normalizeGroup(
  id: string,
  value: unknown,
  claimedTargets: Set<ThreadSplitTargetKey>,
): ThreadSplitGroup | null {
  if (!value || typeof value !== "object" || !id) return null;
  const candidate = value as Partial<ThreadSplitGroup>;
  const targetKeys = uniqueTargets(Array.isArray(candidate.targetKeys) ? candidate.targetKeys : [])
    .filter((key) => !claimedTargets.has(key))
    .slice(0, THREAD_SPLIT_MAX_PANES);
  if (targetKeys.length < 2) return null;
  targetKeys.forEach((key) => claimedTargets.add(key));
  const focusedTargetKey = targetKeys.includes(candidate.focusedTargetKey as ThreadSplitTargetKey)
    ? (candidate.focusedTargetKey as ThreadSplitTargetKey)
    : targetKeys[0]!;
  const layoutMode: ThreadSplitLayoutMode =
    candidate.layoutMode === "columns" ||
    candidate.layoutMode === "rows" ||
    candidate.layoutMode === "grid"
      ? candidate.layoutMode
      : "auto";
  const taskTreeBinding = normalizeBinding(candidate.taskTreeBinding);
  return {
    id,
    targetKeys,
    focusedTargetKey,
    layoutMode,
    gridColumns: normalizeGridDimension(
      candidate.gridColumns,
      THREAD_SPLIT_GRID_DEFAULT_COLUMNS,
      THREAD_SPLIT_GRID_MAX_COLUMNS,
    ),
    gridRows: normalizeGridDimension(
      candidate.gridRows,
      THREAD_SPLIT_GRID_DEFAULT_ROWS,
      THREAD_SPLIT_GRID_MAX_ROWS,
    ),
    weights: normalizeWeights(
      Array.isArray(candidate.weights) ? candidate.weights : [],
      targetKeys.length,
    ),
    ...(taskTreeBinding ? { taskTreeBinding } : {}),
  };
}

export function repairPersistedThreadSplitState(value: unknown): PersistedThreadSplitState {
  if (!value || typeof value !== "object") return { ...EMPTY_STATE };
  const candidate = value as Partial<PersistedThreadSplitState>;
  if (!candidate.groups || typeof candidate.groups !== "object") return { ...EMPTY_STATE };
  const rawOrder = Array.isArray(candidate.groupOrder)
    ? candidate.groupOrder.filter((id): id is string => typeof id === "string")
    : [];
  const order = [...new Set([...rawOrder, ...Object.keys(candidate.groups)])];
  const groups: Record<string, ThreadSplitGroup> = {};
  const claimedTargets = new Set<ThreadSplitTargetKey>();
  for (const id of order) {
    const group = normalizeGroup(id, candidate.groups[id], claimedTargets);
    if (group) groups[id] = group;
  }
  const groupOrder = order.filter((id) => groups[id]);
  return {
    version: THREAD_SPLIT_SCHEMA_VERSION,
    groupOrder,
    groups,
    activeGroupId:
      typeof candidate.activeGroupId === "string" && groups[candidate.activeGroupId]
        ? candidate.activeGroupId
        : (groupOrder[0] ?? null),
  };
}

function readState(storage: ThreadSplitStorage | null): PersistedThreadSplitState {
  if (!storage) return { ...EMPTY_STATE };
  try {
    const raw = storage.getItem(THREAD_SPLIT_STORAGE_KEY);
    return raw ? repairPersistedThreadSplitState(JSON.parse(raw)) : { ...EMPTY_STATE };
  } catch {
    return { ...EMPTY_STATE };
  }
}

function owningGroupId(
  groups: Record<string, ThreadSplitGroup>,
  targetKey: ThreadSplitTargetKey,
): string | undefined {
  return Object.values(groups).find((group) => group.targetKeys.includes(targetKey))?.id;
}

function copyGroup(group: ThreadSplitGroup): ThreadSplitGroup {
  return {
    ...group,
    targetKeys: [...group.targetKeys],
    weights: [...group.weights],
    ...(group.taskTreeBinding
      ? {
          taskTreeBinding: {
            ...group.taskTreeBinding,
            observedDescendantKeys: [...group.taskTreeBinding.observedDescendantKeys],
            excludedDescendantKeys: [...group.taskTreeBinding.excludedDescendantKeys],
          },
        }
      : {}),
  };
}

function removeFromGroup(
  group: ThreadSplitGroup,
  targetKey: ThreadSplitTargetKey,
): ThreadSplitGroup {
  const index = group.targetKeys.indexOf(targetKey);
  if (index < 0) return group;
  const targetKeys = group.targetKeys.filter((key) => key !== targetKey);
  const weights = group.weights.filter((_, weightIndex) => weightIndex !== index);
  return {
    ...group,
    targetKeys,
    focusedTargetKey:
      group.focusedTargetKey === targetKey
        ? (targetKeys[Math.min(index, targetKeys.length - 1)] ?? targetKeys[0]!)
        : group.focusedTargetKey,
    weights: normalizeWeights(weights, targetKeys.length),
  };
}

function addToGroup(
  group: ThreadSplitGroup,
  targets: readonly ThreadSplitTargetKey[],
  afterTargetKey?: ThreadSplitTargetKey,
): ThreadSplitGroup {
  const additions = uniqueTargets(targets).filter((key) => !group.targetKeys.includes(key));
  const available = additions.slice(0, THREAD_SPLIT_MAX_PANES - group.targetKeys.length);
  if (available.length === 0) return group;
  const insertAt = afterTargetKey
    ? Math.max(0, group.targetKeys.indexOf(afterTargetKey) + 1)
    : group.targetKeys.length;
  const targetKeys = [...group.targetKeys];
  targetKeys.splice(insertAt, 0, ...available);
  const average = group.weights.reduce((sum, weight) => sum + weight, 0) / group.weights.length;
  const weights = [...group.weights];
  weights.splice(insertAt, 0, ...available.map(() => average));
  let taskTreeBinding = group.taskTreeBinding;
  if (taskTreeBinding) {
    const addedThreadKeys = new Set(
      available
        .filter((key) => key.startsWith("server:"))
        .map((key) => key.slice("server:".length)),
    );
    taskTreeBinding = {
      ...taskTreeBinding,
      excludedDescendantKeys: taskTreeBinding.excludedDescendantKeys.filter(
        (key) => !addedThreadKeys.has(key),
      ),
    };
  }
  return {
    ...group,
    targetKeys,
    weights: normalizeWeights(weights, targetKeys.length),
    ...(taskTreeBinding ? { taskTreeBinding } : {}),
  };
}

function toPersisted(state: ThreadSplitState): PersistedThreadSplitState {
  return {
    version: THREAD_SPLIT_SCHEMA_VERSION,
    groupOrder: state.groupOrder,
    groups: state.groups,
    activeGroupId: state.activeGroupId,
  };
}

export function createThreadSplitStore(
  options: CreateThreadSplitStoreOptions = {},
): StoreApi<ThreadSplitState> {
  const storage =
    options.storage === undefined
      ? typeof window === "undefined"
        ? null
        : window.localStorage
      : options.storage;
  const createGroupId =
    options.createGroupId ?? (() => `split-${Date.now()}-${++fallbackGroupIdSequence}`);
  let persistenceFailureReported = false;

  const store = createStore<ThreadSplitState>((set, get) => ({
    ...readState(storage),

    openTargets(targetValues, actionOptions = {}) {
      const targets = uniqueTargets(targetValues);
      if (targets.length === 0) return null;
      let resultId: string | null = null;
      set((state) => {
        const groups = Object.fromEntries(
          Object.entries(state.groups).map(([id, group]) => [id, copyGroup(group)]),
        );
        const mode = actionOptions.mode ?? (actionOptions.groupId ? "add" : "new-group");
        let destinationId = actionOptions.groupId;
        if (mode === "replace-focused" && destinationId && groups[destinationId]) {
          const destination = groups[destinationId]!;
          const replacement = targets[0]!;
          if (destination.targetKeys.includes(replacement)) {
            destination.focusedTargetKey = replacement;
          } else {
            const replaced = destination.focusedTargetKey;
            for (const [id, group] of Object.entries(groups)) {
              if (id !== destinationId && group.targetKeys.includes(replacement)) {
                groups[id] = removeFromGroup(group, replacement);
              }
            }
            const index = destination.targetKeys.indexOf(replaced);
            destination.targetKeys[index] = replacement;
            destination.focusedTargetKey = replacement;
          }
        } else {
          if (mode === "new-group") destinationId = createGroupId();
          if (!destinationId || !groups[destinationId]) {
            if (targets.length < 2) return state;
            destinationId ??= createGroupId();
            groups[destinationId] = {
              id: destinationId,
              targetKeys: [],
              focusedTargetKey: targets[0]!,
              layoutMode: "auto",
              gridColumns: THREAD_SPLIT_GRID_DEFAULT_COLUMNS,
              gridRows: THREAD_SPLIT_GRID_DEFAULT_ROWS,
              weights: [],
            };
          }
          const destination = groups[destinationId]!;
          const acceptedTargets = targets
            .filter((target) => destination.targetKeys.includes(target))
            .concat(
              targets
                .filter((target) => !destination.targetKeys.includes(target))
                .slice(0, THREAD_SPLIT_MAX_PANES - destination.targetKeys.length),
            );
          for (const target of acceptedTargets) {
            const owner = owningGroupId(groups, target);
            if (owner && owner !== destinationId)
              groups[owner] = removeFromGroup(groups[owner]!, target);
          }
          groups[destinationId] = addToGroup(
            groups[destinationId]!,
            acceptedTargets,
            actionOptions.afterTargetKey,
          );
          const requestedFocus = actionOptions.focusTargetKey ?? targets.at(-1);
          if (requestedFocus && groups[destinationId]!.targetKeys.includes(requestedFocus)) {
            groups[destinationId]!.focusedTargetKey = requestedFocus;
          }
        }
        for (const [id, group] of Object.entries(groups)) {
          if (group.targetKeys.length < 2) delete groups[id];
        }
        if (!groups[destinationId]) return state;
        resultId = destinationId;
        const existingOrder = state.groupOrder.filter((id) => groups[id]);
        const groupOrder =
          mode === "new-group"
            ? [destinationId, ...existingOrder.filter((id) => id !== destinationId)]
            : existingOrder.includes(destinationId)
              ? existingOrder
              : [...existingOrder, destinationId];
        return { ...state, groups, groupOrder, activeGroupId: destinationId };
      });
      return resultId;
    },

    openTaskTree(rootTargetKey, descendantValues) {
      if (!rootTargetKey.startsWith("server:")) return { groupId: null, omittedCount: 0 };
      const rootThreadKey = rootTargetKey.slice("server:".length);
      const descendants = descendantValues.filter(
        (value) =>
          value.targetKey.startsWith("server:") &&
          value.rootThreadKey === rootThreadKey &&
          value.targetKey !== rootTargetKey,
      );
      const rootOwner = owningGroupId(get().groups, rootTargetKey);
      const owner = rootOwner ? get().groups[rootOwner] : undefined;
      const selectableDescendants = owner
        ? descendants.filter((entry) => !owner.targetKeys.includes(entry.targetKey))
        : descendants;
      const descendantLimit = Math.max(0, THREAD_SPLIT_MAX_PANES - (owner?.targetKeys.length ?? 1));
      const selected =
        selectableDescendants.length <= descendantLimit
          ? [...selectableDescendants].sort((a, b) => a.treeOrder - b.treeOrder)
          : [...selectableDescendants]
              .sort((a, b) => {
                const time = (value: string | number | null | undefined) =>
                  typeof value === "number" ? value : Date.parse(value ?? "") || 0;
                return time(b.updatedAt) - time(a.updatedAt);
              })
              .slice(0, descendantLimit)
              .sort((a, b) => a.treeOrder - b.treeOrder);
      const existing = Object.values(get().groups).find(
        (group) => group.taskTreeBinding?.rootThreadKey === rootThreadKey,
      );
      if (existing) {
        get().focusTarget(rootTargetKey);
        return {
          groupId: existing.id,
          omittedCount: Math.max(0, selectableDescendants.length - descendantLimit),
        };
      }
      const groupId =
        rootOwner ??
        get().openTargets([rootTargetKey, ...selected.map((entry) => entry.targetKey)], {
          mode: "new-group",
          focusTargetKey: rootTargetKey,
        });
      if (!groupId)
        return {
          groupId: null,
          omittedCount: Math.max(0, selectableDescendants.length - descendantLimit),
        };
      if (rootOwner) {
        get().openTargets(
          selected.map((entry) => entry.targetKey),
          {
            groupId,
            mode: "add",
            focusTargetKey: rootTargetKey,
          },
        );
        const group = get().groups[rootOwner];
        if (group) {
          get().configureGroup(rootOwner, {
            targetKeys: [
              rootTargetKey,
              ...group.targetKeys.filter((target) => target !== rootTargetKey),
            ],
          });
        }
      }
      set((state) => ({
        ...state,
        groups: {
          ...state.groups,
          [groupId]: {
            ...state.groups[groupId]!,
            taskTreeBinding: {
              rootThreadKey,
              observedDescendantKeys: descendants.map((entry) =>
                entry.targetKey.slice("server:".length),
              ),
              excludedDescendantKeys: [],
            },
          },
        },
      }));
      return {
        groupId,
        omittedCount: Math.max(0, selectableDescendants.length - descendantLimit),
      };
    },

    focusTarget(targetKey) {
      set((state) => {
        const id = owningGroupId(state.groups, targetKey);
        if (!id) return state;
        const group = state.groups[id]!;
        if (state.activeGroupId === id && group.focusedTargetKey === targetKey) return state;
        return {
          ...state,
          activeGroupId: id,
          groups: { ...state.groups, [id]: { ...group, focusedTargetKey: targetKey } },
        };
      });
    },

    removeTarget(targetKey) {
      set((state) => {
        const id = owningGroupId(state.groups, targetKey);
        if (!id) return state;
        const group = state.groups[id]!;
        let next = removeFromGroup(group, targetKey);
        if (next.taskTreeBinding && targetKey.startsWith("server:")) {
          const threadKey = targetKey.slice("server:".length);
          if (
            threadKey !== next.taskTreeBinding.rootThreadKey &&
            next.taskTreeBinding.observedDescendantKeys.includes(threadKey)
          ) {
            next = {
              ...next,
              taskTreeBinding: {
                ...next.taskTreeBinding,
                excludedDescendantKeys: [
                  ...new Set([...next.taskTreeBinding.excludedDescendantKeys, threadKey]),
                ],
              },
            };
          }
        }
        const groups = { ...state.groups };
        if (next.targetKeys.length < 2) delete groups[id];
        else groups[id] = next;
        return {
          ...state,
          groups,
          groupOrder: state.groupOrder.filter((groupId) => groups[groupId]),
          activeGroupId:
            state.activeGroupId === id && !groups[id]
              ? (state.groupOrder.find((x) => groups[x]) ?? null)
              : state.activeGroupId,
        };
      });
    },

    configureGroup(groupId, configuration) {
      set((state) => {
        const group = state.groups[groupId];
        if (!group) return state;
        let targetKeys = group.targetKeys;
        let weights = group.weights;
        if (configuration.targetKeys) {
          const requested = uniqueTargets(configuration.targetKeys);
          if (
            requested.length === group.targetKeys.length &&
            requested.every((target) => group.targetKeys.includes(target))
          ) {
            const weightsByTarget = new Map(
              group.targetKeys.map((target, index) => [target, group.weights[index]!] as const),
            );
            targetKeys = requested;
            weights = requested.map((target) => weightsByTarget.get(target)!);
          }
        }
        if (configuration.weights)
          weights = normalizeWeights(configuration.weights, targetKeys.length);
        return {
          ...state,
          groups: {
            ...state.groups,
            [groupId]: {
              ...group,
              targetKeys,
              weights: normalizeWeights(weights, targetKeys.length),
              layoutMode: configuration.layoutMode ?? group.layoutMode,
              gridColumns: normalizeGridDimension(
                configuration.gridColumns ?? group.gridColumns,
                THREAD_SPLIT_GRID_DEFAULT_COLUMNS,
                THREAD_SPLIT_GRID_MAX_COLUMNS,
              ),
              gridRows: normalizeGridDimension(
                configuration.gridRows ?? group.gridRows,
                THREAD_SPLIT_GRID_DEFAULT_ROWS,
                THREAD_SPLIT_GRID_MAX_ROWS,
              ),
            },
          },
        };
      });
    },

    closeGroup(groupId) {
      set((state) => {
        if (!state.groups[groupId]) return state;
        const groups = { ...state.groups };
        delete groups[groupId];
        const groupOrder = state.groupOrder.filter((id) => id !== groupId);
        return {
          ...state,
          groups,
          groupOrder,
          activeGroupId:
            state.activeGroupId === groupId ? (groupOrder[0] ?? null) : state.activeGroupId,
        };
      });
    },

    promoteDraftTarget(draftTargetKey, serverTargetKey) {
      if (!draftTargetKey.startsWith("draft:") || !serverTargetKey.startsWith("server:")) return;
      set((state) => {
        const sourceId = owningGroupId(state.groups, draftTargetKey);
        if (!sourceId) return state;
        const groups = Object.fromEntries(
          Object.entries(state.groups).map(([id, group]) => [id, copyGroup(group)]),
        );
        const otherId = owningGroupId(groups, serverTargetKey);
        if (otherId && otherId !== sourceId)
          groups[otherId] = removeFromGroup(groups[otherId]!, serverTargetKey);
        let source = groups[sourceId]!;
        const draftWasFocused = source.focusedTargetKey === draftTargetKey;
        const serverWasFocused = source.focusedTargetKey === serverTargetKey;
        if (otherId === sourceId) {
          source = removeFromGroup(source, serverTargetKey);
        }
        const index = source.targetKeys.indexOf(draftTargetKey);
        source.targetKeys[index] = serverTargetKey;
        if (draftWasFocused || serverWasFocused) source.focusedTargetKey = serverTargetKey;
        groups[sourceId] = source;
        for (const [id, group] of Object.entries(groups)) {
          if (group.targetKeys.length < 2) delete groups[id];
        }
        const groupOrder = state.groupOrder.filter((id) => groups[id]);
        return {
          ...state,
          groups,
          groupOrder,
          activeGroupId: groups[state.activeGroupId ?? ""]
            ? state.activeGroupId
            : groups[sourceId]
              ? sourceId
              : (groupOrder[0] ?? null),
        };
      });
    },

    reconcile(catalog) {
      set((state) => {
        const groups = Object.fromEntries(
          Object.entries(state.groups).map(([id, group]) => [id, copyGroup(group)]),
        );
        const threads = new Map(catalog.threads.map((thread) => [thread.targetKey, thread]));
        const drafts = new Set(catalog.draftTargetKeys);
        const targetIsValid = (target: ThreadSplitTargetKey) => {
          if (target.startsWith("draft:")) return !catalog.draftsHydrated || drafts.has(target);
          const parsed = parseScopedThreadKey(target.slice("server:".length));
          if (!parsed) return false;
          const environment = catalog.environments[parsed.environmentId];
          if (!environment) return !catalog.environmentCatalogHydrated;
          return !environment.threadCatalogHydrated || threads.has(target);
        };
        for (const [id, original] of Object.entries(groups)) {
          let group = original;
          for (const target of group.targetKeys) {
            if (!targetIsValid(target)) group = removeFromGroup(group, target);
          }
          const binding = group.taskTreeBinding;
          if (binding) {
            const rootTarget = `server:${binding.rootThreadKey}` as ThreadSplitTargetKey;
            if (!targetIsValid(rootTarget)) {
              const { taskTreeBinding: _removedBinding, ...manualGroup } = group;
              group = manualGroup;
            } else {
              const current = catalog.threads
                .filter((thread) => thread.rootThreadKey === binding.rootThreadKey)
                .sort((a, b) => a.treeOrder - b.treeOrder);
              const observed = new Set(binding.observedDescendantKeys);
              const newlyDiscovered = current.filter(
                (thread) => !observed.has(thread.targetKey.slice("server:".length)),
              );
              for (const thread of newlyDiscovered) {
                observed.add(thread.targetKey.slice("server:".length));
                if (
                  group.targetKeys.length < THREAD_SPLIT_MAX_PANES &&
                  !binding.excludedDescendantKeys.includes(
                    thread.targetKey.slice("server:".length),
                  ) &&
                  !owningGroupId(groups, thread.targetKey)
                ) {
                  group = addToGroup(group, [thread.targetKey]);
                }
              }
              group = {
                ...group,
                taskTreeBinding: {
                  ...binding,
                  observedDescendantKeys: [...observed],
                },
              };
            }
          }
          if (group.targetKeys.length < 2) delete groups[id];
          else groups[id] = group;
        }
        const groupOrder = state.groupOrder.filter((id) => groups[id]);
        return {
          ...state,
          groups,
          groupOrder,
          activeGroupId: groups[state.activeGroupId ?? ""]
            ? state.activeGroupId
            : (groupOrder[0] ?? null),
        };
      });
    },
  }));

  store.subscribe((state) => {
    if (!storage) return;
    try {
      storage.setItem(THREAD_SPLIT_STORAGE_KEY, JSON.stringify(toPersisted(state)));
    } catch (error) {
      if (!persistenceFailureReported) {
        persistenceFailureReported = true;
        if (options.onPersistenceError) options.onPersistenceError(error);
        else console.warn("Failed to persist thread split state", error);
      }
    }
  });
  return store;
}

export const threadSplitStore = createThreadSplitStore();

export function getThreadSplitGroupForTarget(
  state: PersistedThreadSplitState,
  targetKey: ThreadSplitTargetKey,
): ThreadSplitGroup | undefined {
  const id = owningGroupId(state.groups, targetKey);
  return id ? state.groups[id] : undefined;
}

export function getAvailableTaskDescendants(
  state: PersistedThreadSplitState,
  groupId: string,
  catalogThreads: readonly ThreadSplitCatalogThread[],
): ThreadSplitCatalogThread[] {
  const group = state.groups[groupId];
  const binding = group?.taskTreeBinding;
  if (!group || !binding) return [];
  return catalogThreads
    .filter(
      (thread) =>
        thread.rootThreadKey === binding.rootThreadKey &&
        !group.targetKeys.includes(thread.targetKey),
    )
    .sort((a, b) => a.treeOrder - b.treeOrder);
}
