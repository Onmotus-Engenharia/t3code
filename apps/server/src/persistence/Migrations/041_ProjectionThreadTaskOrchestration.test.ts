import { assert, it } from "@effect/vitest";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("041_ProjectionThreadTaskOrchestration", (it) => {
  it.effect("backfills safe defaults and indexes task parents", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;
      yield* runMigrations({ toMigrationInclusive: 34 });
      yield* sql`
        INSERT INTO projection_threads (
          thread_id,
          project_id,
          title,
          model_selection_json,
          runtime_mode,
          interaction_mode,
          created_at,
          updated_at,
          pending_approval_count,
          pending_user_input_count,
          has_actionable_proposed_plan
        ) VALUES (
          'thread-old',
          'project-1',
          'Old thread',
          '{"instanceId":"codex","model":"gpt-5.4"}',
          'full-access',
          'default',
          '2026-01-01T00:00:00.000Z',
          '2026-01-01T00:00:00.000Z',
          0,
          0,
          0
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 41 });

      const rows = yield* sql<{
        readonly enabled: number;
        readonly relation: string | null;
        readonly parentId: string | null;
        readonly pinned: number;
      }>`
        SELECT
          task_orchestration_enabled AS enabled,
          task_relation_json AS relation,
          task_parent_thread_id AS parentId,
          pinned
        FROM projection_threads
        WHERE thread_id = 'thread-old'
      `;
      assert.deepStrictEqual(rows, [
        {
          enabled: 0,
          relation: null,
          parentId: null,
          pinned: 0,
        },
      ]);

      const indexes = yield* sql<{ readonly name: string }>`
        PRAGMA index_list(projection_threads)
      `;
      assert.ok(indexes.some((index) => index.name === "idx_projection_threads_task_parent"));
    }),
  );
});
