import { describe, expect, it } from "vite-plus/test";
import { EventId, type OrchestrationThreadActivity, ThreadId, TurnId } from "@t3tools/contracts";

import {
  deriveLatestContextWindowSnapshot,
  deriveTaskTreeContextWindowUsage,
  formatContextWindowTokens,
} from "./contextWindow";

function makeActivity(id: string, kind: string, payload: unknown): OrchestrationThreadActivity {
  return {
    id: EventId.make(id),
    tone: "info",
    kind,
    summary: kind,
    payload,
    turnId: TurnId.make("turn-1"),
    createdAt: "2026-03-23T00:00:00.000Z",
  };
}

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

describe("contextWindow", () => {
  it("derives the latest valid context window snapshot", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 1000,
      }),
      makeActivity("activity-2", "tool.started", {}),
      makeActivity("activity-3", "context-window.updated", {
        usedTokens: 14_000,
        maxTokens: 258_000,
        compactsAutomatically: true,
        autoCompactThreshold: 200_000,
      }),
    ]);

    expect(snapshot).not.toBeNull();
    expect(snapshot?.usedTokens).toBe(14_000);
    expect(snapshot?.totalProcessedTokens).toBeNull();
    expect(snapshot?.maxTokens).toBe(258_000);
    expect(snapshot?.compactsAutomatically).toBe(true);
    expect(snapshot?.autoCompactThreshold).toBe(200_000);
  });

  it("ignores malformed payloads", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {}),
    ]);

    expect(snapshot).toBeNull();
  });

  it("keeps valid zero-usage snapshots", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 0,
        maxTokens: 100_000,
      }),
    ]);

    expect(snapshot).toMatchObject({
      usedTokens: 0,
      maxTokens: 100_000,
      remainingTokens: 100_000,
      usedPercentage: 0,
      remainingPercentage: 100,
    });
  });

  it("formats compact token counts", () => {
    expect(formatContextWindowTokens(999)).toBe("999");
    expect(formatContextWindowTokens(1400)).toBe("1.4k");
    expect(formatContextWindowTokens(14_000)).toBe("14k");
    expect(formatContextWindowTokens(258_000)).toBe("258k");
  });

  it("includes total processed tokens when available", () => {
    const snapshot = deriveLatestContextWindowSnapshot([
      makeActivity("activity-1", "context-window.updated", {
        usedTokens: 81_659,
        totalProcessedTokens: 748_126,
        maxTokens: 258_400,
        lastUsedTokens: 81_659,
      }),
    ]);

    expect(snapshot?.usedTokens).toBe(81_659);
    expect(snapshot?.totalProcessedTokens).toBe(748_126);
  });

  it("aggregates root, child, and grandchild task context usage", () => {
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

  it("does not aggregate from a child task or a root without descendants", () => {
    const root = makeThreadUsage("root", { usedTokens: 100, maxTokens: 1_000 });
    const child = makeThreadUsage(
      "child",
      { usedTokens: 200, maxTokens: 2_000 },
      { parentThreadId: "root", rootThreadId: "root", depth: 1 },
    );

    expect(deriveTaskTreeContextWindowUsage(child, [root, child])).toBeNull();
    expect(deriveTaskTreeContextWindowUsage(root, [root])).toBeNull();
  });

  it("omits aggregate capacity when any measured task has no context limit", () => {
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
});
