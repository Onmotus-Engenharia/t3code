# Split Views

Split views let you arrange multiple threads in one workspace without combining them. They are
available in the desktop app and in web clients with a desktop-class workspace.

Each pane remains a complete, independent thread. It has its own timeline, composer, terminal
drawer, diff, files, plan, and preview. Splitting threads does not merge their context, change task
relationships, move worktrees or branches, or affect an agent or provider session.

## Create and Open Split Views

You can manage split views from several places:

- Drag one thread onto another, or drag a thread into an existing split view.
- Open the current thread's action menu and choose **Start split view...** to search for the second
  thread. A different sidebar thread can still start a split with the currently focused thread.
- Select 2–50 actionable thread rows and choose **Open in split view**.
- Use the command palette to start a split, split a task tree, add threads, remove the focused pane,
  close the split, change its layout, or focus the previous or next pane.
- Use a pane's remove control or the focused pane's split-view controls.

The **Split views** shelf near the top of the thread list shows every saved group. Its thread chips
focus individual panes, and its group menu changes the layout, adds threads or task descendants,
or closes the group. The original thread rows remain in their normal projects and task trees; a
split indicator shows which ones also belong to a group. New groups appear first; merely activating
a group does not reorder the shelf.

You can keep multiple split groups. Opening a thread that belongs to a group activates that group
and focuses its pane. Opening an ungrouped thread shows it by itself without deleting saved groups.
A thread can belong to only one split group, so adding it to another group moves that pane.

## Layout and Resizing

Each group supports four layouts:

- **Auto** chooses a balanced arrangement for the available workspace and keeps every pane
  visible. It does not reorder panes when focus changes.
- **Side by side** places panes in columns.
- **Top and bottom** places panes in rows.
- **Grid** uses a configurable number of columns and visible rows. New grid layouts start at
  3 × 3. The selector means columns × visible rows, so 12 threads at 3 × 3 occupy three columns
  and four total rows.

Side-by-side and top-and-bottom layouts have accessible dividers. Drag a divider to resize adjacent
panes. With the divider focused, use an arrow key for a 5% adjustment or Shift+Arrow for 10%.
Manual layouts keep panes at least 320 pixels wide or 240 pixels tall and scroll the group in the
chosen direction when they cannot all fit. Auto layout stays balanced and has no draggable
dividers.

When a grid has more rows than fit, it scrolls vertically. Its scrollbar is hidden and it does not
snap between rows: use Shift+scroll (including a trackpad gesture whose main movement is horizontal)
to move the outer grid. Regular scrolling remains in the thread beneath the pointer. The grid toolbar
shows the currently visible row range when there is overflow.

When the usable web workspace is narrower than 900×560, the group is preserved but only its
focused pane is mounted. A compact switcher above the pane moves between members. The full layout
returns automatically when space becomes available.

Native mobile clients remain single-pane. They can open the underlying threads, but they do not
show a split group as simultaneous panes.

## Composer in Split Panes

On web and desktop, a composer starts open. Use the bottom-left chevron to collapse or expand it.
When a split pane is short, its composer may collapse automatically; an explicit open or closed
choice wins over that automatic behavior. The compact composer keeps provider and runtime controls,
context information, send or stop actions, and the thread's branch or worktree controls available.
The editor and attachment or context detail stay hidden until the composer is expanded.

## Focus and Navigation

Click or focus inside a pane to make it active. Only the focused pane receives global thread
shortcuts and is marked visited. Focusing another visible pane updates the current location without
adding a browser-history entry.

Navigation inside a pane, such as opening its parent or creating an implementation thread, replaces
that pane. If the destination already belongs to a split group, T3 Code activates that group
instead. Settings and other non-thread pages hide active chats but leave split groups saved.

Opening a saved thread URL on the same client restores its owning split group. The same URL on a
different client opens the thread normally because split-view state does not sync between devices.

## Task-Tree Split Views

Choose **Split task tree** on a task root to create or open a task-bound group. The root appears
first, followed by up to 49 descendants. For a tree larger than 50 threads, T3 Code chooses the 49
most recently updated descendants and keeps their task-tree order.

If that root already has a task-bound group, the action opens it. If the root is in a normal split
group, that group becomes the task-bound group instead of creating a duplicate.

New descendants are added automatically while the group has room. A descendant created while the
group is full remains available to add manually; it is not silently substituted later. The shelf
or group menu shows how many descendants are available, and **Add descendants…** lets you choose
omitted threads.

Removing a descendant records an exclusion so it is not automatically re-added. Adding it manually
clears that exclusion. If the task root is deleted, a remaining group with at least two panes
continues as a normal split group.

Task-tree splitting is visual only. Removing a pane never changes its task relationship, running
turn, context, or siblings.

## Limits and Reverse Actions

A split group contains 2–50 panes. It can include server threads and drafts from different projects
or environments.

- **Remove from split** removes only that pane.
- Removing a pane from a two-pane group dissolves the group and leaves the other thread open by
  itself.
- **Close split view** dissolves the visual group and keeps its focused thread open by itself.
- Moving the second-to-last member to another group also dissolves the source group.

None of these actions archives, settles, deletes, interrupts, or closes an underlying thread.

## Local Persistence and Recovery

Split groups, pane order, focus, layout, and manual sizes are local visual state stored by the
client. They survive refreshes and desktop restarts on that client, but they do not sync to another
browser or device. There is no server capability, thread-context merge, or server data migration
for split views.

Disconnected environments keep their panes and use the normal unavailable-environment behavior.
Once catalogs finish loading, deleted threads, deleted drafts, and removed environments are pruned.
Draft promotion preserves the pane's position, focus, and size.

Malformed or obsolete local split-view data is repaired when possible and otherwise safely falls
back to no groups without blocking chat. If local persistence fails, the current in-memory split
session remains usable and the failure is logged once. Existing users begin with no split groups.
