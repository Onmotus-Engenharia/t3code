import type { ProviderRateLimits } from "@t3tools/contracts";
import {
  selectCodexUsageWindows,
  type AvailableProviderRateLimitWindow,
} from "@t3tools/shared/providerRateLimits";
import { cn } from "~/lib/utils";
import {
  type ContextWindowSnapshot,
  formatContextWindowTokens,
  type TaskTreeContextWindowUsage,
} from "~/lib/contextWindow";
import { Button } from "../ui/button";
import { Popover, PopoverPopup, PopoverTrigger } from "../ui/popover";
import { formatContextWindowCompactionMessage } from "./ContextWindowMeter.logic";
import { Minimize2Icon } from "lucide-react";

function formatPercentage(value: number | null): string | null {
  if (value === null || !Number.isFinite(value)) {
    return null;
  }
  if (value < 10) {
    return `${value.toFixed(1).replace(/\.0$/, "")}%`;
  }
  return `${Math.round(value)}%`;
}

function UsageLimitRow(props: { label: string; window: AvailableProviderRateLimitWindow }) {
  const usedPercent = Math.round(Math.max(0, Math.min(100, props.window.usedPercent)));
  return (
    <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
      <span className="text-muted-foreground/60">{props.label}</span>
      <span className="font-medium tabular-nums text-muted-foreground/80">{usedPercent}% used</span>
    </div>
  );
}

export function ContextWindowMeter(props: {
  usage: ContextWindowSnapshot;
  taskTreeUsage?: TaskTreeContextWindowUsage | null;
  providerDisplayName?: string | null;
  fullDiffStat?: { readonly additions: number; readonly deletions: number } | null;
  codexRateLimits?: ProviderRateLimits | null;
  modelDisplayName?: string | null;
  onCompact?: (() => void) | undefined;
  compactDisabled?: boolean | undefined;
  compactDisabledReason?: string | null | undefined;
}) {
  const {
    usage,
    taskTreeUsage,
    fullDiffStat,
    codexRateLimits,
    modelDisplayName,
    onCompact,
    compactDisabled,
    compactDisabledReason,
  } = props;
  const usedPercentage = formatPercentage(usage.usedPercentage);
  const normalizedPercentage = Math.max(0, Math.min(100, usage.usedPercentage ?? 0));
  const radius = 9.75;
  const circumference = 2 * Math.PI * radius;
  const dashOffset = circumference - (normalizedPercentage / 100) * circumference;
  const totalProcessedTokens = usage.totalProcessedTokens ?? usage.usedTokens;
  const showTotalProcessed = totalProcessedTokens > 0;
  const taskTreeUsedPercentage = formatPercentage(taskTreeUsage?.usedPercentage ?? null);
  const normalizedTaskTreePercentage = Math.max(
    0,
    Math.min(100, taskTreeUsage?.usedPercentage ?? 0),
  );
  const isOverloaded = normalizedPercentage > 90;
  const usageColor = isOverloaded
    ? "var(--color-error)"
    : "color-mix(in oklab, var(--color-muted-foreground) 72%, transparent)";
  const codexUsage = selectCodexUsageWindows(codexRateLimits);
  const showCodexUsage = codexUsage.fiveHour !== null || codexUsage.weekly !== null;

  return (
    <Popover>
      <PopoverTrigger
        openOnHover
        delay={150}
        closeDelay={onCompact ? 150 : 0}
        render={
          <Button
            size="icon-sm"
            variant="ghost-muted"
            className="size-7 rounded-full hover:text-muted-foreground data-pressed:text-muted-foreground"
            aria-label={
              usage.maxTokens !== null && usedPercentage
                ? `Context window ${usedPercentage} used`
                : `Context window ${formatContextWindowTokens(usage.usedTokens)} tokens used`
            }
          >
            <span className="relative flex size-5 items-center justify-center">
              <svg
                viewBox="0 0 24 24"
                className="-rotate-90 absolute inset-0 size-full transform-gpu mx-0!"
                aria-hidden="true"
              >
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke="color-mix(in oklab, var(--color-muted-foreground) 24%, transparent)"
                  strokeWidth="3"
                />
                <circle
                  cx="12"
                  cy="12"
                  r={radius}
                  fill="none"
                  stroke={usageColor}
                  strokeWidth="3"
                  strokeLinecap="round"
                  strokeDasharray={circumference}
                  strokeDashoffset={dashOffset}
                  className="transition-[stroke-dashoffset,stroke] duration-500 ease-out motion-reduce:transition-none"
                />
              </svg>
            </span>
          </Button>
        }
      />
      <PopoverPopup
        tooltipStyle
        side="top"
        align="end"
        viewportClassName="p-0"
        className="w-64 max-w-none text-left whitespace-normal"
      >
        <div className="flex flex-col gap-2 p-[var(--floating-content-inset)]">
          <div className="flex items-center justify-between gap-3">
            <div className="font-medium text-muted-foreground text-xs">Context Window</div>
            {usage.maxTokens !== null && usedPercentage ? (
              <div className="text-secondary-label text-[11px] tabular-nums">
                <span>{usedPercentage}</span>
                <span className="mx-1">·</span>
                <span>
                  {formatContextWindowTokens(usage.usedTokens)}/
                  {formatContextWindowTokens(usage.maxTokens ?? null)}
                </span>
              </div>
            ) : (
              <div className="text-secondary-label text-[11px] tabular-nums">
                {formatContextWindowTokens(usage.usedTokens)}
              </div>
            )}
          </div>
          {usage.maxTokens !== null ? (
            <div
              className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
              role="progressbar"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(normalizedPercentage)}
              aria-label="Context window usage"
            >
              <div
                className="h-full rounded-full transition-[width,background-color] duration-500 ease-out motion-reduce:transition-none"
                style={{ width: `${normalizedPercentage}%`, backgroundColor: usageColor }}
              />
            </div>
          ) : null}
          {showTotalProcessed ? (
            <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
              <span className="text-secondary-label">Total processed</span>
              <span className="font-medium tabular-nums text-secondary-label">
                {formatContextWindowTokens(totalProcessedTokens)}
              </span>
            </div>
          ) : null}
          {taskTreeUsage ? (
            <div className="mt-1 flex flex-col gap-2 border-border/50 border-t pt-2">
              <div className="flex items-center justify-between gap-3">
                <div className="font-medium text-muted-foreground text-xs">
                  All tasks
                  <span className="ml-1 text-[10px] text-muted-foreground/50">
                    {taskTreeUsage.taskCount}
                  </span>
                </div>
                {taskTreeUsage.maxTokens !== null && taskTreeUsedPercentage ? (
                  <div className="text-[11px] tabular-nums text-muted-foreground/70">
                    <span>{taskTreeUsedPercentage}</span>
                    <span className="mx-1">·</span>
                    <span>
                      {formatContextWindowTokens(taskTreeUsage.usedTokens)}/
                      {formatContextWindowTokens(taskTreeUsage.maxTokens)}
                    </span>
                  </div>
                ) : (
                  <div className="text-[11px] tabular-nums text-muted-foreground/70">
                    {formatContextWindowTokens(taskTreeUsage.usedTokens)}
                  </div>
                )}
              </div>
              {taskTreeUsage.maxTokens !== null ? (
                <div
                  className="h-1.5 w-full overflow-hidden rounded-full bg-muted/60"
                  role="progressbar"
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(normalizedTaskTreePercentage)}
                  aria-label="All tasks context window usage"
                >
                  <div
                    className="h-full rounded-full bg-muted-foreground/70 transition-[width] duration-500 ease-out motion-reduce:transition-none"
                    style={{ width: `${normalizedTaskTreePercentage}%` }}
                  />
                </div>
              ) : null}
              <div className="flex items-center justify-between gap-3 text-[11px] leading-4">
                <span className="text-muted-foreground/60">Total processed</span>
                <span className="font-medium tabular-nums text-muted-foreground/80">
                  {formatContextWindowTokens(taskTreeUsage.totalProcessedTokens)}
                </span>
              </div>
            </div>
          ) : null}
          {fullDiffStat ? (
            <div className="mt-1 flex items-center justify-between gap-3 border-border/50 border-t pt-2 text-[11px] leading-4">
              <span className="text-muted-foreground/60">
                {taskTreeUsage ? "Full task tree" : "Full thread"}
              </span>
              <span
                aria-label={`${fullDiffStat.additions} additions, ${fullDiffStat.deletions} deletions`}
                className="flex items-center gap-2 font-medium font-mono tabular-nums"
              >
                <span className="text-success">+{fullDiffStat.additions}</span>
                <span className="text-destructive">-{fullDiffStat.deletions}</span>
              </span>
            </div>
          ) : null}
          {showCodexUsage ? (
            <div className="mt-1 flex flex-col gap-1 border-border/50 border-t pt-2">
              <div className="mb-0.5 font-medium text-muted-foreground text-xs">Codex usage</div>
              {codexUsage.fiveHour ? (
                <UsageLimitRow label="5h" window={codexUsage.fiveHour} />
              ) : null}
              {codexUsage.weekly ? (
                <UsageLimitRow label="Weekly" window={codexUsage.weekly} />
              ) : null}
            </div>
          ) : null}
          {usage.compactsAutomatically ? (
            <div className="mt-1 text-pretty text-secondary-label text-[11px] font-medium">
              {formatContextWindowCompactionMessage(modelDisplayName, usage.autoCompactThreshold)}
            </div>
          ) : null}
          {onCompact ? (
            <>
              <Button
                size="xs"
                variant="outline"
                className="mt-1 w-full justify-center"
                disabled={compactDisabled}
                onClick={onCompact}
              >
                <Minimize2Icon aria-hidden="true" />
                Compact context
              </Button>
              {compactDisabled && compactDisabledReason ? (
                <div className="text-pretty text-secondary-label text-[11px]">
                  {compactDisabledReason}
                </div>
              ) : null}
            </>
          ) : null}
        </div>
      </PopoverPopup>
    </Popover>
  );
}
