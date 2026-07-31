import { describe, expect, it } from "vite-plus/test";

import type { ThreadSplitGroup, ThreadSplitTargetKey } from "../../threadSplitStore";
import {
  hasMeaningfulThreadSplitSizeChange,
  reconcileThreadSplitDrawerOwnerKeys,
  resolveThreadSplitRenderTargets,
  selectOpenTerminalKeys,
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
});
