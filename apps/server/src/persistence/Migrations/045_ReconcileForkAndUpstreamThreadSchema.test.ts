import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("045_ReconcileForkAndUpstreamThreadSchema", (it) => {
  it.effect("upgrades an upstream 042 ledger with task and title repairs", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 40 });
      yield* sql`
        INSERT INTO effect_sql_migrations (migration_id, name)
        VALUES
          (41, 'AuthSessionClientConnection'),
          (42, 'ProjectionThreadLinkedPullRequest')
      `;

      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      const names = new Set(columns.map((column) => column.name));
      assert.ok(names.has("task_orchestration_enabled"));
      assert.ok(names.has("task_relation_json"));
      assert.ok(names.has("task_parent_thread_id"));
      assert.ok(names.has("title_regeneration_request_id"));
      assert.ok(names.has("title_regeneration_started_at"));
      assert.ok(names.has("pinned_at"));
    }),
  );

  it.effect("backfills legacy pins without overwriting canonical pins", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 44 });
      // The upstream-only path has no legacy column; add it to model a fork
      // database that ran the old projection before this forward migration.
      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      if (!columns.some((column) => column.name === "pinned")) {
        yield* sql`
          ALTER TABLE projection_threads
          ADD COLUMN pinned INTEGER NOT NULL DEFAULT 0
        `;
      }
      yield* sql`
        INSERT INTO projection_threads (
          thread_id, project_id, title, model_selection_json, runtime_mode,
          interaction_mode, created_at, updated_at, pending_approval_count,
          pending_user_input_count, has_actionable_proposed_plan, pinned, pinned_at
        ) VALUES
          ('legacy-pin', 'project-1', 'Legacy', '{"instanceId":"codex","model":"gpt-5.4"}',
           'full-access', 'default', '2026-01-01T00:00:00.000Z',
           '2026-01-02T00:00:00.000Z', 0, 0, 0, 1, NULL),
          ('canonical-pin', 'project-1', 'Canonical', '{"instanceId":"codex","model":"gpt-5.4"}',
           'full-access', 'default', '2026-01-01T00:00:00.000Z',
           '2026-01-02T00:00:00.000Z', 0, 0, 0, 1, '2026-01-03T00:00:00.000Z')
      `;

      // The suite shares an in-memory layer. Re-open this additive migration
      // after preparing the legacy layout so its one-time update is tested.
      yield* sql`
        DELETE FROM effect_sql_migrations
        WHERE migration_id IN (45, 46)
      `;

      yield* runMigrations();

      const migrations = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT migration_id AS id, name
        FROM effect_sql_migrations
        WHERE migration_id = 45
      `;
      assert.deepStrictEqual(migrations, [
        { id: 45, name: "ReconcileForkAndUpstreamThreadSchema" },
      ]);

      const rows = yield* sql<{ readonly id: string; readonly pinnedAt: string | null }>`
        SELECT thread_id AS id, pinned_at AS pinnedAt
        FROM projection_threads
        WHERE thread_id IN ('legacy-pin', 'canonical-pin')
        ORDER BY thread_id
      `;
      assert.deepStrictEqual(rows, [
        { id: "canonical-pin", pinnedAt: "2026-01-03T00:00:00.000Z" },
        { id: "legacy-pin", pinnedAt: "2026-01-02T00:00:00.000Z" },
      ]);
    }),
  );
});
