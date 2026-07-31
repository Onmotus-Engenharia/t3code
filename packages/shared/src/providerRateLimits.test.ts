import { describe, expect, it } from "vite-plus/test";
import { ProviderDriverKind, ProviderInstanceId } from "@t3tools/contracts";
import {
  mergeProviderRateLimits,
  selectCodexUsageWindows,
  selectLatestCodexRateLimits,
} from "./providerRateLimits.ts";

describe("mergeProviderRateLimits", () => {
  it("retains missing fields from sparse rolling updates", () => {
    expect(
      mergeProviderRateLimits(
        {
          primary: { usedPercent: 10, resetsAt: 100, windowDurationMins: 300 },
          secondary: { usedPercent: 20, resetsAt: 200, windowDurationMins: 10_080 },
        },
        { primary: { usedPercent: 11 } },
      ),
    ).toEqual({
      primary: { usedPercent: 11, resetsAt: 100, windowDurationMins: 300 },
      secondary: { usedPercent: 20, resetsAt: 200, windowDurationMins: 10_080 },
    });
  });
});

describe("selectCodexUsageWindows", () => {
  it("identifies five-hour and weekly windows regardless of provider order", () => {
    expect(
      selectCodexUsageWindows({
        primary: { usedPercent: 72, windowDurationMins: 10_080 },
        secondary: { usedPercent: 24, windowDurationMins: 300 },
      }),
    ).toEqual({
      fiveHour: { usedPercent: 24, windowDurationMins: 300 },
      weekly: { usedPercent: 72, windowDurationMins: 10_080 },
    });
  });

  it("omits unavailable and malformed windows", () => {
    expect(
      selectCodexUsageWindows({
        primary: { usedPercent: Number.NaN, windowDurationMins: 300 },
      }),
    ).toEqual({ fiveHour: null, weekly: null });
  });
});

describe("selectLatestCodexRateLimits", () => {
  it("selects the newest configured Codex instance", () => {
    const configured = ProviderInstanceId.make("codex-work");
    const expected = { primary: { usedPercent: 31, windowDurationMins: 300 } };

    expect(
      selectLatestCodexRateLimits(
        [
          {
            provider: ProviderDriverKind.make("codex"),
            providerInstanceId: ProviderInstanceId.make("codex-other"),
            updatedAt: "2026-07-29T12:00:00.000Z",
            rateLimits: { primary: { usedPercent: 99, windowDurationMins: 300 } },
          },
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
  });
});
