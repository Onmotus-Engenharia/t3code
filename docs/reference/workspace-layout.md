# Workspace layout

- `/apps/server`: Node.js WebSocket server. Wraps Codex app-server, serves the built web app, and opens the browser on start.
- `/apps/web`: React + Vite UI. Session control, conversation, and provider event rendering. Connects to the server via WebSocket.
- `/apps/desktop`: Electron shell. Spawns a desktop-scoped `t3` backend process and loads the shared web app.
- `/apps/mobile`: React Native client. Uses native single-pane navigation rather than simultaneous split-view panes.
- `/packages/contracts`: Shared effect/Schema schemas and TypeScript contracts for provider events, WebSocket protocol, and model/session types.
- `/packages/shared`: Shared runtime utilities consumed by both server and web. Uses explicit subpath exports (e.g. `@t3tools/shared/git`, `@t3tools/shared/DrainableWorker`) — no barrel index.

## Client thread layout

The desktop app and desktop-class web clients can visually compose 2–12 independent threads or
drafts into a split view. The group may cross projects and environments. Each pane remains a
complete chat surface with its own composer, timeline, terminal drawer, diff, files, plan, and
preview; the layout does not merge thread context or alter task relationships, provider sessions,
agent execution, worktrees, branches, or server state.

Split groups are local client state. Their membership, focus, order, layout, and manual sizes
survive refreshes and desktop restarts on the same client, but do not sync across devices. They do
not add orchestration contracts, server capabilities, or a data migration.

Groups use Auto, Side by side, or Top and bottom layouts. Auto balances all panes against the
available space. The two manual modes support resizing and directional overflow at minimum pane
dimensions. Below a 900×560 usable web workspace, only the focused pane is mounted and a compact
switcher provides access to the other members; the full arrangement returns when the workspace
grows. Native mobile always uses its existing single-pane thread view.

Inactive groups are retained but do not mount full chat surfaces. Only the focused pane receives
global shortcuts and visited-state updates. Original thread-tree rows remain the semantic home of
each thread, while a separate **Split views** shelf exposes visual groups. Task-bound groups derive
membership from durable task relationships, can automatically include genuinely new descendants
up to the 12-pane limit, and record manually removed descendants as exclusions.

See [Split Views](../user/split-views.md) for user-facing behavior and recovery rules.
