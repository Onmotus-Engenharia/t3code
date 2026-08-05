import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { ThreadSplitTargetKey } from "../../threadSplitStore";
import { ThreadSplitIndicator, ThreadSplitShelf } from "./ThreadSplitShelf";

const first = "draft:first" as ThreadSplitTargetKey;
const second = "draft:second" as ThreadSplitTargetKey;

describe("ThreadSplitShelf", () => {
  it("renders stable group order, focused state, controls, and descendant seam", () => {
    const markup = renderToStaticMarkup(
      <ThreadSplitShelf
        activeGroupId="older"
        groups={[
          {
            id: "newest",
            targetKeys: [first, second],
            focusedTargetKey: first,
            layoutMode: "columns",
            weights: [0.5, 0.5],
          },
          {
            id: "older",
            targetKeys: [second, first],
            focusedTargetKey: second,
            layoutMode: "rows",
            weights: [0.5, 0.5],
            availableDescendantKeys: ["draft:descendant" as ThreadSplitTargetKey],
          },
        ]}
        onAddDescendants={vi.fn()}
        onAddThreads={vi.fn()}
        onCloseGroup={vi.fn()}
        onFocusTarget={vi.fn()}
        onRemoveTarget={vi.fn()}
        onSetLayout={vi.fn()}
        resolveTarget={(targetKey) => ({
          title: targetKey === first ? "First thread" : "Second thread",
          statusLabel: targetKey === first ? "Running" : "Idle",
        })}
      />,
    );
    expect(markup.indexOf('aria-label="2-pane split view"')).toBeLessThan(
      markup.lastIndexOf('aria-label="2-pane split view"'),
    );
    expect(markup).toContain('data-active="true"');
    expect(markup).toContain('data-focused="true"');
    expect(markup).toContain("Grid");
    expect(markup).toContain("Side by side · 2 panes");
    expect(markup).toContain("Top and bottom · 2 panes");
    expect(markup).toContain('aria-label="Focus First thread in split view, Running"');
    expect(markup).toContain('aria-label="Remove First thread from split view"');
    expect(markup).toContain('aria-label="Add descendants (1 available)"');
    expect(markup).toContain("Add threads…");
    expect(markup).toContain("Close split view");
  });

  it("provides an accessible split indicator helper", () => {
    expect(renderToStaticMarkup(<ThreadSplitIndicator />)).toContain('aria-label="In split view"');
  });

  it("renders nothing without groups", () => {
    expect(
      renderToStaticMarkup(
        <ThreadSplitShelf
          activeGroupId={null}
          groups={[]}
          onAddDescendants={vi.fn()}
          onAddThreads={vi.fn()}
          onCloseGroup={vi.fn()}
          onFocusTarget={vi.fn()}
          onRemoveTarget={vi.fn()}
          onSetLayout={vi.fn()}
          resolveTarget={() => ({ title: "Thread", statusLabel: "Idle" })}
        />,
      ),
    ).toBe("");
  });
});
