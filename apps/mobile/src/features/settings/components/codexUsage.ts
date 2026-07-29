import type { ProviderRateLimits } from "@t3tools/contracts";

export interface CodexUsageWindow {
  readonly usedPercent: number;
  readonly resetsAt?: number | null;
}

export interface CodexUsage {
  readonly fiveHour: CodexUsageWindow;
  readonly weekly: CodexUsageWindow;
}

export function getCodexUsage(rateLimits: ProviderRateLimits): CodexUsage | null {
  const windows = [rateLimits.primary, rateLimits.secondary].filter(
    (window): window is NonNullable<typeof window> =>
      window !== undefined &&
      window.usedPercent !== undefined &&
      Number.isFinite(window.usedPercent),
  );
  const fiveHour = windows.find((window) => window.windowDurationMins === 300);
  const weekly = windows.find((window) => window.windowDurationMins === 10_080);
  if (!fiveHour || !weekly) return null;

  return {
    fiveHour: { usedPercent: fiveHour.usedPercent ?? 0, resetsAt: fiveHour.resetsAt },
    weekly: { usedPercent: weekly.usedPercent ?? 0, resetsAt: weekly.resetsAt },
  };
}

export function clampUsagePercent(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(100, Math.max(0, value));
}

export function formatUsageReset(
  resetsAt: number | null | undefined,
  now = Date.now(),
): string | null {
  if (resetsAt === null || resetsAt === undefined) return null;
  const resetTime = resetsAt * 1_000;
  if (!Number.isFinite(resetTime)) return null;

  const remainingMinutes = Math.max(0, Math.ceil((resetTime - now) / 60_000));
  if (remainingMinutes < 60) return `Resets in ${remainingMinutes}m`;

  const hours = Math.floor(remainingMinutes / 60);
  const minutes = remainingMinutes % 60;
  if (hours < 24) return `Resets in ${hours}h${minutes > 0 ? ` ${minutes}m` : ""}`;

  const days = Math.floor(hours / 24);
  const remainingHours = hours % 24;
  return `Resets in ${days}d${remainingHours > 0 ? ` ${remainingHours}h` : ""}`;
}
