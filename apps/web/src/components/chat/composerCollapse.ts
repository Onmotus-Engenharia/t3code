export const THREAD_PANE_COMPOSER_COLLAPSE_HEIGHT_PX = 440;

export type ComposerCollapseOverride = "expanded" | "collapsed";

export function shouldAutoCollapseComposer(
  paneHeight: number | null,
  hasThreadPane: boolean,
): boolean {
  return (
    hasThreadPane && paneHeight !== null && paneHeight < THREAD_PANE_COMPOSER_COLLAPSE_HEIGHT_PX
  );
}

export function resolveComposerCollapsed(options: {
  autoCollapsed: boolean;
  manualOverride: ComposerCollapseOverride | null;
}): boolean {
  if (options.manualOverride === "expanded") return false;
  if (options.manualOverride === "collapsed") return true;
  return options.autoCollapsed;
}

export function getCollapsedComposerContentSummary(options: {
  prompt: string;
  attachmentCount: number;
  contextCount: number;
}): string | null {
  const parts: string[] = [];
  if (options.prompt.trim().length > 0) parts.push("Draft");
  if (options.attachmentCount > 0) {
    parts.push(`${options.attachmentCount} attachment${options.attachmentCount === 1 ? "" : "s"}`);
  }
  if (options.contextCount > 0) {
    parts.push(`${options.contextCount} context${options.contextCount === 1 ? "" : "s"}`);
  }
  return parts.length > 0 ? parts.join(" · ") : null;
}
