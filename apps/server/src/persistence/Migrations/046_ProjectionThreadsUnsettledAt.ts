import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

/**
 * The fork owns migration 043, so unsettled_at is deliberately appended as
 * migration 046. It remains additive for databases that reached either the
 * fork ledger or upstream's 041/042 collision before migration 045 repaired
 * the thread projection.
 */
export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;
  const columns = yield* sql<{ readonly name: string }>`
    PRAGMA table_info(projection_threads)
  `;

  if (!columns.some((column) => column.name === "unsettled_at")) {
    yield* sql`
      ALTER TABLE projection_threads
      ADD COLUMN unsettled_at TEXT
    `;
  }
});
