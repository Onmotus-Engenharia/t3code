import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import { EnvironmentId, ProjectId, ThreadId } from "@t3tools/contracts";
import { afterEach, describe, expect, it, vi } from "vite-plus/test";

import { buildThreadSplitReconcileCatalog, reconcileThreadSplits } from "./ThreadSplitReconciler";
import {
  THREAD_SPLIT_SCHEMA_VERSION,
  threadSplitStore,
  type ThreadSplitReconcileCatalog,
  type ThreadSplitTargetKey,
} from "../../threadSplitStore";

const environmentId = EnvironmentId.make("remote");
const target = (threadId: string) => `server:remote:${threadId}` as ThreadSplitTargetKey;

function shell(
  threadId: string,
  options: { rootThreadId?: string; updatedAt?: string } = {},
): EnvironmentThreadShell {
  return {
    environmentId,
    id: ThreadId.make(threadId),
    projectId: ProjectId.make("project"),
    updatedAt: options.updatedAt ?? "2026-01-01T00:00:00.000Z",
    taskRelation: options.rootThreadId
      ? {
          rootThreadId: ThreadId.make(options.rootThreadId),
        }
      : null,
  } as unknown as EnvironmentThreadShell;
}

function catalog(
  threads: ThreadSplitReconcileCatalog["threads"],
  overrides: Partial<ThreadSplitReconcileCatalog> = {},
): ThreadSplitReconcileCatalog {
  return {
    environmentCatalogHydrated: true,
    environments: { remote: { threadCatalogHydrated: true } },
    threads,
    draftsHydrated: true,
    draftTargetKeys: [],
    ...overrides,
  };
}

afterEach(() => {
  threadSplitStore.setState({
    version: THREAD_SPLIT_SCHEMA_VERSION,
    groupOrder: [],
    groups: {},
    activeGroupId: null,
  });
  vi.restoreAllMocks();
});

describe("thread split production reconciliation", () => {
  it("builds durable scoped task metadata and independent hydration flags", () => {
    const built = buildThreadSplitReconcileCatalog({
      environmentCatalogHydrated: true,
      environmentIds: [environmentId, EnvironmentId.make("offline")],
      hydratedEnvironmentIds: new Set([environmentId]),
      threadShells: [
        shell("root"),
        shell("child", {
          rootThreadId: "root",
          updatedAt: "2026-02-02T00:00:00.000Z",
        }),
      ],
      draftsHydrated: false,
      draftIds: ["draft-1"],
    });

    expect(built).toEqual({
      environmentCatalogHydrated: true,
      environments: {
        remote: { threadCatalogHydrated: true },
        offline: { threadCatalogHydrated: false },
      },
      threads: [
        {
          targetKey: "server:remote:root",
          rootThreadKey: null,
          updatedAt: "2026-01-01T00:00:00.000Z",
          treeOrder: 0,
        },
        {
          targetKey: "server:remote:child",
          rootThreadKey: "remote:root",
          updatedAt: "2026-02-02T00:00:00.000Z",
          treeOrder: 1,
        },
      ],
      draftsHydrated: false,
      draftTargetKeys: ["draft:draft-1"],
    });
  });

  it("routes the production catalog into the authoritative store", () => {
    const reconcile = vi.spyOn(threadSplitStore.getState(), "reconcile");
    const value = catalog([]);

    reconcileThreadSplits(value);

    expect(reconcile).toHaveBeenCalledOnce();
    expect(reconcile).toHaveBeenCalledWith(value);
  });

  it("observes and auto-adds a genuinely new descendant", () => {
    const root = target("root");
    const peer = target("peer");
    const child = target("child");
    threadSplitStore.setState({
      version: THREAD_SPLIT_SCHEMA_VERSION,
      groupOrder: ["task"],
      activeGroupId: "task",
      groups: {
        task: {
          id: "task",
          targetKeys: [root, peer],
          focusedTargetKey: root,
          layoutMode: "auto",
          weights: [0.5, 0.5],
          taskTreeBinding: {
            rootThreadKey: "remote:root",
            observedDescendantKeys: [],
            excludedDescendantKeys: [],
          },
        },
      },
    });

    reconcileThreadSplits(
      catalog([
        { targetKey: root, rootThreadKey: null, treeOrder: 0 },
        { targetKey: peer, rootThreadKey: null, treeOrder: 1 },
        {
          targetKey: child,
          rootThreadKey: "remote:root",
          updatedAt: "2026-02-02T00:00:00.000Z",
          treeOrder: 2,
        },
      ]),
    );

    expect(threadSplitStore.getState().groups.task?.targetKeys).toEqual([root, peer, child]);
    expect(
      threadSplitStore.getState().groups.task?.taskTreeBinding?.observedDescendantKeys,
    ).toEqual(["remote:child"]);
  });

  it("preserves unhydrated panes and prunes hydrated missing threads and drafts", () => {
    const root = target("root");
    const missing = target("missing");
    const draft = "draft:missing" as ThreadSplitTargetKey;
    threadSplitStore.setState({
      version: THREAD_SPLIT_SCHEMA_VERSION,
      groupOrder: ["group"],
      activeGroupId: "group",
      groups: {
        group: {
          id: "group",
          targetKeys: [root, missing, draft],
          focusedTargetKey: root,
          layoutMode: "auto",
          weights: [1 / 3, 1 / 3, 1 / 3],
        },
      },
    });

    reconcileThreadSplits(
      catalog([], {
        environments: { remote: { threadCatalogHydrated: false } },
        draftsHydrated: false,
      }),
    );
    expect(threadSplitStore.getState().groups.group?.targetKeys).toEqual([root, missing, draft]);

    reconcileThreadSplits(catalog([{ targetKey: root, rootThreadKey: null, treeOrder: 0 }]));
    expect(threadSplitStore.getState().groups.group).toBeUndefined();
  });
});
