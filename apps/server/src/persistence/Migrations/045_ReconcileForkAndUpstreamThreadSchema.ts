import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The fork used ids 35, 41, and 42 before upstream assigned 41 and 42 to
 * different migrations. Do not rewrite the migration ledger: a database may
 * legitimately have either history. Instead, repair the additive thread
 * schema after both histories and promote the legacy pin projection once.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;
  const hasColumn = (name: string) => columns.some((column) => column.name === name);

  if (!hasColumn("task_orchestration_enabled")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN task_orchestration_enabled INTEGER NOT NULL DEFAULT 0
    `;
  }
  if (!hasColumn("task_relation_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN task_relation_json TEXT
    `;
  }
  if (!hasColumn("task_parent_thread_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN task_parent_thread_id TEXT
    `;
  }
  if (!hasColumn("title_regeneration_request_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_regeneration_request_id TEXT
    `;
  }
  if (!hasColumn("title_regeneration_started_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN title_regeneration_started_at TEXT
    `;
  }
  if (!hasColumn("pinned_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pinned_at TEXT
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_task_parent
    ON projection_threads(task_parent_thread_id, deleted_at, thread_id)
  `;

  // `pinned` is an intentionally retained compatibility column. A canonical
  // pin always wins, and the migration never changes its timestamp.
  if (hasColumn("pinned")) {
    yield* sql`
      UPDATE projection_threads
      SET pinned_at = COALESCE(pinned_at, updated_at, created_at)
      WHERE pinned = 1 AND pinned_at IS NULL
    `;
  }
});
