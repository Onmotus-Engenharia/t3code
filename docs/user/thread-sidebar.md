# Organizing threads

Pin a thread from its context menu to keep it in the pinned section above your active work.
Pinned threads are shown independently of their project, including when you connect to more than
one environment.

Open the same action menu by clicking the visible chevron beside the active thread title or by
right-clicking its sidebar row. **Copy thread ID** is a top-level action in this menu.

Pinned threads still move to **Settled** when they become inactive. Pull-request state does not
settle a thread in the Orchestrator distribution.

## Recover interrupted threads

If T3 Code restarts while an eligible thread is working, it automatically sends **Continue.** to
resume that work. This is enabled by default for root threads and subtasks. It does not resume
deleted, archived, settled, or snoozed threads.

In **Settings** → **General**, you can turn off **Automatically continue interrupted threads**.
The first recovery starts immediately. If another restart interrupts the recovered work, T3 Code
waits for the configured retry cooldown before trying again; the default cooldown is 30 seconds.
You can also set the maximum number of consecutive automatic attempts, which defaults to 10.

When the maximum is reached, T3 Code stops automatic retries and leaves the interrupted-thread
warning in place so you can recover the thread manually.

When you un-settle a thread, it returns to the top of its active list. In a task tree, a re-entering
root moves its whole group, while a child or grandchild moves only among its siblings. Its timestamps
do not change, and ordinary activity on an already-active thread does not reorder it.

Right-click a pull request link in a thread and choose **Link to thread** to show that pull request
in the sidebar. Right-click the same link and choose **Unlink from thread** to remove it.

On web and desktop, drag a pinned thread to change its position. On mobile, open the thread's menu
and choose **Move up** or **Move down**. The order is stored by the server and appears on your
other connected devices.

If reordering is unavailable for one environment, update the T3 Code server running in that
environment. Older servers can still pin and unpin threads, but do not understand synced ordering;
their pinned threads keep the default newest-first order below the ones you have arranged.

## Environment artwork

Dev and Nightly environments can identify themselves with artwork at the top of the sidebar and in
the send button. Choose **Artwork**, **Version pill**, or **None** in Settings under environment
identification. Artwork is recolored to match each built-in theme. Custom themes use the **Version
pill** fallback because their colors are not controlled by T3 Code.

To generate a fresh title from the conversation, open a thread's context menu and choose
**Regenerate title**. While T3 Code is generating it, the action reads **Regenerating…** and cannot
be selected again. The option is hidden when the connected environment needs a server update.
