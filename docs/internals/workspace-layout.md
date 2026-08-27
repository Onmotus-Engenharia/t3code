# Workspace layout

> For maintainers. Using T3 Code? See [docs/user](../user/).

A pnpm workspace driven by [vite-plus](https://vite.plus) (`vp`). See [scripts.md](./scripts.md) for
the task commands.

## apps

- `apps/server` (`t3`): the execution runtime and the published CLI. Owns orchestration, provider
  drivers, checkpointing, VCS, terminals, filesystem access, auth, and the HTTP + WebSocket surface.
  Also serves the built web app.
- `apps/web` (`@t3tools/web`): React + Vite UI. Consumes the shared client runtime and adds routing,
  components, and web-specific platform layers.
- `apps/desktop` (`@t3tools/desktop`): Electron shell. Supervises a desktop-scoped `t3` backend,
  loads the Orchestrator web bundle over the `t3-code-orchestrator://` protocol, and owns
  SSH-managed remote environments.
- `apps/mobile` (`@t3tools/mobile`): Expo/React Native client. Same client runtime composition as
  web, different platform layer and UI.
- `apps/marketing` (`@t3tools/marketing`): Astro marketing site.

## packages

- `packages/contracts` (`@t3tools/contracts`): shared Effect Schema definitions. RPC group,
  orchestration commands/events/read model, auth scopes, environment descriptors, settings.
- `packages/shared` (`@t3tools/shared`): framework-agnostic utilities used by server and clients
  (`DrainableWorker`, git and source-control helpers, relay auth and signing, DPoP, semver, logging,
  observability, and more).
- `packages/client-runtime` (`@t3tools/client-runtime`): connection lifecycle, authorization, RPC
  session, environment registry, and Atom-based domain state shared by web and mobile. See its
  [README](../../packages/client-runtime/README.md).
- `packages/ssh` (`@t3tools/ssh`): SSH config parsing, auth prompts, command execution, and the
  tunnel/environment manager behind desktop-managed SSH environments.
- `packages/tailscale` (`@t3tools/tailscale`): Tailscale CLI wrapper, including the
  `ensureTailscaleServe` / `disableTailscaleServe` serve lifecycle the server drives.
- `packages/effect-acp` (`effect-acp`): Effect client and agent implementation of the Agent Client
  Protocol, used by ACP-speaking provider drivers.
- `packages/effect-codex-app-server` (`effect-codex-app-server`): Effect client for the
  `codex app-server` JSON-RPC protocol.

## infra

- `infra/relay` (`t3code-relay`): the hosted T3 Connect relay, deployed with Alchemy. Handles
  environment discovery, cloud-side records, and mobile notifications. It is not in the hot path;
  after connect, client traffic goes directly to the environment. See
  [t3-connect.md](./t3-connect.md).

## Other top-level directories

- `scripts/`: workspace tooling run through `vp run`. Dev runner, desktop artifact builds, release
  helpers, mobile static checks and showcase capture, update-manifest merging.
- `assets/`: upstream brand and app icon sources per channel (`dev`, `nightly`, `prod`) plus the
  isolated Orchestrator icon source in `assets/orchestrator/`. Desktop development and packaged
  builds resolve the Orchestrator asset, never an upstream app icon.
- `patches/`: pnpm patches for pinned upstream dependencies.
- `oxlint-plugin-t3code/`: repo-specific lint rules.
- `experiments/`: throwaway prototypes. Not part of the shipped build.
- `docs/`: this documentation tree.

## Import conventions

`@t3tools/shared` and `@t3tools/client-runtime` use explicit subpath exports with no barrel index and
no root export. Import the narrow path (`@t3tools/shared/DrainableWorker`,
`@t3tools/client-runtime/state/threads`) rather than the package root. Files that are not exported
are implementation details. `@t3tools/contracts` does export a root alongside `./settings` and
`./relay`.

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

See [Split views](../user/split-views.md) for user-facing behavior and recovery rules.
