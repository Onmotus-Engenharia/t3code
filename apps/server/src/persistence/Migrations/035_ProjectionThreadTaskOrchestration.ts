import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "task_orchestration_enabled")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN task_orchestration_enabled INTEGER NOT NULL DEFAULT 0
    `;
  }

  if (!columns.some((column) => column.name === "task_relation_json")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN task_relation_json TEXT
    `;
  }

  if (!columns.some((column) => column.name === "task_parent_thread_id")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN task_parent_thread_id TEXT
    `;
  }

  if (!columns.some((column) => column.name === "pinned")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0
    `;
  }

  yield* sql`
    CREATE INDEX IF NOT EXISTS idx_projection_threads_task_parent
    ON projection_threads(task_parent_thread_id, deleted_at, thread_id)
  `;
});
