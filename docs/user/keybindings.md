# Keybindings

Edit keybindings from **Settings** → **Keybindings**. That page lists every command, its current
shortcut, whether it is a default or your own, and warns about conflicts.

The same configuration lives in `~/.t3/userdata/keybindings.json` on the machine running the
server, if you prefer editing it directly. T3 Code writes the built-in defaults into that file on
first run, and adds any new defaults on later startups unless a rule of yours already claims the
command or the shortcut.

The file is a JSON array of rules.

```json
[
  { "key": "mod+g", "command": "terminal.toggle" },
  { "key": "mod+shift+g", "command": "terminal.new", "when": "terminalFocus" }
]
```

Invalid rules are ignored. An invalid file is ignored entirely, and the server logs a warning.

## Defaults

```json
[
  { "key": "mod+j", "command": "terminal.toggle" },
  { "key": "mod+d", "command": "terminal.split", "when": "terminalFocus" },
  { "key": "mod+n", "command": "terminal.new", "when": "terminalFocus" },
  { "key": "mod+w", "command": "terminal.close", "when": "terminalFocus" },
  { "key": "mod+shift+j", "command": "preview.toggle" },
  { "key": "mod+r", "command": "preview.refresh", "when": "previewFocus" },
  { "key": "mod+l", "command": "preview.focusUrl", "when": "previewFocus" },
  { "key": "mod+=", "command": "preview.zoomIn", "when": "previewFocus" },
  { "key": "mod+-", "command": "preview.zoomOut", "when": "previewFocus" },
  { "key": "mod+0", "command": "preview.resetZoom", "when": "previewFocus" },
  { "key": "mod+k", "command": "commandPalette.toggle", "when": "!terminalFocus" },
  { "key": "mod+n", "command": "chat.new", "when": "!terminalFocus" },
  { "key": "mod+shift+o", "command": "chat.new", "when": "!terminalFocus" },
  { "key": "mod+shift+n", "command": "chat.newLocal", "when": "!terminalFocus" },
  { "key": "mod+o", "command": "editor.openFavorite" },
  { "key": "mod+alt+[", "command": "splitView.focusPrevious", "when": "splitViewActive" },
  { "key": "mod+alt+]", "command": "splitView.focusNext", "when": "splitViewActive" }
]
```

For most up to date defaults, see [`DEFAULT_KEYBINDINGS` in `apps/server/src/keybindings.ts`](../../apps/server/src/keybindings.ts)

## Rule Shape

Each entry supports:

- `key` (required): shortcut string, like `mod+j`, `ctrl+k`, `cmd+shift+d`
- `command` (required): the command ID to run
- `when` (optional): boolean expression controlling when the shortcut is active

## Key Syntax

Modifiers: `mod` (`cmd` on macOS, `ctrl` elsewhere), `cmd` / `meta`, `ctrl` / `control`, `shift`,
`alt` / `option`.

Examples: `mod+j`, `mod+shift+d`, `ctrl+l`, `cmd+k`.

## Commands

- `terminal.toggle`: open/close terminal drawer
- `terminal.split`: split terminal (in focused terminal context by default)
- `terminal.new`: create new terminal (in focused terminal context by default)
- `terminal.close`: close/kill the focused terminal (in focused terminal context by default)
- `preview.toggle`: open/close the in-app browser preview panel (desktop app only)
- `preview.refresh`: reload the active preview tab (in focused preview context by default)
- `preview.focusUrl`: focus the URL input of the preview panel (in focused preview context by default)
- `preview.zoomIn`: zoom the preview viewport in one step (in focused preview context by default)
- `preview.zoomOut`: zoom the preview viewport out one step (in focused preview context by default)
- `preview.resetZoom`: reset the preview zoom to 100% (in focused preview context by default)
- `commandPalette.toggle`: open or close the global command palette
- `chat.new`: create a new chat thread preserving the active thread's branch/worktree state
- `chat.newLocal`: create a new chat thread for the active project in a new environment (local/worktree determined by app settings (default `local`))
- `editor.openFavorite`: open current project/worktree in the last-used editor
- `splitView.focusPrevious`: focus the previous pane in the active split view
- `splitView.focusNext`: focus the next pane in the active split view
- `splitView.removeFocusedPane`: remove the focused pane from its split view
- `splitView.closeGroup`: close the active split view without closing its threads
- `splitView.toggleTaskTree`: open or close the focused thread's task-tree split view
- `splitView.layoutAuto`: use automatic layout for the active split view
- `splitView.layoutColumns`: arrange the active split view side by side
- `splitView.layoutRows`: arrange the active split view top and bottom
- `script.{id}.run`: run a project script by id (for example `script.test.run`)

Only `splitView.focusPrevious` and `splitView.focusNext` have default shortcuts. The other
split-view commands are available to assign in Settings. They remain listed when connected to an
older remote server that does not include split-view defaults.

Commands are IDs like `terminal.toggle`, `commandPalette.toggle`, `preview.refresh`, and
`chat.new`. Project scripts are addressable as `script.{id}.run`, for example `script.test.run`.

`filePicker.toggle` opens file search for the active project and defaults to `mod+p`.
`projectSearch.toggle` searches inside the active project's files and defaults to `mod+shift+f`.
Repeating either shortcut closes that search, and switching shortcuts replaces the open search.
`themeEditor.toggle` opens or closes the floating theme editor and defaults to
`mod+alt+shift+t`. Select a color label to spotlight the elements that use it; select the label
again to clear the spotlight. The swatch and hex field keep that color selected while you edit it.
Use **Inspect** to pick an element in the app and reveal its color token. Inspect disarms after one
successful pick; its hover glow and badge preview the element and token that click will select.
**Cancel** or `Escape` exits Inspect and clears its selection and spotlight.

The command palette searches active thread titles, projects, branches, user messages, and final
agent responses across connected environments. Message matches show one labeled excerpt while
keeping the thread's project, branch, and machine context visible. Message search begins after two
characters and uses SQLite's ASCII case-insensitive matching.

The full command list and the current defaults are shown in **Settings** → **Keybindings**, which
always matches the build you are running. Use that rather than a copied list.

Note that `chat.new` and `chat.newLocal` both create a thread through the same path. A new thread
inherits the project you were in, along with model and mode selections. Branch, worktree, and
environment mode always come from your configured defaults, not from the thread you were looking
at. To keep a worktree, use the explicit "new thread in this worktree" action in the branch
toolbar. The only difference between the two commands: with the current sidebar and more than one
project, `chat.new` opens a project chooser first.

## `when` Conditions

A `when` expression is evaluated against context keys describing the current UI state. The keys
the app supplies today are `terminalFocus`, `terminalOpen`, `previewFocus`, `previewOpen`, and
`modelPickerOpen`. This fork also supplies `splitViewActive` when the focused thread belongs to a
split view. The set is open and grows over time, so treat that as the current list rather than a
fixed one. Any key the running app does not supply evaluates to `false`.

Operators: `!` (not), `&&` (and), `||` (or), and parentheses.

Examples:

- `"when": "terminalFocus"`
- `"when": "terminalOpen && !terminalFocus"`
- `"when": "!terminalFocus"`

## Precedence

- Rules are evaluated in array order.
- For a key event, the last rule where both `key` matches and `when` evaluates to `true` wins.
- Precedence is across commands, not only within the same command. A later rule for a different
  command can take a key away from an earlier one.
