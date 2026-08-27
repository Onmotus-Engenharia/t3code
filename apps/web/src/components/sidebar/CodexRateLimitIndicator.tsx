import { memo } from "react";
import type { ProviderRateLimitWindow, ProviderRateLimits } from "@t3tools/contracts";
import { selectCodexUsageWindows } from "@t3tools/shared/providerRateLimits";

import { cn } from "../../lib/utils";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

type RateLimitRowProps = {
  label: string;
  window: ProviderRateLimitWindow & { readonly usedPercent: number };
};

function clampPercent(percent: number) {
  return Math.min(100, Math.max(0, percent));
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
  const { fiveHour, weekly } = selectCodexUsageWindows(rateLimits);
  const windows: Array<
    readonly [string, ProviderRateLimitWindow & { readonly usedPercent: number }]
  > = [];
  if (fiveHour) {
    windows.push(["5h", fiveHour]);
  }
  if (weekly) {
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
    <Tooltip>
      <TooltipTrigger
        render={
          <div
            aria-label="Codex usage limits"
            className="space-y-1 px-2 py-1"
            data-slot="codex-rate-limit-indicator"
          />
        }
      >
        {windows.map(([label, window]) => (
          <RateLimitRow key={label} label={label} window={window} />
        ))}
      </TooltipTrigger>
      <TooltipPopup side="top">
        <span className="whitespace-pre-line">{title}</span>
      </TooltipPopup>
    </Tooltip>
  );
});
