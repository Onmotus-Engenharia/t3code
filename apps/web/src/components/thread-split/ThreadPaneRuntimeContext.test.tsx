import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vite-plus/test";
import type { DraftId } from "../../composerDraftStore";
import {
  cachePersistentTerminalPaneRuntime,
  standaloneThreadPaneRuntime,
  shouldHandleThreadPaneGlobalActivity,
  ThreadPaneRuntimeProvider,
  useThreadPaneRuntime,
  type ThreadPaneRuntime,
} from "./ThreadPaneRuntimeContext";

function RuntimeProbe() {
  const runtime = useThreadPaneRuntime();
  return (
    <output
      data-focused={runtime.isFocused}
      data-presentation={runtime.presentation}
      data-auxiliary={runtime.auxiliaryPanelPresentation}
      data-drawer-owner={runtime.ownsPersistentTerminalDrawer}
    />
  );
}

describe("ThreadPaneRuntimeContext", () => {
  it("keeps isolated ChatView consumers standalone and focused by default", () => {
    const markup = renderToStaticMarkup(<RuntimeProbe />);

    expect(markup).toContain('data-focused="true"');
    expect(markup).toContain('data-presentation="standalone"');
    expect(markup).toContain('data-auxiliary="auto"');
    expect(markup).toContain('data-drawer-owner="true"');
    expect(standaloneThreadPaneRuntime.navigation).toBeNull();
    expect(shouldHandleThreadPaneGlobalActivity(standaloneThreadPaneRuntime)).toBe(true);
  });

  it("exposes focused-pane navigation and host resource ownership", async () => {
    const openTarget = vi.fn();
    const runtime: ThreadPaneRuntime = {
      isFocused: false,
      navigation: {
        getFocusedTarget: () => null,
        openTarget,
        promoteDraft: vi.fn(),
      },
      presentation: "pane",
      auxiliaryPanelPresentation: "sheet",
      ownsPersistentTerminalDrawer: false,
      publishPersistentTerminalRuntime: null,
    };

    const markup = renderToStaticMarkup(
      <ThreadPaneRuntimeProvider value={runtime}>
        <RuntimeProbe />
      </ThreadPaneRuntimeProvider>,
    );
    await runtime.navigation?.openTarget(
      { kind: "draft", draftId: "draft-2" as DraftId },
      { history: "replace" },
    );

    expect(markup).toContain('data-focused="false"');
    expect(markup).toContain('data-presentation="pane"');
    expect(markup).toContain('data-auxiliary="sheet"');
    expect(markup).toContain('data-drawer-owner="false"');
    expect(shouldHandleThreadPaneGlobalActivity(runtime)).toBe(false);
    expect(openTarget).toHaveBeenCalledWith(
      { kind: "draft", draftId: "draft-2" },
      { history: "replace" },
    );
  });

  it("retains the real target-scoped drawer callbacks under one stable key", () => {
    const onAddTerminalContext = vi.fn();
    const terminalRuntime = {
      launchContext: { cwd: "/workspace", worktreePath: "/workspace/tree" },
      focusRequestId: 7,
      onAddTerminalContext,
    };
    const cached = cachePersistentTerminalPaneRuntime({}, "env:thread", terminalRuntime);
    const unchanged = cachePersistentTerminalPaneRuntime(cached, "env:thread", terminalRuntime);
    const selection = {
      terminalId: "terminal-1",
      terminalLabel: "Terminal 1",
      lineStart: 2,
      lineEnd: 4,
      text: "real output",
    };

    cached["env:thread"]?.onAddTerminalContext(selection);

    expect(Object.keys(cached)).toEqual(["env:thread"]);
    expect(unchanged).toBe(cached);
    expect(cached["env:thread"]?.launchContext).toEqual(terminalRuntime.launchContext);
    expect(cached["env:thread"]?.focusRequestId).toBe(7);
    expect(onAddTerminalContext).toHaveBeenCalledWith(selection);
  });
});
