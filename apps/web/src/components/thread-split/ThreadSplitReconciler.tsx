import { useAtomValue } from "@effect/atom-react";
import { scopedThreadKey } from "@t3tools/client-runtime/environment";
import type { EnvironmentThreadShell } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId } from "@t3tools/contracts";
import { Atom } from "effect/unstable/reactivity";
import { useEffect, useMemo, useSyncExternalStore } from "react";

import { useComposerDraftStore } from "../../composerDraftStore";
import { environmentCatalog } from "../../connection/catalog";
import { useThreadShells } from "../../state/entities";
import { environmentShell } from "../../state/shell";
import {
  threadSplitStore,
  type ThreadSplitReconcileCatalog,
  type ThreadSplitTargetKey,
} from "../../threadSplitStore";

interface ThreadSplitCatalogSource {
  environmentCatalogHydrated: boolean;
  environmentIds: readonly EnvironmentId[];
  hydratedEnvironmentIds: ReadonlySet<EnvironmentId>;
  threadShells: readonly EnvironmentThreadShell[];
  draftsHydrated: boolean;
  draftIds: readonly string[];
}

export function buildThreadSplitReconcileCatalog(
  source: ThreadSplitCatalogSource,
): ThreadSplitReconcileCatalog {
  return {
    environmentCatalogHydrated: source.environmentCatalogHydrated,
    environments: Object.fromEntries(
      source.environmentIds.map((environmentId) => [
        environmentId,
        { threadCatalogHydrated: source.hydratedEnvironmentIds.has(environmentId) },
      ]),
    ),
    threads: source.threadShells.map((thread, treeOrder) => ({
      targetKey: `server:${scopedThreadKey({
        environmentId: thread.environmentId,
        threadId: thread.id,
      })}` as ThreadSplitTargetKey,
      rootThreadKey: thread.taskRelation
        ? scopedThreadKey({
            environmentId: thread.environmentId,
            threadId: thread.taskRelation.rootThreadId,
          })
        : null,
      updatedAt: thread.updatedAt,
      treeOrder,
    })),
    draftsHydrated: source.draftsHydrated,
    draftTargetKeys: source.draftIds.map((draftId) => `draft:${draftId}` as ThreadSplitTargetKey),
  };
}

export function reconcileThreadSplits(catalog: ThreadSplitReconcileCatalog): void {
  threadSplitStore.getState().reconcile(catalog);
}

function subscribeDraftHydration(onStoreChange: () => void): () => void {
  const unsubscribeHydrating = useComposerDraftStore.persist.onHydrate(onStoreChange);
  const unsubscribeHydrated = useComposerDraftStore.persist.onFinishHydration(onStoreChange);
  return () => {
    unsubscribeHydrating();
    unsubscribeHydrated();
  };
}

function readDraftHydration(): boolean {
  return useComposerDraftStore.persist.hasHydrated();
}

export function ThreadSplitReconciler() {
  const catalog = useAtomValue(environmentCatalog.catalogValueAtom);
  const threadShells = useThreadShells();
  const draftThreadsByThreadKey = useComposerDraftStore((state) => state.draftThreadsByThreadKey);
  const draftsHydrated = useSyncExternalStore(
    subscribeDraftHydration,
    readDraftHydration,
    () => false,
  );
  const environmentIds = useMemo(() => [...catalog.entries.keys()], [catalog.entries]);
  const hydratedEnvironmentsAtom = useMemo(
    () =>
      Atom.make((get) => {
        const hydrated = new Set<EnvironmentId>();
        for (const environmentId of environmentIds) {
          if (get(environmentShell.stateValueAtom(environmentId)).status === "live") {
            hydrated.add(environmentId);
          }
        }
        return hydrated;
      }),
    [environmentIds],
  );
  const hydratedEnvironmentIds = useAtomValue(hydratedEnvironmentsAtom);
  const draftIds = useMemo(() => Object.keys(draftThreadsByThreadKey), [draftThreadsByThreadKey]);
  const reconcileCatalog = useMemo(
    () =>
      buildThreadSplitReconcileCatalog({
        environmentCatalogHydrated: catalog.isReady,
        environmentIds,
        hydratedEnvironmentIds,
        threadShells,
        draftsHydrated,
        draftIds,
      }),
    [
      catalog.isReady,
      draftIds,
      draftsHydrated,
      environmentIds,
      hydratedEnvironmentIds,
      threadShells,
    ],
  );

  useEffect(() => {
    reconcileThreadSplits(reconcileCatalog);
  }, [reconcileCatalog]);

  return null;
}
