# Brand icons

The Icon Composer projects are the source of truth for full application icons:

- `orchestrator/app-icon.icon`
- `dev/app-icon.icon`
- `nightly/app-icon.icon`
- `prod/app-icon.icon`

The orchestrator project is a distribution-specific copy of the production geometry with an
indigo fill. Keep the production project unchanged so the two installed applications remain
visually distinguishable.

When Icon Composer is unavailable, `vp run icons:orchestrator` deterministically regenerates the
tracked orchestrator macOS, universal/Linux, and Windows assets. It reads the indigo fill from
`orchestrator/app-icon.icon/icon.json` and uses the production raster files only as geometry,
alpha, and white-mark templates; all PNG renditions in the production ICO are retained. This
fallback keeps non-macOS packaging reproducible without mutating production assets.

For a native refresh, open `orchestrator/app-icon.icon` in Icon Composer. Export the macOS
pre-Tahoe 1024pt/1× rendition to `orchestrator/orchestrator-macos-1024.png`, export the shared
1024px rendition to `orchestrator/orchestrator-universal-1024.png`, and assemble Icon Composer's
16, 24, 32, 48, 64, 128, and 256px Windows PNG renditions into
`orchestrator/orchestrator-windows.ico`. Keep those exact paths because desktop packaging consumes
them directly. Do not run the fallback over those native exports unless deliberately returning to
the production geometry templates.

Each project uses `text.svg` for the T3 mark and `background.svg` when the background is a vector layer. Additional layers use semantic names that describe their role and placement.

Run `vp run icons:export` from the repository root to regenerate the tracked iOS, Linux, Windows, and web assets. The development web exports are also copied to `apps/web/public` for the browser favicon and splash screen. Run `vp run icons:check` to verify that the generated assets and public copies match their sources without changing files.

Exporting requires Icon Composer 2 or newer on macOS. The script selects the newest compatible exporter from Xcode or a standalone Icon Composer installation and pins design generation 26. Set `ICON_COMPOSER_TOOL` to the full path of `Icon Composer.app/Contents/Executables/ictool` to override automatic discovery.

## macOS exports

Icon Composer's command-line exporter does not expose the `macOS pre-Tahoe` preset. A plain command-line `macOS` export is full bleed and is not suitable for the desktop app, so the export script intentionally leaves the tracked macOS PNGs unchanged and prints a reminder after every run.

After changing an Icon Composer project, open it in Icon Composer and export the macOS PNG with exactly these settings:

- Platform: `macOS pre-Tahoe`
- Appearance: `Default`
- Size: `1024pt`
- Scale: `1×`

Save the three exports to:

- `dev/app-icon.icon` -> `dev/blueprint-macos-1024.png`
- `nightly/app-icon.icon` -> `nightly/nightly-macos-1024.png`
- `prod/app-icon.icon` -> `prod/black-macos-1024.png`

The result must be a 1024×1024 PNG with the classic macOS safe area: the opaque icon body is 824×824, inset 100 pixels on every side, with only the native Icon Composer shadow extending into the surrounding transparent canvas.

To have Codex perform the native exports, paste this prompt into a task opened at the repository root:

```text
Use [@Computer](plugin://computer-use@openai-bundled) and the Icon Composer app to export the three macOS app icons in this repository.

For each project below, use Platform: macOS pre-Tahoe, Appearance: Default, Size: 1024pt, and Scale: 1×, then save the PNG to the exact destination:

- assets/dev/app-icon.icon -> assets/dev/blueprint-macos-1024.png
- assets/nightly/app-icon.icon -> assets/nightly/nightly-macos-1024.png
- assets/prod/app-icon.icon -> assets/prod/black-macos-1024.png

Do not resize, composite, or otherwise post-process the exported PNGs.

Verify every result is 1024×1024 and has the classic macOS safe area: an 824×824 opaque body inset 100px on every side, with only Icon Composer's native shadow extending beyond it.
```

Do not edit the generated PNG or ICO files directly.
