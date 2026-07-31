# Thread Split Views Implementation Plan

## Summary

Build client-local thread split views for the desktop app and desktop-class web clients. A split view visually composes 2–12 otherwise independent server or draft threads. It never changes thread context, task relationships, orchestration, provider behavior, or server state.

The implementation centers on a deep thread-split module responsible for groups, membership, focus, layout, persistence, task-tree binding, and navigation. `ChatView` remains the implementation of one complete thread pane.

Mobile receives no native split-view implementation. Narrow web windows preserve the group but display only its focused pane through a compact pane switcher.

## Locked Product Decisions

- Support desktop and sufficiently large web clients; do not gate on Electron.
- Persist groups locally across refreshes and desktop restarts.
- Allow cross-project and cross-environment groups.
- Permit multiple independent split groups.
- Enforce a maximum of 12 panes per group.
- Each thread may belong to at most one group.
- Every pane supports its own composer, timeline, terminal drawer, diff, files, plan, and preview.
- Show groups in a `Split views` shelf while retaining original semantic thread-tree rows.
- Support `Auto`, `Side by side`, and `Top and bottom` layouts.
- Manual resizing applies to side-by-side and top/bottom modes. Auto remains responsive and balanced.
- “Split task tree” creates a task-bound group and includes the root plus up to 11 most recently updated descendants.
- Task-bound groups auto-add genuinely new descendants only when capacity is available.
- Manual removal records an exclusion; the descendant is not automatically re-added.
- Removing a member must never affect its task relationship, running turn, context, or siblings.
- Only the focused pane is marked visited and receives global shortcuts.
- Inactive split groups are not fully mounted.

## 1. Thread-Split State Module

Create [threadSplitStore.ts](/Users/mateuslucas/Documents/GitHub/t3code/apps/web/src/threadSplitStore.ts) as the authoritative module.

### Persisted types

- `ThreadSplitTargetKey`
  - `server:<scoped-thread-key>`
  - `draft:<draft-id>`
- `ThreadSplitLayoutMode`
  - `auto`
  - `columns`
  - `rows`
- `ThreadSplitGroup`
  - Stable group ID.
  - Ordered target keys.
  - Focused target key.
  - Layout mode.
  - Normalized pane weights used by manual modes.
  - Optional task-tree binding.
- `ThreadSplitTaskTreeBinding`
  - Root scoped thread key.
  - All descendant keys previously observed.
  - Descendant keys explicitly removed by the user.
- `PersistedThreadSplitState`
  - Schema version.
  - Stable group order.
  - Group records.
  - Active group ID.

Use a dedicated versioned localStorage key such as `t3code:thread-splits:v1`. Do not add split data to server-backed client settings or orchestration contracts.

### Store interface

Expose a small set of high-level actions:

- `openTargets`: create a group, add/move targets to a group, or replace the focused pane.
- `focusTarget`: activate the owning group and focus one member.
- `removeTarget`: remove one member and record a task-tree exclusion where applicable.
- `configureGroup`: set layout mode, pane order, or manual weights.
- `closeGroup`: dissolve the visual group without touching threads.
- `promoteDraftTarget`: atomically replace a draft key with its canonical server key.
- `reconcile`: validate persisted groups against the current environment/thread/draft catalog and discover new descendants.

### Invariants

Enforce inside the store rather than in callers:

- Groups contain 2–12 unique targets.
- A target belongs to at most one group.
- Moving a target removes it from its previous group.
- Groups falling below two members dissolve automatically.
- Focus always references a current member.
- Weights are finite, positive, ordered with their panes, and normalized.
- Adding a pane assigns it the average current weight; removing one renormalizes survivors.
- Invalid persisted records, duplicate membership, and malformed weights are repaired during hydration.
- Deleted threads and missing drafts are removed only after their owning environment/draft store has completed hydration.
- Temporarily disconnected or unbootstrapped remote environments do not lose persisted membership.
- Archived, snoozed, settled, and remote threads remain valid members.

## 2. Task-Tree Binding

Derive descendants from durable `taskRelation.rootThreadId`, not sidebar nesting preferences.

### Initial creation

When “Split task tree” is invoked:

1. If a task-bound group already exists for the root, activate it.
2. If the root belongs to a manual group, convert that group into the task-bound group.
3. Otherwise create a new group.
4. Keep the root first.
5. If there are at most 11 descendants, include all in sidebar tree order.
6. If there are more, select the 11 most recently updated descendants, then order the selected members by tree order.
7. Record every currently existing descendant as already observed, including those omitted by the limit.
8. Show a non-blocking notice when only 12 of a larger tree were opened.

### Later descendants

During reconciliation:

- Compare current descendants against `observedDescendantKeys`.
- Mark every newly discovered descendant as observed.
- Auto-add it only when:
  - It is not excluded.
  - It does not belong to another split group.
  - The group currently has fewer than 12 members.
- If the group is full, retain it as an available descendant but do not later auto-fill a slot merely because another pane was manually removed.
- Show an available-descendant count in the split shelf/menu.
- Provide “Add descendants…” to manually select omitted or excluded descendants; manually adding one clears its exclusion.
- If the root is deleted, remove the binding while preserving the remaining group as a normal manual group when it still has at least two panes.

## 3. Navigation and Focus Seam

Create [threadSplitNavigation.tsx](/Users/mateuslucas/Documents/GitHub/t3code/apps/web/src/threadSplitNavigation.tsx).

Define one thread-navigation interface consumed by sidebars, `ChatView`, new-thread creation, command palette, and route promotion:

- Read the currently focused thread/draft target.
- Open a target with a history policy.
- Open a target with a disposition:
  - Activate its existing group.
  - Replace the focused pane.
  - Open standalone outside groups.

Provide two real adapters:

- Standalone router navigation.
- Active split-group navigation.

### Navigation rules

- Clicking a group member in either the shelf or original tree activates its group and focuses it.
- Clicking an ungrouped thread opens it standalone and leaves saved groups intact.
- Focusing a visible pane updates the URL with `replace`, preventing focus clicks from flooding browser history.
- Activating a group or opening a new thread from the sidebar uses normal pushed navigation.
- Internal navigation from a pane—parent thread, draft creation, or implementation thread—replaces that pane unless the target already belongs to a group.
- Navigating to a target in another group activates that group instead of stealing the target.
- A direct URL locally restores the owning persisted group when one exists. The same URL on another client opens as a normal standalone thread.
- Settings and non-thread routes unmount active chats but preserve split state.
- Draft promotion replaces the draft key in its group before canonical route navigation.

Update route-derived active-thread consumers to use the focused split target:

- `useHandleNewThread`
- Both sidebars
- Command palette
- Chat route global shortcuts
- Active-thread toast logic
- Terminal/preview shortcut context

## 4. Route and Pane Composition

Create [ThreadSplitView.tsx](/Users/mateuslucas/Documents/GitHub/t3code/apps/web/src/components/thread-split/ThreadSplitView.tsx).

Update both thread routes to delegate rendering to it:

- [\_chat.$environmentId.$threadId.tsx](/Users/mateuslucas/Documents/GitHub/t3code/apps/web/src/routes/_chat.$environmentId.$threadId.tsx)
- [\_chat.draft.$draftId.tsx](/Users/mateuslucas/Documents/GitHub/t3code/apps/web/src/routes/_chat.draft.$draftId.tsx)

The route remains authoritative for the initially focused target. `ThreadSplitView` resolves whether to render:

- One standalone pane.
- The target’s complete split group.
- The compact focused-only presentation.

### Pane behavior

Each `ThreadPaneHost`:

- Uses a stable target key.
- Has an isolated positioning and stacking context.
- Focuses on `pointerdown` or any descendant focus event.
- Shows a clear, non-animated focused border.
- Independently scrolls its timeline.
- Exposes a remove-from-split button in its header.
- Supplies title-bar inset only to the top-left pane.
- Keeps right-panel maximize behavior contained to the pane.

Add a pane runtime context consumed by `ChatView` with:

- `isFocused`
- Target-aware navigation adapter.
- Compact/standalone presentation mode.
- Auxiliary-panel presentation.
- Terminal focus/visibility coordination.

The context defaults to standalone behavior so existing isolated `ChatView` tests and usages remain valid.

## 5. ChatView Refactor and Resource Ownership

Update [ChatView.tsx](/Users/mateuslucas/Documents/GitHub/t3code/apps/web/src/components/ChatView.tsx) so multiple instances can coexist safely.

### Required changes

- Gate its window-level keyboard handler on `isFocused`.
- Mark a server thread visited only while its pane is focused.
- Route thread-target navigation through the new navigation interface.
- Keep settings navigation as ordinary router navigation.
- Replace the global viewport-based right-panel decision with pane-aware presentation:
  - Inline when pane width is at least 720px.
  - Sheet/overlay below 720px.
- Keep terminal, diff, preview, plan, files, composer, approvals, and user-input state scoped to the pane’s target.
- Ensure preview and terminal focus detection checks the focused pane.
- Ensure right-panel maximization fills only the owning pane.

### Shared diff workers

Move `DiffWorkerPoolProvider` out of each `ChatView` and mount it once around the chat route/split host. Twelve panes must not create twelve worker pools.

### Persistent terminal ownership

Extract `PersistentThreadTerminalDrawer` from `ChatView`.

Render stable `ThreadPaneHost` records for:

- Every active group member.
- Up to the existing hidden-terminal retention limit for inactive threads with open drawers.

Active hosts render `ChatView` plus their drawer. Retained inactive hosts render only the hidden drawer. Because all hosts remain in one keyed list, each retained xterm drawer has exactly one React owner and does not duplicate or remount merely when focus changes or groups switch.

Keep right-panel terminal surfaces inside their respective `ChatView`; the existing terminal-session filtering continues to prevent a session from appearing in both the drawer and panel.

## 6. Layout Module

Create [threadSplitLayout.ts](/Users/mateuslucas/Documents/GitHub/t3code/apps/web/src/threadSplitLayout.ts) as a pure module.

Its interface accepts:

- Ordered target keys.
- Layout mode.
- Container width and height.
- Manual weights.

It returns pane bands/placements and divider descriptions.

### Auto layout

Use `ResizeObserver` on the split container. Evaluate horizontal-band and vertical-band candidates while preserving pane order.

For each candidate:

- Distribute panes across bands with counts differing by at most one.
- Put the less populated band first, producing:
  - 3 panes: one spanning pane plus two panes.
  - 4 panes: four quadrants.
  - 5 panes: 2+3 or its rotated equivalent.
- Score candidates by the smallest normalized pane dimensions, using 480×360 as the preferred compact pane size.
- Break ties according to the container’s dominant axis.
- Never reorder on focus changes.
- Recompute only after meaningful size changes; do not animate continuous layout changes.
- Auto always fits every pane in the available split container.

### Manual modes

- Columns render one horizontal strip.
- Rows render one vertical stack.
- Use minimum dimensions of 320px width and 240px height.
- Overflow the group container when the selected manual direction cannot fit all panes without crossing those minimums.
- Render accessible separators.
- Apply pointer resizing through `requestAnimationFrame`.
- Persist weights only on pointer release.
- Arrow keys adjust adjacent panes by 5%; Shift+Arrow adjusts by 10%.
- Auto mode has no draggable separators.

### Responsive fallback

When the actual workspace area is below 900×560:

- Preserve the group and layout state.
- Mount only the focused chat pane.
- Show a compact member switcher above the pane.
- Keep split creation/removal available through menus.
- Restore the full arrangement automatically when space returns.

Do not change `apps/mobile`; native mobile continues to render one thread.

## 7. Sidebar Shelf and Drag-and-Drop

Create [ThreadSplitShelf.tsx](/Users/mateuslucas/Documents/GitHub/t3code/apps/web/src/components/thread-split/ThreadSplitShelf.tsx) and shared drag coordination used by both sidebar versions.

### Split shelf

Render a `Split views` shelf near the top of the thread-list content.

Each group card contains:

- Active/focused styling.
- Layout icon and pane count.
- A two-column grid of compact thread chips.
- At two members, two equal chips matching the Arc-style capsule.
- Thread status/icon and truncated title on each chip.
- Focus action on chip click.
- Remove action per chip.
- Group menu for layout, closing, and adding descendants/threads.
- Badge for available task descendants not currently included.

Original tree rows remain present. Members receive a small split indicator. Clicking such a row activates and focuses its group.

New groups are prepended to stable persisted group order; activation does not reorder the shelf.

### Drag behavior

Reuse the installed `@dnd-kit` packages.

- Make the non-interactive area of thread rows draggable in Sidebar V1 and V2.
- Use a small movement activation threshold to preserve ordinary clicks, multi-select, renaming, snooze controls, and project dragging.
- Highlight valid thread/group drop targets and show a thread-title overlay.
- Dropping ungrouped A onto ungrouped B creates `[B, A]`.
- Dropping onto a grouped member adds after that member.
- Dropping a grouped member into another group moves only that member.
- Dropping within the same group reorders it.
- Moving the second-to-last member dissolves the source group.
- Reject a drop that would exceed 12 panes and show a concise toast.
- Do not merge whole groups by dragging the group card; users move individual chips.
- Preserve the existing Sidebar V1 project-order drag context and verify it does not intercept thread drags.

Accessible context-menu and command-palette alternatives are required; drag is not the only entry point.

## 8. User Entry Points and Undo

Update both sidebar context-menu implementations.

### Single-thread menu

Depending on state, offer:

- `Open in current split view`
- `Start split view with current thread`
- `Focus in split view`
- `Remove from split view`
- `Split task tree`
- `Open task split view`

### Multi-select menu

Add `Open in split view (N)`:

- Create a new group from the selected targets.
- Disable when fewer than two or more than twelve actionable rows are selected.
- Preserve selected order as rendered.

### Pane and group controls

- Each pane has `Remove from split`.
- The focused pane’s top bar exposes layout selection and `Close split view`.
- Closing a group keeps its focused thread open standalone.
- Removing from a two-pane group dissolves the group and leaves the surviving pane open standalone.
- No split action archives, settles, deletes, interrupts, or closes the underlying thread.

### Command palette

Add contextual actions:

- Split task tree.
- Add threads to current split view.
- Remove focused pane.
- Close split view.
- Use Auto layout.
- Arrange side by side.
- Arrange top and bottom.
- Focus previous/next split pane.

## 9. Keybindings and Public Contract Changes

Extend [keybindings.ts](/Users/mateuslucas/Documents/GitHub/t3code/packages/contracts/src/keybindings.ts) with:

- `splitView.focusPrevious`
- `splitView.focusNext`
- `splitView.removeFocusedPane`
- `splitView.closeGroup`
- `splitView.toggleTaskTree`
- `splitView.layoutAuto`
- `splitView.layoutColumns`
- `splitView.layoutRows`

Add the `splitViewActive` when-clause context.

Export the configurable static command list so Settings can offer commands that do not have defaults.

Default bindings:

- `mod+alt+[` → previous split pane, when `splitViewActive`
- `mod+alt+]` → next split pane, when `splitViewActive`

Leave destructive/removal/layout commands unassigned by default but available in Settings.

Update shared defaults, server keybinding decoding/persistence tests, web command resolution, labels, and keybinding documentation. Older remote servers may omit the new defaults; all UI interactions must continue to work without them.

No orchestration messages, events, receipts, database schema, or provider interfaces change.

## 10. Reconciliation and Failure Behavior

- Corrupt local state falls back to repaired groups or an empty store without blocking chat.
- Failed persistence logs once and keeps the in-memory session usable.
- An environment disconnect leaves its panes rendered with existing unavailable-environment behavior.
- Removing an environment prunes its targets after environment-catalog hydration.
- Deleting a thread removes it from every relevant view and dissolves undersized groups.
- Draft deletion removes its pane.
- Draft promotion preserves group position, focus, and manual weight.
- A task descendant created while its group is full becomes available but is not silently substituted for another member.
- Adding a thread already in another group moves it rather than duplicating it.
- Split focus never changes agent execution, context, worktree, branch, or provider session.

## 11. Tests

### Pure store tests

Add `threadSplitStore.test.ts` covering:

- Create, add, move, reorder, remove, close, and dissolve.
- Cross-project/environment membership.
- Multiple groups and unique target ownership.
- Twelve-pane enforcement.
- Focus repair and weight normalization.
- Persistence hydration and corrupt-state repair.
- Disconnected versus bootstrapped-missing threads.
- Deleted threads and missing drafts.
- Draft promotion.
- Task-tree initial selection with recent-11 behavior.
- Observed descendants, automatic additions, exclusions, manual re-addition, full-group behavior, and deleted roots.

### Layout tests

Add `threadSplitLayout.test.ts` covering:

- Landscape and portrait selection.
- Exact 2-, 3-, 4-, and 5-pane arrangements.
- Every count through 12.
- Stable order and deterministic tie-breaking.
- No overlap or missing panes.
- Manual weight normalization and divider clamping.
- Minimum dimensions and overflow behavior.

### Navigation and component tests

Cover:

- Route target restoring its group.
- Sidebar activation using pushed navigation.
- Pane focus using replacement navigation.
- Internal navigation replacing only the focused pane.
- Navigation to another group activating it.
- Only the focused pane handling shortcuts and visited state.
- Inactive groups not mounting full chats.
- Narrow mode mounting only the focused chat.
- One diff worker pool.
- Exactly one terminal drawer owner per retained thread.
- Independent terminal/right-panel/composer state.
- V1 and V2 shelf/context-menu/drop behavior.
- Existing project dragging and thread multi-selection remaining intact.
- Accessible separator and pane-control labels.

### Targeted verification

Run only focused checks:

- `vp test run` with the touched web, contracts, shared, and server test files.
- `vp run --filter @t3tools/contracts typecheck`
- `vp run --filter @t3tools/shared typecheck`
- `vp run --filter t3 typecheck`
- `vp run --filter @t3tools/web typecheck`
- Targeted lint on changed files.

After implementation and explicit browser/computer-use permission, run one integrated `test-t3-app` pass. Verify drag creation, all layouts, resizing, independent pane actions, task-tree auto-add/removal, multiple persisted groups, narrow fallback, and restart restoration. A desktop pass must also open simultaneous preview and terminal surfaces in different panes.

## 12. Documentation and Rollout

Add:

- `docs/user/split-views.md`
- Split-view commands and `splitViewActive` to `docs/user/keybindings.md`
- A “Thread split view” definition to `docs/reference/encyclopedia.md`
- Client-layout behavior to `docs/reference/workspace-layout.md`

Document explicitly that split views:

- Are local visual state.
- Do not sync between devices.
- Do not merge thread context.
- Work in desktop and desktop-class web layouts.
- Collapse to a focused-pane switcher on narrow web layouts.
- Are not implemented as simultaneous panes in the native mobile app.

Ship without a server capability or data migration. Existing users begin with no split groups, and malformed or obsolete local state safely decodes to an empty state.
