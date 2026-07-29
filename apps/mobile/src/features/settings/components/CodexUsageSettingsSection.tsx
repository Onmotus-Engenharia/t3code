import { View } from "react-native";
import type { ProviderRateLimits } from "@t3tools/contracts";

import { AppText as Text } from "../../../components/AppText";

import {
  clampUsagePercent,
  formatUsageReset,
  getCodexUsage,
  type CodexUsageWindow,
} from "./codexUsage";
import { SettingsSection } from "./SettingsSection";

function UsageLine(props: { readonly label: string; readonly usage: CodexUsageWindow }) {
  const percent = clampUsagePercent(props.usage.usedPercent);
  const roundedPercent = Math.round(percent);
  const reset = formatUsageReset(props.usage.resetsAt);

  return (
    <View
      accessible
      accessibilityLabel={`${props.label} Codex usage`}
      accessibilityRole="progressbar"
      accessibilityValue={{
        min: 0,
        max: 100,
        now: roundedPercent,
        text: `${roundedPercent}% used`,
      }}
      className="gap-1.5"
    >
      <View className="flex-row items-baseline justify-between gap-3">
        <Text className="text-sm font-t3-medium text-foreground">{props.label}</Text>
        <View className="min-w-0 flex-1 flex-row items-baseline justify-end gap-2">
          {reset ? (
            <Text className="shrink text-xs text-foreground-muted" numberOfLines={1}>
              {reset}
            </Text>
          ) : null}
          <Text className="text-sm font-t3-medium text-foreground-muted">{roundedPercent}%</Text>
        </View>
      </View>
      <View className="h-1.5 overflow-hidden rounded-full bg-subtle">
        <View
          className="h-full rounded-full bg-foreground-muted"
          style={{ width: `${percent}%` }}
        />
      </View>
    </View>
  );
}

export function CodexUsageSettingsSection(props: {
  readonly rateLimits: ProviderRateLimits | null | undefined;
}) {
  const usage = props.rateLimits ? getCodexUsage(props.rateLimits) : null;
  if (!usage) return null;

  return (
    <SettingsSection title="Codex usage">
      <View className="gap-3 px-4 py-3.5">
        <UsageLine label="5h" usage={usage.fiveHour} />
        <UsageLine label="Weekly" usage={usage.weekly} />
      </View>
    </SettingsSection>
  );
}
