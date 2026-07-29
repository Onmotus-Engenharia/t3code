import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import { selectLatestCodexRateLimits } from "@t3tools/shared/providerRateLimits";

import { clampUsagePercent, formatUsageReset, getCodexUsage } from "./codexUsage";

describe("mobile Codex usage settings", () => {
  it("clamps usage percentages to the progress range", () => {
    expect(clampUsagePercent(-4)).toBe(0);
    expect(clampUsagePercent(42.5)).toBe(42.5);
    expect(clampUsagePercent(140)).toBe(100);
    expect(clampUsagePercent(Number.NaN)).toBe(0);
  });

  it("formats compact reset details", () => {
    const now = Date.parse("2026-07-29T12:00:00.000Z");

    expect(formatUsageReset(Date.parse("2026-07-29T12:45:00.000Z") / 1_000, now)).toBe(
      "Resets in 45m",
    );
    expect(formatUsageReset(Date.parse("2026-07-29T14:15:00.000Z") / 1_000, now)).toBe(
      "Resets in 2h 15m",
    );
    expect(formatUsageReset(Date.parse("2026-07-31T15:00:00.000Z") / 1_000, now)).toBe(
      "Resets in 2d 3h",
    );
  });

  it("omits missing or invalid reset details", () => {
    expect(formatUsageReset(null)).toBeNull();
    expect(formatUsageReset(Number.NaN)).toBeNull();
  });

  it("uses real five-hour and weekly windows regardless of provider order", () => {
    expect(
      getCodexUsage({
        primary: { usedPercent: 70, windowDurationMins: 10_080 },
        secondary: { usedPercent: 25, windowDurationMins: 300 },
      }),
    ).toEqual({
      fiveHour: { usedPercent: 25, resetsAt: undefined },
      weekly: { usedPercent: 70, resetsAt: undefined },
    });
    expect(getCodexUsage({ primary: { usedPercent: 25, windowDurationMins: 300 } })).toBeNull();
  });

  it("selects the freshest Codex snapshot", () => {
    const older = { primary: { usedPercent: 20, windowDurationMins: 300 } };
    const newer = { primary: { usedPercent: 40, windowDurationMins: 300 } };
    expect(
      selectLatestCodexRateLimits([
        {
          provider: ProviderDriverKind.make("codex"),
          updatedAt: "2026-07-29T10:00:00.000Z",
          rateLimits: older,
        },
        {
          provider: ProviderDriverKind.make("claudeAgent"),
          updatedAt: "2026-07-29T12:00:00.000Z",
          rateLimits: newer,
        },
        {
          provider: ProviderDriverKind.make("codex"),
          updatedAt: "2026-07-29T11:00:00.000Z",
          rateLimits: newer,
        },
      ]),
    ).toBe(newer);
    expect(selectLatestCodexRateLimits([])).toBeNull();
  });

  it("selects only the configured Codex instance", () => {
    const configured = ProviderInstanceId.make("codex-work");
    const other = ProviderInstanceId.make("codex-other-environment");
    const expected = { primary: { usedPercent: 31, windowDurationMins: 300 } };
    const otherSnapshot = {
      provider: ProviderDriverKind.make("codex"),
      providerInstanceId: other,
      updatedAt: "2026-07-29T12:00:00.000Z",
      rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } },
    };

    expect(
      selectLatestCodexRateLimits(
        [
          otherSnapshot,
          {
            provider: ProviderDriverKind.make("codex"),
            providerInstanceId: configured,
            updatedAt: "2026-07-29T11:00:00.000Z",
            rateLimits: expected,
          },
        ],
        new Set([configured]),
      ),
    ).toBe(expected);
    expect(selectLatestCodexRateLimits([otherSnapshot], new Set([configured]))).toBeNull();
  });
});
