import { createContext, useContext, type ReactNode } from "react";
import type { TerminalContextSelection } from "../../lib/terminalContext";
import type { ThreadNavigation } from "../../threadSplitNavigation";

export type ThreadPanePresentation = "standalone" | "pane" | "compact";
export type ThreadPaneAuxiliaryPanelPresentation = "auto" | "inline" | "sheet";

export interface PersistentTerminalPaneRuntime {
  readonly launchContext: {
    readonly cwd: string;
    readonly worktreePath: string | null;
  } | null;
  readonly focusRequestId: number;
  readonly onAddTerminalContext: (selection: TerminalContextSelection) => void;
}

export function cachePersistentTerminalPaneRuntime(
  current: Readonly<Record<string, PersistentTerminalPaneRuntime>>,
  threadKey: string,
  runtime: PersistentTerminalPaneRuntime,
): Readonly<Record<string, PersistentTerminalPaneRuntime>> {
  const previous = current[threadKey];
  if (
    previous?.launchContext === runtime.launchContext &&
    previous.focusRequestId === runtime.focusRequestId &&
    previous.onAddTerminalContext === runtime.onAddTerminalContext
  ) {
    return current;
  }
  return { ...current, [threadKey]: runtime };
}

export interface ThreadPaneRuntime {
  /**
   * Only the focused pane may consume document-level commands or acknowledge a
   * thread as visited.
   */
  readonly isFocused: boolean;
  readonly navigation: ThreadNavigation | null;
  readonly presentation: ThreadPanePresentation;
  /**
   * `auto` measures the ChatView's own container. Split hosts may force a
   * presentation when their layout already owns that decision.
   */
  readonly auxiliaryPanelPresentation: ThreadPaneAuxiliaryPanelPresentation;
  /**
   * Standalone ChatView retains legacy drawer ownership. A ThreadPaneHost sets
   * this false and renders the exported persistent drawer in its stable host.
   */
  readonly ownsPersistentTerminalDrawer: boolean;
  /**
   * A stable ThreadPaneHost publishes this callback. ChatView supplies its live
   * composer/focus/launch behavior without taking React ownership of the drawer.
   */
  readonly publishPersistentTerminalRuntime:
    | ((runtime: PersistentTerminalPaneRuntime) => void)
    | null;
}

export const standaloneThreadPaneRuntime: ThreadPaneRuntime = {
  isFocused: true,
  navigation: null,
  presentation: "standalone",
  auxiliaryPanelPresentation: "auto",
  ownsPersistentTerminalDrawer: true,
  publishPersistentTerminalRuntime: null,
};

export function shouldHandleThreadPaneGlobalActivity(runtime: ThreadPaneRuntime): boolean {
  return runtime.isFocused;
}

const ThreadPaneRuntimeContext = createContext<ThreadPaneRuntime>(standaloneThreadPaneRuntime);

export function ThreadPaneRuntimeProvider({
  value,
  children,
}: {
  readonly value: ThreadPaneRuntime;
  readonly children: ReactNode;
}) {
  return (
    <ThreadPaneRuntimeContext.Provider value={value}>{children}</ThreadPaneRuntimeContext.Provider>
  );
}

export function useThreadPaneRuntime(): ThreadPaneRuntime {
  return useContext(ThreadPaneRuntimeContext);
}
