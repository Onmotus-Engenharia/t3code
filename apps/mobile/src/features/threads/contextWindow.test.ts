import { ThreadId } from "@t3tools/contracts";
import { describe, expect, it } from "vite-plus/test";

import {
  deriveTaskTreeContextWindowUsage,
  formatContextUsage,
  formatContextWindowTokens,
} from "./contextWindow";

function makeThreadUsage(
  id: string,
  latestTokenUsage: {
    usedTokens: number;
    totalProcessedTokens?: number;
    maxTokens?: number;
  } | null,
  relation: { parentThreadId: string; rootThreadId: string; depth: number } | null = null,
) {
  return {
    id: ThreadId.make(id),
    latestTokenUsage,
    taskRelation: relation
      ? {
          parentThreadId: ThreadId.make(relation.parentThreadId),
          rootThreadId: ThreadId.make(relation.rootThreadId),
          depth: relation.depth,
          workspaceMode: "shared" as const,
          createdBy: "agent" as const,
        }
      : null,
  };
}

describe("mobile context window", () => {
  it("aggregates root task-tree usage and excludes unrelated tasks", () => {
    const root = makeThreadUsage("root", {
      usedTokens: 100,
      totalProcessedTokens: 500,
      maxTokens: 1_000,
    });
    const usage = deriveTaskTreeContextWindowUsage(root, [
      root,
      makeThreadUsage(
        "child",
        { usedTokens: 200, maxTokens: 2_000 },
        { parentThreadId: "root", rootThreadId: "root", depth: 1 },
      ),
      makeThreadUsage(
        "grandchild",
        { usedTokens: 300, totalProcessedTokens: 900, maxTokens: 3_000 },
        { parentThreadId: "child", rootThreadId: "root", depth: 2 },
      ),
      makeThreadUsage(
        "unrelated",
        { usedTokens: 9_000, totalProcessedTokens: 9_000, maxTokens: 10_000 },
        { parentThreadId: "other", rootThreadId: "other", depth: 1 },
      ),
    ]);

    expect(usage).toEqual({
      taskCount: 3,
      measuredTaskCount: 3,
      usedTokens: 600,
      totalProcessedTokens: 1_600,
      maxTokens: 6_000,
      usedPercentage: 10,
    });
  });

  it("does not duplicate aggregate usage on child tasks or lone roots", () => {
    const root = makeThreadUsage("root", { usedTokens: 100, maxTokens: 1_000 });
    const child = makeThreadUsage(
      "child",
      { usedTokens: 200, maxTokens: 2_000 },
      { parentThreadId: "root", rootThreadId: "root", depth: 1 },
    );

    expect(deriveTaskTreeContextWindowUsage(child, [root, child])).toBeNull();
    expect(deriveTaskTreeContextWindowUsage(root, [root])).toBeNull();
  });

  it("omits aggregate capacity and percentage when any measured max is missing", () => {
    const root = makeThreadUsage("root", { usedTokens: 100, maxTokens: 1_000 });
    const child = makeThreadUsage(
      "child",
      { usedTokens: 200 },
      { parentThreadId: "root", rootThreadId: "root", depth: 1 },
    );

    expect(deriveTaskTreeContextWindowUsage(root, [root, child])).toMatchObject({
      usedTokens: 300,
      totalProcessedTokens: 300,
      maxTokens: null,
      usedPercentage: null,
    });
  });

  it("formats known and unknown capacity without false percentages", () => {
    expect(formatContextWindowTokens(1_400)).toBe("1.4k");
    expect(formatContextUsage({ usedTokens: 14_000, maxTokens: 258_000 })).toBe("14k / 258k");
    expect(formatContextUsage({ usedTokens: 14_000 })).toBe("14k used");
    expect(formatContextUsage({ usedTokens: 14_000, maxTokens: 0 })).toBe("14k used");
  });
});
