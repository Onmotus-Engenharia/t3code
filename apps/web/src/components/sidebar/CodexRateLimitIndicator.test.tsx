import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vite-plus/test";

import { CodexRateLimitIndicator } from "./CodexRateLimitIndicator";

describe("CodexRateLimitIndicator", () => {
  it("renders nothing without real usage data", () => {
    expect(renderToStaticMarkup(<CodexRateLimitIndicator rateLimits={null} />)).toBe("");
    expect(renderToStaticMarkup(<CodexRateLimitIndicator rateLimits={{}} />)).toBe("");
  });

  it("renders accessible five-hour and weekly usage", () => {
    const markup = renderToStaticMarkup(
      <CodexRateLimitIndicator
        rateLimits={{
          primary: { usedPercent: 81.2, resetsAt: 1_785_758_400, windowDurationMins: 10_080 },
          secondary: { usedPercent: 24.6, resetsAt: 1_785_345_600, windowDurationMins: 300 },
        }}
      />,
    );

    expect(markup).toContain("Codex usage limits");
    expect(markup).toContain("5h");
    expect(markup).toContain("Week");
    expect(markup).toContain('role="progressbar"');
    expect(markup).toContain('aria-valuenow="25"');
    expect(markup).toContain('aria-valuenow="81"');
    expect(markup).toContain("Resets");
  });

  it("clamps malformed percentages", () => {
    const markup = renderToStaticMarkup(
      <CodexRateLimitIndicator
        rateLimits={{ primary: { usedPercent: -4 }, secondary: { usedPercent: 140 } }}
      />,
    );

    expect(markup).toContain('aria-valuenow="0"');
    expect(markup).toContain('aria-valuenow="100"');
    expect(markup).toContain("width:0%");
    expect(markup).toContain("width:100%");
  });
});
