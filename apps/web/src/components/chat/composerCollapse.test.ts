import { describe, expect, it } from "vite-plus/test";

import {
  THREAD_PANE_COMPOSER_COLLAPSE_HEIGHT_PX,
  getCollapsedComposerContentSummary,
  resolveComposerCollapsed,
  shouldAutoCollapseComposer,
} from "./composerCollapse";

describe("shouldAutoCollapseComposer", () => {
  it("only collapses an undersized individual thread pane", () => {
    expect(shouldAutoCollapseComposer(THREAD_PANE_COMPOSER_COLLAPSE_HEIGHT_PX - 1, true)).toBe(
      true,
    );
    expect(shouldAutoCollapseComposer(THREAD_PANE_COMPOSER_COLLAPSE_HEIGHT_PX, true)).toBe(false);
    expect(shouldAutoCollapseComposer(320, false)).toBe(false);
    expect(shouldAutoCollapseComposer(null, true)).toBe(false);
  });
});

describe("resolveComposerCollapsed", () => {
  it("defaults to auto-collapse when there is no manual choice", () => {
    expect(resolveComposerCollapsed({ autoCollapsed: true, manualOverride: null })).toBe(true);
    expect(resolveComposerCollapsed({ autoCollapsed: false, manualOverride: null })).toBe(false);
  });

  it("keeps a manual choice over auto-collapse", () => {
    expect(resolveComposerCollapsed({ autoCollapsed: true, manualOverride: "expanded" })).toBe(
      false,
    );
    expect(resolveComposerCollapsed({ autoCollapsed: false, manualOverride: "collapsed" })).toBe(
      true,
    );
  });
});

describe("getCollapsedComposerContentSummary", () => {
  it("reports all hidden draft content compactly", () => {
    expect(
      getCollapsedComposerContentSummary({
        prompt: "Keep this draft",
        attachmentCount: 2,
        contextCount: 1,
      }),
    ).toBe("Draft · 2 attachments · 1 context");
  });

  it("does not show an indicator when nothing is hidden", () => {
    expect(
      getCollapsedComposerContentSummary({ prompt: "  ", attachmentCount: 0, contextCount: 0 }),
    ).toBeNull();
  });
});
