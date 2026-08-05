import { describe, expect, it } from "vite-plus/test";

import {
  THREAD_SPLIT_MIN_HEIGHT,
  THREAD_SPLIT_MIN_WIDTH,
  clampThreadSplitDivider,
  isCompactThreadSplitWorkspace,
  normalizeThreadSplitWeights,
  resizeThreadSplitDividerWeights,
  resolveThreadSplitLayout,
} from "./threadSplitLayout";

const targets = (count: number) =>
  Array.from({ length: count }, (_, index) => `thread-${index + 1}`);

const arrangement = (count: number, width: number, height: number) => {
  const layout = resolveThreadSplitLayout({
    targets: targets(count),
    mode: "auto",
    width,
    height,
  });
  return {
    orientation: layout.orientation,
    counts: layout.bands.map((band) => band.targets.length),
  };
};

describe("resolveThreadSplitLayout auto mode", () => {
  it("selects row bands in landscape and column bands in portrait ties", () => {
    expect(arrangement(4, 1200, 800)).toEqual({
      orientation: "row-bands",
      counts: [2, 2],
    });
    expect(arrangement(4, 800, 1200)).toEqual({
      orientation: "column-bands",
      counts: [2, 2],
    });
  });

  it.each([
    [2, [2]],
    [3, [1, 2]],
    [4, [2, 2]],
    [5, [2, 3]],
  ] as const)("uses the planned %i-pane arrangement", (count, counts) => {
    expect(arrangement(count, 1440, 900)).toEqual({
      orientation: "row-bands",
      counts,
    });
  });

  it.each([
    [2, [2]],
    [3, [1, 2]],
    [4, [2, 2]],
    [5, [2, 3]],
  ] as const)("rotates the planned %i-pane arrangement in portrait", (count, counts) => {
    expect(arrangement(count, 900, 1440)).toEqual({
      orientation: "column-bands",
      counts,
    });
  });

  it("keeps a two-pane auto arrangement while applying resizable weights", () => {
    const landscape = resolveThreadSplitLayout({
      targets: targets(2),
      mode: "auto",
      width: 1200,
      height: 800,
      weights: [0.65, 0.35],
    });
    expect(landscape.bands.map((band) => band.targets.length)).toEqual([2]);
    expect(landscape.placements.map(({ width }) => width)).toEqual([780, 420]);
    expect(landscape.dividers).toMatchObject([
      { axis: "vertical", dividerIndex: 0, draggable: true },
    ]);

    const portrait = resolveThreadSplitLayout({
      targets: targets(2),
      mode: "auto",
      width: 800,
      height: 1200,
      weights: [0.35, 0.65],
    });
    expect(portrait.bands.map((band) => band.targets.length)).toEqual([2]);
    expect(portrait.placements.map(({ height }) => height)).toEqual([420, 780]);
    expect(portrait.dividers).toMatchObject([
      { axis: "horizontal", dividerIndex: 0, draggable: true },
    ]);
  });

  it("resizes auto grid bands and panes without changing their arrangement", () => {
    const initial = resolveThreadSplitLayout({
      targets: targets(3),
      mode: "auto",
      width: 1200,
      height: 800,
    });
    expect(initial.bands.map((band) => band.targets.length)).toEqual([1, 2]);
    expect(initial.dividers.map(({ axis, draggable }) => ({ axis, draggable }))).toEqual([
      { axis: "vertical", draggable: true },
      { axis: "horizontal", draggable: true },
    ]);

    const vertical = initial.dividers.find((divider) => divider.axis === "vertical")!;
    const widerSecondPane = resizeThreadSplitDividerWeights(
      initial.weights,
      initial.placements.map(({ target }) => target),
      vertical,
      720,
      THREAD_SPLIT_MIN_WIDTH,
    );
    const resizedPanes = resolveThreadSplitLayout({
      targets: targets(3),
      mode: "auto",
      width: 1200,
      height: 800,
      weights: widerSecondPane,
    });
    expect(resizedPanes.bands.map((band) => band.targets.length)).toEqual([1, 2]);
    expect(resizedPanes.placements.map(({ width }) => width)).toEqual([1200, 720, 480]);
    expect(resizedPanes.bands.map(({ height }) => height)).toEqual([400, 400]);

    const horizontal = initial.dividers.find((divider) => divider.axis === "horizontal")!;
    const tallerFirstBand = resizeThreadSplitDividerWeights(
      initial.weights,
      initial.placements.map(({ target }) => target),
      horizontal,
      480,
      THREAD_SPLIT_MIN_HEIGHT,
    );
    const resizedBands = resolveThreadSplitLayout({
      targets: targets(3),
      mode: "auto",
      width: 1200,
      height: 800,
      weights: tallerFirstBand,
    });
    expect(resizedBands.bands.map((band) => band.targets.length)).toEqual([1, 2]);
    expect(resizedBands.bands.map(({ height }) => height)).toEqual([480, 320]);
    expect(resizedBands.placements.slice(1).map(({ width }) => width)).toEqual([600, 600]);
  });

  it("covers every pane count through fifty without overlap or omissions", () => {
    for (let count = 2; count <= 50; count += 1) {
      const orderedTargets = targets(count);
      const layout = resolveThreadSplitLayout({
        targets: orderedTargets,
        mode: "auto",
        width: 1536,
        height: 960,
      });

      expect(layout.placements.map(({ target }) => target)).toEqual(orderedTargets);
      expect(layout.placements).toHaveLength(count);
      expect(layout.bands.flatMap(({ targets: bandTargets }) => bandTargets)).toEqual(
        orderedTargets,
      );
      expect(
        layout.bands.every(
          (band, index, bands) =>
            Math.max(...bands.map(({ targets }) => targets.length)) -
              Math.min(...bands.map(({ targets }) => targets.length)) <=
              1 &&
            (index === 0 || band.targets.length >= bands[index - 1]!.targets.length),
        ),
      ).toBe(true);

      for (const pane of layout.placements) {
        expect(pane.x).toBeGreaterThanOrEqual(0);
        expect(pane.y).toBeGreaterThanOrEqual(0);
        expect(pane.x + pane.width).toBeLessThanOrEqual(layout.width + 1e-8);
        expect(pane.y + pane.height).toBeLessThanOrEqual(layout.height + 1e-8);
        for (const other of layout.placements) {
          if (pane.target === other.target) continue;
          const overlapWidth =
            Math.min(pane.x + pane.width, other.x + other.width) - Math.max(pane.x, other.x);
          const overlapHeight =
            Math.min(pane.y + pane.height, other.y + other.height) - Math.max(pane.y, other.y);
          expect(overlapWidth <= 1e-8 || overlapHeight <= 1e-8).toBe(true);
        }
      }
    }
  });

  it("is deterministic and independent of anything except ordered inputs", () => {
    const input = {
      targets: targets(7),
      mode: "auto" as const,
      width: 1000,
      height: 1000,
    };
    const first = resolveThreadSplitLayout(input);
    const second = resolveThreadSplitLayout(input);
    expect(second).toEqual(first);
    expect(first.orientation).toBe("row-bands");
    expect(first.placements.map(({ target }) => target)).toEqual(input.targets);
    expect(first.dividers.every(({ draggable }) => draggable)).toBe(true);
  });
});

describe("isCompactThreadSplitWorkspace", () => {
  it("uses the actual 900 by 560 workspace threshold", () => {
    expect(isCompactThreadSplitWorkspace(900, 560)).toBe(false);
    expect(isCompactThreadSplitWorkspace(899, 560)).toBe(true);
    expect(isCompactThreadSplitWorkspace(900, 559)).toBe(true);
  });
});

describe("resolveThreadSplitLayout manual modes", () => {
  it("lays out grid cells as equal columns and visible rows with vertical overflow", () => {
    const layout = resolveThreadSplitLayout({
      targets: targets(12),
      mode: "grid",
      width: 1200,
      height: 900,
      gridColumns: 3,
      gridRows: 3,
    });

    expect(layout.overflowWidth).toBe(1200);
    expect(layout.overflowHeight).toBe(1200);
    expect(layout.dividers).toEqual([]);
    expect(layout.placements.slice(0, 9)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ x: 0, y: 0, width: 400, height: 300 }),
        expect.objectContaining({ x: 800, y: 600, width: 400, height: 300 }),
      ]),
    );
    expect(layout.placements.slice(9)).toEqual([
      expect.objectContaining({ x: 0, y: 900, width: 400, height: 300 }),
      expect.objectContaining({ x: 400, y: 900, width: 400, height: 300 }),
      expect.objectContaining({ x: 800, y: 900, width: 400, height: 300 }),
    ]);
  });

  it("normalizes valid weights and repairs malformed weights", () => {
    expect(normalizeThreadSplitWeights([2, 3, 5], 3)).toEqual([0.2, 0.3, 0.5]);
    expect(normalizeThreadSplitWeights([1, Number.NaN, 2], 3)).toEqual([1 / 3, 1 / 3, 1 / 3]);
    expect(normalizeThreadSplitWeights([1, -1], 2)).toEqual([0.5, 0.5]);
    expect(normalizeThreadSplitWeights([1], 2)).toEqual([0.5, 0.5]);
  });

  it("uses normalized weights while respecting column minimums", () => {
    const layout = resolveThreadSplitLayout({
      targets: targets(3),
      mode: "columns",
      width: 1600,
      height: 700,
      weights: [1, 2, 1],
    });
    expect(layout.placements.map(({ width }) => width)).toEqual([400, 800, 400]);
    expect(layout.placements.every(({ width }) => width >= THREAD_SPLIT_MIN_WIDTH)).toBe(true);
    expect(
      layout.dividers.map(({ dividerIndex, draggable }) => ({ dividerIndex, draggable })),
    ).toEqual([
      { dividerIndex: 0, draggable: true },
      { dividerIndex: 1, draggable: true },
    ]);
  });

  it("overflows columns and rows instead of crossing minimum dimensions", () => {
    const columns = resolveThreadSplitLayout({
      targets: targets(4),
      mode: "columns",
      width: 900,
      height: 500,
    });
    expect(columns.overflowWidth).toBe(4 * THREAD_SPLIT_MIN_WIDTH);
    expect(columns.placements.map(({ width }) => width)).toEqual(
      Array.from({ length: 4 }, () => THREAD_SPLIT_MIN_WIDTH),
    );

    const rows = resolveThreadSplitLayout({
      targets: targets(3),
      mode: "rows",
      width: 700,
      height: 500,
    });
    expect(rows.overflowHeight).toBe(3 * THREAD_SPLIT_MIN_HEIGHT);
    expect(rows.placements.map(({ height }) => height)).toEqual(
      Array.from({ length: 3 }, () => THREAD_SPLIT_MIN_HEIGHT),
    );
  });

  it("clamps divider positions to both adjacent pane minimums", () => {
    expect(clampThreadSplitDivider([0.5, 0.5], 0, -100, 1000, 320)).toEqual([0.32, 0.68]);
    expect(clampThreadSplitDivider([0.5, 0.5], 0, 2000, 1000, 320)).toEqual([0.68, 0.32]);
    expect(clampThreadSplitDivider([0.2, 0.3, 0.5], 1, 950, 1200, 320)).toEqual([
      320 / 1200,
      560 / 1200,
      320 / 1200,
    ]);
  });

  it("keeps clamped weights finite, positive, and normalized in overflow", () => {
    const resized = clampThreadSplitDivider([1, 1, 1, 1], 1, 0, 900, 320);
    expect(resized.reduce((sum, weight) => sum + weight, 0)).toBeCloseTo(1);
    expect(resized.every((weight) => Number.isFinite(weight) && weight > 0)).toBe(true);
    const layout = resolveThreadSplitLayout({
      targets: targets(4),
      mode: "columns",
      width: 900,
      height: 500,
      weights: resized,
    });
    expect(layout.placements.every(({ width }) => width >= THREAD_SPLIT_MIN_WIDTH)).toBe(true);
  });
});
