import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const currentForkLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

currentForkLayer("046_ProjectionThreadsUnsettledAt current fork ledger", (it) => {
  it.effect("adds unsettled_at after the current fork migration ledger", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 45 });
      yield* runMigrations();

      const columns = yield* sql<{ readonly name: string }>`
        PRAGMA table_info(projection_threads)
      `;
      assert.ok(columns.some((column) => column.name === "unsettled_at"));

      const migrations = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT migration_id AS id, name
        FROM effect_sql_migrations
        WHERE migration_id IN (45, 46)
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        { id: 45, name: "ReconcileForkAndUpstreamThreadSchema" },
        { id: 46, name: "ProjectionThreadsUnsettledAt" },
      ]);
    }),
  );
});

const ledgerCollisionLayer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

ledgerCollisionLayer("046_ProjectionThreadsUnsettledAt prior ledger collision", (it) => {
  it.effect("keeps migration 045 repairs when reconciling a prior upstream ledger collision", () =>
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
      assert.ok(names.has("unsettled_at"));

      const migrations = yield* sql<{ readonly id: number; readonly name: string }>`
        SELECT migration_id AS id, name
        FROM effect_sql_migrations
        WHERE migration_id IN (45, 46)
        ORDER BY migration_id
      `;
      assert.deepStrictEqual(migrations, [
        { id: 45, name: "ReconcileForkAndUpstreamThreadSchema" },
        { id: 46, name: "ProjectionThreadsUnsettledAt" },
      ]);
    }),
  );
});
