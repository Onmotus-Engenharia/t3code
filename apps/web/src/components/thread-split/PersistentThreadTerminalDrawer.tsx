/**
 * Stable pane-host integration seam. Universal terminal state is derived by
 * the drawer; ChatView-specific launch, focus, and composer behavior arrives
 * through PersistentTerminalPaneRuntime.
 */
export {
  PersistentThreadTerminalDrawer,
  type PersistentThreadTerminalDrawerProps,
  type PersistentTerminalLaunchContext,
} from "../ChatView";
