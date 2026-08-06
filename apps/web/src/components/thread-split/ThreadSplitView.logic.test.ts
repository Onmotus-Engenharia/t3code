import { describe, expect, it } from "vite-plus/test";

import { resolveThreadSplitLayout } from "../../threadSplitLayout";
import type { ThreadSplitGroup, ThreadSplitTargetKey } from "../../threadSplitStore";
import {
  hasMeaningfulThreadSplitSizeChange,
  reconcileThreadSplitDrawerOwnerKeys,
  resolveThreadPaneAuxiliaryPanelPresentation,
  resolveShiftGridScrollDelta,
  resolveThreadSplitRenderTargets,
  resolveVisibleGridRowRange,
  selectOpenTerminalKeys,
  threadSplitDividerRenderKey,
  threadSplitSeparatorLabel,
} from "./ThreadSplitView.logic";

const keys = ["server:env:a", "server:env:b", "server:env:c"] as ThreadSplitTargetKey[];
const group: ThreadSplitGroup = {
  id: "group",
  targetKeys: keys,
  focusedTargetKey: keys[1]!,
  layoutMode: "auto",
  weights: [1 / 3, 1 / 3, 1 / 3],
};

describe("ThreadSplitView logic", () => {
  it("restores route-owned groups while standalone routes mount once", () => {
    expect(resolveThreadSplitRenderTargets(keys[0]!, group, false)).toEqual(keys);
    expect(resolveThreadSplitRenderTargets(keys[0]!, undefined, false)).toEqual([keys[0]]);
  });

  it("mounts only the focused group member in compact workspaces", () => {
    expect(resolveThreadSplitRenderTargets(keys[0]!, group, true)).toEqual([keys[1]]);
  });

  it("keeps standalone panes on ChatView's automatic auxiliary-panel policy", () => {
    expect(resolveThreadPaneAuxiliaryPanelPresentation(null, false)).toBe("auto");
  });

  it("keeps compact and narrow split panes in sheets", () => {
    expect(resolveThreadPaneAuxiliaryPanelPresentation({ width: 1200 }, true)).toBe("sheet");
    expect(resolveThreadPaneAuxiliaryPanelPresentation({ width: 719 }, false)).toBe("sheet");
  });

  it("keeps the split-pane inline threshold at 720px", () => {
    expect(resolveThreadPaneAuxiliaryPanelPresentation({ width: 720 }, false)).toBe("inline");
  });

  it("ignores ResizeObserver noise below the meaningful threshold", () => {
    expect(
      hasMeaningfulThreadSplitSizeChange(
        { width: 1200, height: 800 },
        { width: 1207, height: 793 },
      ),
    ).toBe(false);
    expect(
      hasMeaningfulThreadSplitSizeChange(
        { width: 1200, height: 800 },
        { width: 1208, height: 800 },
      ),
    ).toBe(true);
  });

  it("keeps active drawer owners ordered and retains only the newest hidden owners", () => {
    const owners = reconcileThreadSplitDrawerOwnerKeys(
      ["env:old", "env:a", "env:hidden-1", "env:hidden-2"],
      ["env:a", "env:b"],
      ["env:hidden-1", "env:hidden-2"],
      1,
    );

    expect(owners).toEqual(["env:a", "env:b", "env:hidden-2"]);
    expect(new Set(owners).size).toBe(owners.length);
  });

  it("keeps the terminal-key snapshot stable while terminal state is unchanged", () => {
    const terminalState = {
      "env:a": { terminalOpen: true },
      "env:b": { terminalOpen: false },
    };
    const first = selectOpenTerminalKeys(terminalState);

    expect(selectOpenTerminalKeys(terminalState)).toBe(first);
    expect(
      selectOpenTerminalKeys({
        ...terminalState,
        "env:b": { terminalOpen: true },
      }),
    ).toEqual(["env:a", "env:b"]);
  });

  it("gives every divider an accessible ordered-pane label", () => {
    expect(threadSplitSeparatorLabel(keys[0]!, keys[1]!)).toBe(
      "Resize panes between server:env:a and server:env:b",
    );
  });

  it("replaces every auto divider when switching to grid", () => {
    const targets = [
      "server:env:a",
      "server:env:b",
      "server:env:c",
      "server:env:d",
    ] as ThreadSplitTargetKey[];
    const auto = resolveThreadSplitLayout({
      targets,
      mode: "auto",
      width: 1600,
      height: 900,
    });
    const grid = resolveThreadSplitLayout({
      targets,
      mode: "grid",
      width: 1600,
      height: 900,
      gridColumns: 2,
      gridRows: 2,
    });
    const autoKeys = auto.dividers.map((divider) =>
      threadSplitDividerRenderKey(auto.mode, divider),
    );
    const gridKeys = grid.dividers.map((divider) =>
      threadSplitDividerRenderKey(grid.mode, divider),
    );

    expect(new Set(autoKeys).size).toBe(autoKeys.length);
    expect(gridKeys.every((key) => !autoKeys.includes(key))).toBe(true);
  });

  it("uses the dominant Shift-wheel axis for grid scrolling", () => {
    expect(resolveShiftGridScrollDelta(48, 12)).toBe(48);
    expect(resolveShiftGridScrollDelta(12, 48)).toBe(48);
    expect(resolveShiftGridScrollDelta(-36, 8)).toBe(-36);
  });

  it("reports the visible grid row range without snapping", () => {
    expect(
      resolveVisibleGridRowRange({ scrollTop: 301, paneHeight: 300, visibleRows: 3, totalRows: 4 }),
    ).toEqual({ start: 2, end: 4 });
  });
});
