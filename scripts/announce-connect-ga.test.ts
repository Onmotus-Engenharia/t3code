import { describe, expect, it } from "vite-plus/test";

import { parseOptions, renderConnectGaEmail } from "./announce-connect-ga.js";

describe("announce-connect-ga", () => {
  it("defaults to a dry run with the worktree-local ledger", () => {
    expect(parseOptions([], "/worktree")).toEqual({
      send: false,
      limit: undefined,
      ledgerPath: "/worktree/.t3/connect-ga-email-ledger.jsonl",
    });
  });

  it("requires an explicit send flag and accepts a bounded test run", () => {
    expect(parseOptions(["--send", "--limit", "2", "--ledger", "sent.jsonl"], "/worktree")).toEqual(
      {
        send: true,
        limit: 2,
        ledgerPath: "/worktree/sent.jsonl",
      },
    );
  });

  it("rejects invalid limits", () => {
    expect(() => parseOptions(["--limit", "0"])).toThrow(
      "--limit must be followed by a positive integer.",
    );
  });

  it("renders a personal plain-text and HTML announcement", () => {
    const email = renderConnectGaEmail("https://example.com/sign-in");
    expect(email.subject).toContain("T3 Connect");
    expect(email.text).toContain("Julius");
    expect(email.text).toContain("https://example.com/sign-in");
    expect(email.html).toContain('href="https://example.com/sign-in"');
  });
});
