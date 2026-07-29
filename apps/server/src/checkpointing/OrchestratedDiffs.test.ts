import { ThreadId, TurnId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  checkpointFileSources,
  joinCheckpointDiffs,
  mergeCheckpointFiles,
  selectOrchestratedCheckpointSources,
} from "./OrchestratedDiffs.ts";

const rootThreadId = ThreadId.make("root");
const rootTurnId = TurnId.make("root-turn");

describe("orchestrated checkpoint diffs", () => {
  it("selects the latest captured checkpoint for each isolated descendant in the root turn", () => {
    expect(
      selectOrchestratedCheckpointSources({
        rootThreadId,
        rootTurnId,
        threads: [
          {
            id: ThreadId.make("child"),
            taskRelation: {
              parentThreadId: rootThreadId,
              rootThreadId,
              rootTurnId,
              depth: 1,
              workspaceMode: "isolated",
              createdBy: "agent",
            },
            checkpoints: [
              { checkpointTurnCount: 1, status: "ready" },
              { checkpointTurnCount: 2, status: "missing" },
              { checkpointTurnCount: 3, status: "error" },
            ],
          },
          {
            id: ThreadId.make("grandchild"),
            taskRelation: {
              parentThreadId: ThreadId.make("child"),
              rootThreadId,
              rootTurnId,
              depth: 2,
              workspaceMode: "isolated",
              createdBy: "agent",
            },
            checkpoints: [{ checkpointTurnCount: 1, status: "ready" }],
          },
          {
            id: ThreadId.make("shared-child"),
            taskRelation: {
              parentThreadId: rootThreadId,
              rootThreadId,
              rootTurnId,
              depth: 1,
              workspaceMode: "shared",
              createdBy: "agent",
            },
            checkpoints: [{ checkpointTurnCount: 1, status: "ready" }],
          },
          {
            id: ThreadId.make("other-turn"),
            taskRelation: {
              parentThreadId: rootThreadId,
              rootThreadId,
              rootTurnId: TurnId.make("other-root-turn"),
              depth: 1,
              workspaceMode: "isolated",
              createdBy: "agent",
            },
            checkpoints: [{ checkpointTurnCount: 1, status: "ready" }],
          },
        ],
      }),
    ).toEqual([
      { threadId: "child", fromTurnCount: 0, toTurnCount: 3 },
      { threadId: "grandchild", fromTurnCount: 0, toTurnCount: 1 },
    ]);
  });

  it("merges path stats while retaining every frozen source range", () => {
    const childSource = {
      threadId: ThreadId.make("child"),
      fromTurnCount: 0,
      toTurnCount: 2,
    };
    const grandchildSource = {
      threadId: ThreadId.make("grandchild"),
      fromTurnCount: 0,
      toTurnCount: 1,
    };
    const files = mergeCheckpointFiles([
      [{ path: "src/root.ts", kind: "modified", additions: 3, deletions: 1 }],
      [
        {
          path: "src/shared.ts",
          kind: "modified",
          additions: 5,
          deletions: 2,
          sources: [childSource],
        },
      ],
      [
        {
          path: "src/shared.ts",
          kind: "modified",
          additions: 7,
          deletions: 4,
          sources: [grandchildSource, childSource],
        },
      ],
    ]);

    expect(files).toEqual([
      { path: "src/root.ts", kind: "modified", additions: 3, deletions: 1 },
      {
        path: "src/shared.ts",
        kind: "modified",
        additions: 12,
        deletions: 6,
        sources: [childSource, grandchildSource],
      },
    ]);
    expect(checkpointFileSources(files)).toEqual([childSource, grandchildSource]);
  });

  it("joins non-empty patches with one stable separator", () => {
    expect(joinCheckpointDiffs(["root\n", "", "child\n"])).toBe("root\nchild");
  });
});
