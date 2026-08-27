# Provider usage

T3 Code shows Codex account usage when the connected environment reports current rate limits.

- On web and desktop, the 5-hour and weekly meters appear in the sidebar footer in default,
  legacy, and Settings navigation modes.
- On mobile, the same meters appear at the top of **Settings**.
- In an active Codex thread, the context information panel also shows the selected account's
  5-hour and weekly usage when those windows are available.
- Each meter shows the percentage used. Reset timing is available in the desktop tooltip and inline on mobile.

Usage belongs to the connected environment and Codex account running the provider. T3 Code hides the meters until it has received a real Codex rate-limit snapshot.

The context information panel also reports exact additions and deletions for the full thread diff.
On a task root, that net diff includes changes made by the root thread, child tasks, and grandchild
tasks, including tasks that ran in isolated worktrees.
