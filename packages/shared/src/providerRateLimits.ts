import type {
  ProviderInstanceId,
  ProviderRateLimitWindow,
  ProviderRateLimits,
  ProviderRateLimitsSnapshot,
} from "@t3tools/contracts";

function mergeWindow(
  previous: ProviderRateLimitWindow | undefined,
  update: ProviderRateLimitWindow | undefined,
): ProviderRateLimitWindow | undefined {
  if (!update) return previous;
  return { ...previous, ...update };
}

export function mergeProviderRateLimits(
  previous: ProviderRateLimits | undefined,
  update: ProviderRateLimits,
): ProviderRateLimits {
  const primary = mergeWindow(previous?.primary, update.primary);
  const secondary = mergeWindow(previous?.secondary, update.secondary);
  return {
    ...(primary ? { primary } : {}),
    ...(secondary ? { secondary } : {}),
  };
}

export function selectLatestCodexRateLimits(
  snapshots: ReadonlyArray<ProviderRateLimitsSnapshot>,
  configuredInstanceIds: ReadonlySet<ProviderInstanceId> = new Set(),
): ProviderRateLimits | null {
  const codexSnapshots = snapshots.filter((snapshot) => snapshot.provider === "codex");
  const configuredSnapshots = codexSnapshots.filter(
    (snapshot) =>
      snapshot.providerInstanceId !== undefined &&
      configuredInstanceIds.has(snapshot.providerInstanceId),
  );
  const legacySnapshots = codexSnapshots.filter(
    (snapshot) => snapshot.providerInstanceId === undefined,
  );
  const candidates =
    configuredSnapshots.length > 0
      ? configuredSnapshots
      : legacySnapshots.length > 0
        ? legacySnapshots
        : configuredInstanceIds.size === 0
          ? codexSnapshots
          : [];

  let latest: ProviderRateLimitsSnapshot | null = null;
  for (const snapshot of candidates) {
    if (latest === null || snapshot.updatedAt > latest.updatedAt) {
      latest = snapshot;
    }
  }
  return latest?.rateLimits ?? null;
}
