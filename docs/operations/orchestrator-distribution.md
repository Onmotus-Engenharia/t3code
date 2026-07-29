# T3 Code Orchestrator distribution

This fork builds **T3 Code Orchestrator** as a separate desktop product. `distribution.json` is the
single source of truth for collision-prone identity. Keep changes there instead of scattering
custom names through upstream files.

## Identity and storage

| Resource                     | Orchestrator value                                   |
| ---------------------------- | ---------------------------------------------------- |
| Display/bundle name          | `T3 Code Orchestrator` / `T3 Code Orchestrator.app`  |
| Product slug and executable  | `t3-code-orchestrator`                               |
| macOS bundle ID              | `dev.mateuslucas.t3code.orchestrator`                |
| Windows app/user-model ID    | `dev.mateuslucas.t3code.orchestrator`                |
| URL protocols                | `t3-code-orchestrator`, `t3-code-orchestrator-dev`   |
| Default desktop backend port | `4773`, with the normal occupied-port fallback       |
| macOS Electron user data     | `~/Library/Application Support/t3-code-orchestrator` |
| Cross-platform T3 base/state | `~/.t3-code-orchestrator/userdata`                   |
| Cache                        | `~/.t3-code-orchestrator/cache`                      |
| Logs                         | `~/.t3-code-orchestrator/userdata/logs`              |

Windows Electron user data resolves below `%APPDATA%\\t3-code-orchestrator`; the T3 base defaults to
`%USERPROFILE%\\.t3-code-orchestrator`. Linux uses the same base under `$HOME`, plus its custom
desktop-entry and WM class.

Packaged builds honor only `T3CODE_ORCHESTRATOR_HOME` as a state-root override. They clear ambient
`T3CODE_HOME` before starting the bundled backend. The custom app does not probe or migrate official
T3 user-data paths. Electron session data, logs, single-instance identity, protocol registration,
installer/uninstaller identity, executable name, and backend bootstrap therefore remain separate.

There is no automatic import. Copying official state into these locations is unsupported; add a
reviewed import command later if migration becomes necessary.

## Icon

`assets/orchestrator/app-icon.icon` copies production geometry but changes only the icon fill to
indigo. The app theme and web assets remain upstream production styling. `vp run
icons:orchestrator` regenerates tracked custom macOS, universal/Linux, and Windows assets without
changing production files. Prefer a native Icon Composer export when Icon Composer 2 is available;
the deterministic generator is the documented fallback.

## Updater

Automatic update is disabled in `distribution.json` because no verified fork release feed is
configured. Builder publish metadata is omitted and the runtime reports the reason. The custom app
cannot consume official T3 binaries, while the official application's updater is unchanged.

Before enabling updates, publish signed artifacts and metadata from the fork, pin the fork owner and
repository in distribution metadata, test both channels on every supported platform, then add a
focused test proving that `pingdotgg/t3code` can never be selected.

## Build

Install dependencies, regenerate/check icons, then build a version with a custom suffix:

```sh
vp i
vp run icons:orchestrator
vp run dist:desktop:dmg:arm64 --build-version 0.0.30-orchestrator.1
vp run dist:desktop:dmg:x64 --build-version 0.0.30-orchestrator.1
vp run dist:desktop:win:x64 --build-version 0.0.30-orchestrator.1
vp run dist:desktop:win:arm64 --build-version 0.0.30-orchestrator.1
```

Run Windows packaging on the matching Windows or approved CI runner. Do not publish or start CI
from local validation. The same builder configuration supplies the custom executable, NSIS artifact,
application ID, shortcut, and uninstall/registry identity.

Before installing macOS output, mount or unpack it and verify:

```sh
defaults read "/path/T3 Code Orchestrator.app/Contents/Info" CFBundleIdentifier
defaults read "/path/T3 Code Orchestrator.app/Contents/Info" CFBundleDisplayName
```

The values must be `dev.mateuslucas.t3code.orchestrator` and `T3 Code Orchestrator`. Install only as
`/Applications/T3 Code Orchestrator.app`. Never replace or modify `/Applications/T3 Code.app` or
`/Applications/T3 Code (Alpha).app`.

Recent macOS versions can refuse a freshly installed unsigned Electron bundle even when it has no
quarantine attribute. Run launch acceptance with a valid Apple code-signing identity and the
builder's `--signed` flag. Do not automate removal of quarantine/provenance or weaken system
security as a packaging workaround.

## Upstream synchronization

Keep identity changes separate from upstream synchronization:

```sh
git fetch upstream
git switch main
git merge --ff-only upstream/main
```

If the fork intentionally diverged, rebase or merge on a temporary sync branch, resolve conflicts,
run focused identity/orchestration tests, and merge that sync change separately from feature work.
Never force-push shared branches. After upstream packaging changes, recheck `distribution.json`,
desktop path setup before `app.ready`, builder publish metadata, icon resolution, and updater policy.

## Troubleshooting

- Official settings appear in the custom app: inspect packaged bootstrap and confirm
  `T3CODE_HOME` is cleared and no legacy user-data probe was restored.
- Only one app launches: compare bundle/app IDs, protocol schemes, user-data paths, and
  single-instance identity before debugging processes.
- Port conflict: inspect the selected backend URL; the desktop pool probes from 4773 rather than
  assuming a fixed free port.
- Update UI is disabled: expected until a verified fork feed is configured.
- Black icon appears: run `vp run icons:orchestrator`, then confirm the builder resolved
  `assets/orchestrator`, not `assets/prod`.
- A local unsigned app exits before creating its data directories: inspect AMFI logs and rebuild
  with `--signed` using a valid Apple code-signing identity.
