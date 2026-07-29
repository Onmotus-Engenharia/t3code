import { memo } from "react";
import type { ProviderRateLimitWindow, ProviderRateLimits } from "@t3tools/contracts";

import { cn } from "../../lib/utils";

type RateLimitRowProps = {
  label: string;
  window: ProviderRateLimitWindow & { readonly usedPercent: number };
};

function clampPercent(percent: number) {
  return Math.min(100, Math.max(0, percent));
}

function hasUsage(
  window: ProviderRateLimitWindow | undefined,
): window is ProviderRateLimitWindow & { readonly usedPercent: number } {
  return typeof window?.usedPercent === "number" && Number.isFinite(window.usedPercent);
}

function formatResetTime(value: number | undefined) {
  if (!Number.isFinite(value)) return null;
  const date = new Date(value! * 1_000);
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function RateLimitRow({ label, window }: RateLimitRowProps) {
  const usedPercent = clampPercent(window.usedPercent);
  const roundedPercent = Math.round(usedPercent);
  const resetTime = formatResetTime(window.resetsAt);
  const details = `${label}: ${roundedPercent}% used${resetTime ? `. Resets ${resetTime}` : ""}`;

  return (
    <div className="grid grid-cols-[2.5rem_1fr_2.25rem] items-center gap-1.5">
      <span className="text-[10px] leading-none text-muted-foreground">{label}</span>
      <div
        aria-label={details}
        aria-valuemax={100}
        aria-valuemin={0}
        aria-valuenow={roundedPercent}
        className="h-0.5 overflow-hidden rounded-full bg-foreground/10"
        role="progressbar"
      >
        <div
          className={cn(
            "h-full rounded-full bg-muted-foreground/55",
            roundedPercent >= 90 && "bg-foreground/70",
          )}
          style={{ width: `${usedPercent}%` }}
        />
      </div>
      <span className="text-right text-[10px] tabular-nums leading-none text-muted-foreground">
        {roundedPercent}%
      </span>
    </div>
  );
}

export const CodexRateLimitIndicator = memo(function CodexRateLimitIndicator({
  rateLimits,
}: {
  rateLimits: ProviderRateLimits | null;
}) {
  const availableWindows = [rateLimits?.primary, rateLimits?.secondary];
  const fiveHour =
    availableWindows.find((window) => window?.windowDurationMins === 300) ?? rateLimits?.primary;
  const weekly =
    availableWindows.find((window) => window?.windowDurationMins === 10_080) ??
    rateLimits?.secondary;
  const windows: Array<
    readonly [string, ProviderRateLimitWindow & { readonly usedPercent: number }]
  > = [];
  if (hasUsage(fiveHour)) {
    windows.push(["5h", fiveHour]);
  }
  if (hasUsage(weekly) && weekly !== fiveHour) {
    windows.push(["Week", weekly]);
  }

  if (windows.length === 0) return null;

  const title = windows
    .map(([label, window]) => {
      const usedPercent = Math.round(clampPercent(window.usedPercent));
      const resetTime = formatResetTime(window.resetsAt);
      return `${label}: ${usedPercent}% used${resetTime ? `; resets ${resetTime}` : ""}`;
    })
    .join("\n");

  return (
    <div
      aria-label="Codex usage limits"
      className="space-y-1 px-2 py-1"
      data-slot="codex-rate-limit-indicator"
      title={title}
    >
      {windows.map(([label, window]) => (
        <RateLimitRow key={label} label={label} window={window} />
      ))}
    </div>
  );
});
