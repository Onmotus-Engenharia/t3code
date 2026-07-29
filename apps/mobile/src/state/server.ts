import { createServerEnvironmentAtoms } from "@t3tools/client-runtime/state/server";
import { createEnvironmentServerConfigsAtom } from "@t3tools/client-runtime/state/shell";
import type { EnvironmentId, ProviderInstanceId, ProviderRateLimits } from "@t3tools/contracts";
import { selectLatestCodexRateLimits } from "@t3tools/shared/providerRateLimits";
import * as Option from "effect/Option";
import { AsyncResult, Atom } from "effect/unstable/reactivity";

import { environmentCatalog } from "../connection/catalog";
import { connectionAtomRuntime } from "../connection/runtime";
import { environmentSession } from "./session";

export const serverEnvironment = createServerEnvironmentAtoms(connectionAtomRuntime, {
  initialConfigValueAtom: environmentSession.initialConfigValueAtom,
});
export const environmentServerConfigsAtom = createEnvironmentServerConfigsAtom({
  catalogValueAtom: environmentCatalog.catalogValueAtom,
  serverConfigValueAtom: serverEnvironment.configValueAtom,
});

export const settingsEnvironmentIdAtom = Atom.make((get): EnvironmentId | null => {
  const entries = get(environmentCatalog.catalogValueAtom).entries;
  for (const [environmentId, entry] of entries) {
    if (entry.target._tag === "PrimaryConnectionTarget") return environmentId;
  }
  return entries.keys().next().value ?? null;
}).pipe(Atom.withLabel("mobile-settings:environment-id"));

export const codexRateLimitsAtom = Atom.make((get): ProviderRateLimits | null => {
  const environmentId = get(settingsEnvironmentIdAtom);
  if (environmentId === null) return null;

  const configuredInstanceIds = new Set<ProviderInstanceId>(
    (get(serverEnvironment.configValueAtom(environmentId))?.providers ?? [])
      .filter((provider) => provider.driver === "codex" && provider.enabled)
      .map((provider) => provider.instanceId),
  );
  const result = get(serverEnvironment.providerRateLimits({ environmentId, input: {} }));
  return selectLatestCodexRateLimits(
    Option.getOrElse(AsyncResult.value(result), () => []),
    configuredInstanceIds,
  );
}).pipe(Atom.withLabel("mobile-settings:codex-rate-limits"));
