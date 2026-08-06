export const THREAD_SPLIT_PREFERRED_WIDTH = 480;
export const THREAD_SPLIT_PREFERRED_HEIGHT = 360;
export const THREAD_SPLIT_MIN_WIDTH = 320;
export const THREAD_SPLIT_MIN_HEIGHT = 240;
export const THREAD_SPLIT_COMPACT_WIDTH = 900;
export const THREAD_SPLIT_COMPACT_HEIGHT = 560;

export type ThreadSplitLayoutMode = "auto" | "columns" | "rows" | "grid";
export type ThreadSplitAxis = "horizontal" | "vertical";

export interface ThreadSplitPlacement<T extends string = string> {
  target: T;
  bandIndex: number;
  indexInBand: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ThreadSplitBand<T extends string = string> {
  index: number;
  targets: readonly T[];
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ThreadSplitDivider<T extends string = string> {
  axis: ThreadSplitAxis;
  position: number;
  start: number;
  end: number;
  before: T;
  after: T;
  dividerIndex: number | null;
  draggable: boolean;
  resizeGroups: readonly (readonly T[])[];
  resizeStart: number;
  resizeExtent: number;
}

export interface ThreadSplitLayout<T extends string = string> {
  mode: ThreadSplitLayoutMode;
  orientation: "row-bands" | "column-bands";
  width: number;
  height: number;
  overflowWidth: number;
  overflowHeight: number;
  bands: readonly ThreadSplitBand<T>[];
  placements: readonly ThreadSplitPlacement<T>[];
  dividers: readonly ThreadSplitDivider<T>[];
  weights: readonly number[];
}

export interface ResolveThreadSplitLayoutInput<T extends string = string> {
  targets: readonly T[];
  mode: ThreadSplitLayoutMode;
  width: number;
  height: number;
  weights?: readonly number[];
  gridColumns?: number;
  gridRows?: number;
}

export const THREAD_SPLIT_GRID_DEFAULT_COLUMNS = 3;
export const THREAD_SPLIT_GRID_DEFAULT_ROWS = 3;
export const THREAD_SPLIT_GRID_MAX_COLUMNS = 12;
export const THREAD_SPLIT_GRID_MAX_ROWS = 12;

export function normalizeThreadSplitGridDimension(
  value: unknown,
  fallback: number,
  maximum: number,
): number {
  return typeof value === "number" && Number.isFinite(value)
    ? Math.min(maximum, Math.max(1, Math.round(value)))
    : fallback;
}

const finiteSize = (value: number) => (Number.isFinite(value) ? Math.max(0, value) : 0);

export function isCompactThreadSplitWorkspace(width: number, height: number): boolean {
  return (
    finiteSize(width) < THREAD_SPLIT_COMPACT_WIDTH ||
    finiteSize(height) < THREAD_SPLIT_COMPACT_HEIGHT
  );
}

export function normalizeThreadSplitWeights(
  weights: readonly number[] | undefined,
  count: number,
): number[] {
  if (count <= 0) return [];
  if (
    weights?.length !== count ||
    weights.some((weight) => !Number.isFinite(weight) || weight <= 0)
  ) {
    return Array.from({ length: count }, () => 1 / count);
  }

  const total = weights.reduce((sum, weight) => sum + weight, 0);
  if (!Number.isFinite(total) || total <= 0) {
    return Array.from({ length: count }, () => 1 / count);
  }
  return weights.map((weight) => weight / total);
}

function constrainedSizes(weights: readonly number[], extent: number, minimum: number): number[] {
  const sizes = Array.from({ length: weights.length }, () => 0);
  const remaining = new Set(weights.map((_, index) => index));
  let remainingExtent = extent;
  let remainingWeight = 1;

  while (remaining.size > 0) {
    const constrained = [...remaining].filter(
      (index) => (weights[index]! / remainingWeight) * remainingExtent < minimum,
    );
    if (constrained.length === 0) {
      for (const index of remaining) {
        sizes[index] = (weights[index]! / remainingWeight) * remainingExtent;
      }
      break;
    }
    for (const index of constrained) {
      sizes[index] = minimum;
      remaining.delete(index);
      remainingExtent -= minimum;
      remainingWeight -= weights[index]!;
    }
  }
  return sizes;
}

export function clampThreadSplitDivider(
  weights: readonly number[] | undefined,
  dividerIndex: number,
  desiredPosition: number,
  extent: number,
  minimum: number,
): number[] {
  const normalized = normalizeThreadSplitWeights(weights, weights?.length ?? 0);
  if (
    dividerIndex < 0 ||
    dividerIndex >= normalized.length - 1 ||
    !Number.isFinite(desiredPosition)
  ) {
    return normalized;
  }

  const safeMinimum = finiteSize(minimum);
  const safeExtent = Math.max(finiteSize(extent), normalized.length * safeMinimum);
  const sizes = constrainedSizes(normalized, safeExtent, safeMinimum);
  const prefix = sizes.slice(0, dividerIndex).reduce((sum, size) => sum + size, 0);
  const pairExtent = sizes[dividerIndex]! + sizes[dividerIndex + 1]!;
  const first = Math.min(pairExtent - safeMinimum, Math.max(safeMinimum, desiredPosition - prefix));
  sizes[dividerIndex] = first;
  sizes[dividerIndex + 1] = pairExtent - first;
  return sizes.map((size) => size / safeExtent);
}

export function resizeThreadSplitDividerWeights<T extends string>(
  weights: readonly number[] | undefined,
  targets: readonly T[],
  divider: ThreadSplitDivider<T>,
  desiredPosition: number,
  minimum: number,
): number[] {
  const normalized = normalizeThreadSplitWeights(weights, targets.length);
  if (!divider.draggable || divider.dividerIndex === null || divider.resizeGroups.length < 2) {
    return normalized;
  }

  const targetIndex = new Map(targets.map((target, index) => [target, index]));
  const groupAverages = divider.resizeGroups.map((group) => {
    const groupWeights = group.flatMap((target) => {
      const index = targetIndex.get(target);
      return index === undefined ? [] : [normalized[index]!];
    });
    return groupWeights.reduce((sum, weight) => sum + weight, 0) / Math.max(1, groupWeights.length);
  });
  const normalizedGroupAverages = normalizeThreadSplitWeights(groupAverages, groupAverages.length);
  const safeMinimum = Math.min(
    finiteSize(minimum),
    finiteSize(divider.resizeExtent) / divider.resizeGroups.length,
  );
  const nextGroupWeights = clampThreadSplitDivider(
    normalizedGroupAverages,
    divider.dividerIndex,
    desiredPosition - divider.resizeStart,
    divider.resizeExtent,
    safeMinimum,
  );
  const next = [...normalized];

  divider.resizeGroups.forEach((group, groupIndex) => {
    const currentGroupWeight = normalizedGroupAverages[groupIndex]!;
    const scale = currentGroupWeight > 0 ? nextGroupWeights[groupIndex]! / currentGroupWeight : 1;
    group.forEach((target) => {
      const index = targetIndex.get(target);
      if (index !== undefined) next[index] = normalized[index]! * scale;
    });
  });
  return normalizeThreadSplitWeights(next, targets.length);
}

function bandCounts(count: number, bands: number): number[] {
  const smaller = Math.floor(count / bands);
  const largerBands = count % bands;
  return Array.from({ length: bands }, (_, index) =>
    index < bands - largerBands ? smaller : smaller + 1,
  );
}

interface AutoCandidate {
  orientation: "row-bands" | "column-bands";
  counts: number[];
  score: number;
}

function autoCandidates(count: number, width: number, height: number): AutoCandidate[] {
  const candidates: AutoCandidate[] = [];
  const minimumBands = count <= 2 ? 1 : 2;
  const maximumBands = count <= 2 ? 1 : Math.ceil(count / 2);

  for (let bands = minimumBands; bands <= maximumBands; bands += 1) {
    const counts = bandCounts(count, bands);
    for (const orientation of ["row-bands", "column-bands"] as const) {
      const paneDimensions = counts.map((bandSize) =>
        orientation === "row-bands"
          ? { width: width / bandSize, height: height / bands }
          : { width: width / bands, height: height / bandSize },
      );
      candidates.push({
        orientation,
        counts,
        score: Math.min(
          ...paneDimensions.map(({ width: paneWidth, height: paneHeight }) =>
            Math.min(
              paneWidth / THREAD_SPLIT_PREFERRED_WIDTH,
              paneHeight / THREAD_SPLIT_PREFERRED_HEIGHT,
            ),
          ),
        ),
      });
    }
  }
  return candidates;
}

function chooseAutoCandidate(count: number, width: number, height: number): AutoCandidate {
  const dominantOrientation = width >= height ? "row-bands" : "column-bands";
  return autoCandidates(count, width, height).sort((left, right) => {
    const scoreDifference = right.score - left.score;
    if (Math.abs(scoreDifference) > 1e-9) return scoreDifference;
    if (left.orientation !== right.orientation) {
      return left.orientation === dominantOrientation ? -1 : 1;
    }
    if (left.counts.length !== right.counts.length) {
      return left.counts.length - right.counts.length;
    }
    return 0;
  })[0]!;
}

function buildBandedLayout<T extends string>(
  targets: readonly T[],
  width: number,
  height: number,
  candidate: Pick<AutoCandidate, "orientation" | "counts">,
  weights: readonly number[],
): Pick<ThreadSplitLayout<T>, "bands" | "placements" | "dividers"> {
  const bands: ThreadSplitBand<T>[] = [];
  const placements: ThreadSplitPlacement<T>[] = [];
  const dividers: ThreadSplitDivider<T>[] = [];
  const rowBands = candidate.orientation === "row-bands";
  const targetWeights = new Map(targets.map((target, index) => [target, weights[index]!]));
  const groupedTargets: T[][] = [];
  let targetIndex = 0;

  candidate.counts.forEach((count) => {
    groupedTargets.push(targets.slice(targetIndex, targetIndex + count));
    targetIndex += count;
  });
  const bandWeights = normalizeThreadSplitWeights(
    groupedTargets.map(
      (bandTargets) =>
        bandTargets.reduce((sum, target) => sum + targetWeights.get(target)!, 0) /
        bandTargets.length,
    ),
    groupedTargets.length,
  );
  const bandExtent = rowBands ? height : width;
  const bandSizes = bandWeights.map((weight) => weight * bandExtent);
  let bandOffset = 0;

  groupedTargets.forEach((bandTargets, bandIndex) => {
    const bandSize = bandSizes[bandIndex]!;
    const band = {
      index: bandIndex,
      targets: bandTargets,
      x: rowBands ? 0 : bandOffset,
      y: rowBands ? bandOffset : 0,
      width: rowBands ? width : bandSize,
      height: rowBands ? bandSize : height,
    };
    bands.push(band);

    const withinWeights = normalizeThreadSplitWeights(
      band.targets.map((target) => targetWeights.get(target)!),
      band.targets.length,
    );
    const withinExtent = rowBands ? band.width : band.height;
    const withinSizes = withinWeights.map((weight) => weight * withinExtent);
    let withinOffset = 0;
    band.targets.forEach((target, indexInBand) => {
      const withinSize = withinSizes[indexInBand]!;
      const placement = {
        target,
        bandIndex,
        indexInBand,
        x: rowBands ? withinOffset : band.x,
        y: rowBands ? band.y : withinOffset,
        width: rowBands ? withinSize : band.width,
        height: rowBands ? band.height : withinSize,
      };
      placements.push(placement);
      if (indexInBand > 0) {
        dividers.push({
          axis: rowBands ? "vertical" : "horizontal",
          position: rowBands ? placement.x : placement.y,
          start: rowBands ? band.y : band.x,
          end: rowBands ? band.y + band.height : band.x + band.width,
          before: band.targets[indexInBand - 1]!,
          after: target,
          dividerIndex: indexInBand - 1,
          draggable: true,
          resizeGroups: band.targets.map((bandTarget) => [bandTarget]),
          resizeStart: rowBands ? band.x : band.y,
          resizeExtent: withinExtent,
        });
      }
      withinOffset += withinSize;
    });
    bandOffset += bandSize;
  });

  for (let index = 1; index < bands.length; index += 1) {
    dividers.push({
      axis: candidate.orientation === "row-bands" ? "horizontal" : "vertical",
      position: candidate.orientation === "row-bands" ? bands[index]!.y : bands[index]!.x,
      start: 0,
      end: candidate.orientation === "row-bands" ? width : height,
      before: bands[index - 1]!.targets.at(-1)!,
      after: bands[index]!.targets[0]!,
      dividerIndex: index - 1,
      draggable: true,
      resizeGroups: bands.map((band) => band.targets),
      resizeStart: 0,
      resizeExtent: bandExtent,
    });
  }
  return { bands, placements, dividers };
}

export function resolveThreadSplitLayout<T extends string>({
  targets,
  mode,
  width: inputWidth,
  height: inputHeight,
  weights: inputWeights,
  gridColumns: inputGridColumns,
  gridRows: inputGridRows,
}: ResolveThreadSplitLayoutInput<T>): ThreadSplitLayout<T> {
  const width = finiteSize(inputWidth);
  const height = finiteSize(inputHeight);
  const weights = normalizeThreadSplitWeights(inputWeights, targets.length);

  if (targets.length === 0) {
    return {
      mode,
      orientation: mode === "rows" ? "column-bands" : "row-bands",
      width,
      height,
      overflowWidth: width,
      overflowHeight: height,
      bands: [],
      placements: [],
      dividers: [],
      weights,
    };
  }

  if (mode === "grid") {
    const gridColumns = normalizeThreadSplitGridDimension(
      inputGridColumns,
      THREAD_SPLIT_GRID_DEFAULT_COLUMNS,
      THREAD_SPLIT_GRID_MAX_COLUMNS,
    );
    const gridRows = normalizeThreadSplitGridDimension(
      inputGridRows,
      THREAD_SPLIT_GRID_DEFAULT_ROWS,
      THREAD_SPLIT_GRID_MAX_ROWS,
    );
    const totalRows = Math.ceil(targets.length / gridColumns);
    const overflows = totalRows > gridRows;
    const counts = overflows
      ? Array.from({ length: totalRows }, (_, index) =>
          Math.min(gridColumns, targets.length - index * gridColumns),
        )
      : bandCounts(targets.length, totalRows);
    const visibleRows = overflows ? gridRows : totalRows;
    const paneHeight = height / visibleRows;
    const overflowHeight = Math.max(height, totalRows * paneHeight);
    const bands: ThreadSplitBand<T>[] = [];
    const placements: ThreadSplitPlacement<T>[] = [];
    const dividers: ThreadSplitDivider<T>[] = [];
    let targetIndex = 0;

    counts.forEach((count, row) => {
      const rowTargets = targets.slice(targetIndex, targetIndex + count);
      const y = row * paneHeight;
      const paneWidth = width / count;
      const band = { index: row, targets: rowTargets, x: 0, y, width, height: paneHeight };
      bands.push(band);

      rowTargets.forEach((target, column) => {
        const placement = {
          target,
          bandIndex: row,
          indexInBand: column,
          x: column * paneWidth,
          y,
          width: paneWidth,
          height: paneHeight,
        };
        placements.push(placement);
        if (column > 0) {
          dividers.push({
            axis: "vertical",
            position: placement.x,
            start: y,
            end: y + paneHeight,
            before: rowTargets[column - 1]!,
            after: target,
            dividerIndex: null,
            draggable: false,
            resizeGroups: [],
            resizeStart: 0,
            resizeExtent: 0,
          });
        }
      });
      if (row > 0) {
        dividers.push({
          axis: "horizontal",
          position: y,
          start: 0,
          end: width,
          before: bands[row - 1]!.targets.at(-1)!,
          after: rowTargets[0]!,
          dividerIndex: null,
          draggable: false,
          resizeGroups: [],
          resizeStart: 0,
          resizeExtent: 0,
        });
      }
      targetIndex += count;
    });
    return {
      mode,
      orientation: "row-bands",
      width,
      height,
      overflowWidth: width,
      overflowHeight,
      bands,
      placements,
      dividers,
      weights,
    };
  }

  if (mode === "auto") {
    const candidate = chooseAutoCandidate(targets.length, width, height);
    if (candidate.counts.length === 1) {
      const linear = resolveThreadSplitLayout({
        targets,
        mode: candidate.orientation === "row-bands" ? "columns" : "rows",
        width,
        height,
        weights,
      });
      return {
        ...linear,
        mode,
        orientation: candidate.orientation,
      };
    }
    return {
      mode,
      orientation: candidate.orientation,
      width,
      height,
      overflowWidth: width,
      overflowHeight: height,
      ...buildBandedLayout(targets, width, height, candidate, weights),
      weights,
    };
  }

  const columns = mode === "columns";
  const minimum = columns ? THREAD_SPLIT_MIN_WIDTH : THREAD_SPLIT_MIN_HEIGHT;
  const availableExtent = columns ? width : height;
  const layoutExtent = Math.max(availableExtent, minimum * targets.length);
  const sizes = constrainedSizes(weights, layoutExtent, minimum);
  const bands: ThreadSplitBand<T>[] = [];
  const placements: ThreadSplitPlacement<T>[] = [];
  const dividers: ThreadSplitDivider<T>[] = [];
  let offset = 0;

  targets.forEach((target, index) => {
    const size = sizes[index]!;
    const placement = {
      target,
      bandIndex: 0,
      indexInBand: index,
      x: columns ? offset : 0,
      y: columns ? 0 : offset,
      width: columns ? size : width,
      height: columns ? height : size,
    };
    placements.push(placement);
    if (index > 0) {
      dividers.push({
        axis: columns ? "vertical" : "horizontal",
        position: offset,
        start: 0,
        end: columns ? height : width,
        before: targets[index - 1]!,
        after: target,
        dividerIndex: index - 1,
        draggable: true,
        resizeGroups: targets.map((resizeTarget) => [resizeTarget]),
        resizeStart: 0,
        resizeExtent: layoutExtent,
      });
    }
    offset += size;
  });
  bands.push({
    index: 0,
    targets: [...targets],
    x: 0,
    y: 0,
    width: columns ? layoutExtent : width,
    height: columns ? height : layoutExtent,
  });

  return {
    mode,
    orientation: columns ? "row-bands" : "column-bands",
    width,
    height,
    overflowWidth: columns ? layoutExtent : width,
    overflowHeight: columns ? height : layoutExtent,
    bands,
    placements,
    dividers,
    weights,
  };
}
