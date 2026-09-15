import type { Point, Size } from '../camera/SquareWorldViewport.ts';

export const INCOMING_WARNING_WINDOW_SECONDS = 1.25;
export const INCOMING_WARNING_EDGE_INSET_CSS_PX = 30;
export const INCOMING_WARNING_STACK_GAP_CSS_PX = 34;

export type IncomingSpawnWarningSide = 'left' | 'right' | 'top' | 'bottom';

export interface IncomingSpawnWarningSource {
  readonly transactionId: string;
  readonly spawnPointId: string;
  readonly spawnPosition: Point;
  readonly leadTimeSeconds: number;
  readonly elapsedSeconds: number;
}

export interface IncomingSpawnWarningPresentationSnapshot {
  readonly transactionId: string;
  readonly spawnPointId: string;
  readonly side: IncomingSpawnWarningSide;
  readonly arrowRotationDeg: 0 | 90 | 180 | 270;
  readonly edgeAnchorRatio: number;
  readonly remainingSeconds: number;
  readonly alpha: number;
  readonly scale: number;
}

export interface LaidOutIncomingSpawnWarning
  extends IncomingSpawnWarningPresentationSnapshot {
  readonly position: Point;
}

function requireFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function requireWorld(world: Size): void {
  if (!(Number.isFinite(world.width) && world.width > 0)) {
    throw new RangeError('world.width must be a positive finite number');
  }
  if (!(Number.isFinite(world.height) && world.height > 0)) {
    throw new RangeError('world.height must be a positive finite number');
  }
}

function nearestEdge(position: Point, world: Size): IncomingSpawnWarningSide {
  const distances = [
    ['left', Math.abs(position.x)] as const,
    ['right', Math.abs(world.width - position.x)] as const,
    ['top', Math.abs(position.y)] as const,
    ['bottom', Math.abs(world.height - position.y)] as const,
  ];
  let nearest = distances[0];
  for (let index = 1; index < distances.length; index += 1) {
    const candidate = distances[index]!;
    if (candidate[1] < nearest[1]) nearest = candidate;
  }
  return nearest[0];
}


function edgeAnchorRatio(
  position: Point,
  world: Size,
  side: IncomingSpawnWarningSide,
): number {
  const raw = side === 'left' || side === 'right'
    ? position.y / world.height
    : position.x / world.width;
  return Math.min(1, Math.max(0, raw));
}

function arrowRotationFor(side: IncomingSpawnWarningSide): 0 | 90 | 180 | 270 {
  switch (side) {
    case 'left': return 0;
    case 'right': return 180;
    case 'top': return 90;
    case 'bottom': return 270;
  }
}

export function createIncomingSpawnWarningPresentation(input: {
  readonly source: IncomingSpawnWarningSource;
  readonly world: Size;
}): IncomingSpawnWarningPresentationSnapshot | null {
  requireWorld(input.world);
  requireFiniteNonNegative(input.source.leadTimeSeconds, 'leadTimeSeconds');
  requireFiniteNonNegative(input.source.elapsedSeconds, 'elapsedSeconds');

  const remainingSeconds = input.source.leadTimeSeconds - input.source.elapsedSeconds;
  if (remainingSeconds <= 0) return null;

  const visibleWindowSeconds = Math.min(
    INCOMING_WARNING_WINDOW_SECONDS,
    input.source.leadTimeSeconds,
  );
  if (remainingSeconds > visibleWindowSeconds) return null;

  const progress = visibleWindowSeconds <= 0
    ? 1
    : Math.min(1, Math.max(0, 1 - remainingSeconds / visibleWindowSeconds));
  const pulse = 0.5 - 0.5 * Math.cos(progress * Math.PI * 4);
  const side = nearestEdge(input.source.spawnPosition, input.world);

  return Object.freeze({
    transactionId: input.source.transactionId,
    spawnPointId: input.source.spawnPointId,
    side,
    arrowRotationDeg: arrowRotationFor(side),
    edgeAnchorRatio: edgeAnchorRatio(input.source.spawnPosition, input.world, side),
    remainingSeconds,
    alpha: 0.28 + pulse * 0.62,
    scale: 0.94 + pulse * 0.08,
  });
}

export function layoutIncomingSpawnWarnings(
  warnings: readonly IncomingSpawnWarningPresentationSnapshot[],
  world: Size,
  worldToCssPixelScale: number,
): readonly LaidOutIncomingSpawnWarning[] {
  requireWorld(world);
  if (!(Number.isFinite(worldToCssPixelScale) && worldToCssPixelScale > 0)) {
    throw new RangeError('worldToCssPixelScale must be a positive finite number');
  }

  const grouped = new Map<IncomingSpawnWarningSide, IncomingSpawnWarningPresentationSnapshot[]>();
  for (const warning of warnings) {
    const group = grouped.get(warning.side) ?? [];
    group.push(warning);
    grouped.set(warning.side, group);
  }

  const inset = INCOMING_WARNING_EDGE_INSET_CSS_PX / worldToCssPixelScale;
  const gap = INCOMING_WARNING_STACK_GAP_CSS_PX / worldToCssPixelScale;
  const result: LaidOutIncomingSpawnWarning[] = [];

  for (const side of ['left', 'right', 'top', 'bottom'] as const) {
    const group = grouped.get(side);
    if (group === undefined) continue;
    group.sort((left, right) =>
      left.edgeAnchorRatio - right.edgeAnchorRatio ||
      left.transactionId.localeCompare(right.transactionId));

    const edgeLength = side === 'left' || side === 'right'
      ? world.height
      : world.width;
    const edgeMargin = Math.min(inset, edgeLength / 2);
    const minAlong = edgeMargin;
    const maxAlong = edgeLength - edgeMargin;
    const available = Math.max(0, maxAlong - minAlong);
    const effectiveGap = group.length <= 1
      ? 0
      : Math.min(gap, available / (group.length - 1));
    const desired = group.map((warning) =>
      Math.min(maxAlong, Math.max(minAlong, warning.edgeAnchorRatio * edgeLength)));
    const along = [...desired];

    for (let index = 1; index < along.length; index += 1) {
      along[index] = Math.max(along[index]!, along[index - 1]! + effectiveGap);
    }
    if (along.length > 0 && along[along.length - 1]! > maxAlong) {
      along[along.length - 1] = maxAlong;
      for (let index = along.length - 2; index >= 0; index -= 1) {
        along[index] = Math.min(along[index]!, along[index + 1]! - effectiveGap);
      }
    }

    if (along.length > 0) {
      const preferredShift = desired.reduce(
        (sum, coordinate, index) => sum + coordinate - along[index]!,
        0,
      ) / along.length;
      const minimumShift = minAlong - along[0]!;
      const maximumShift = maxAlong - along[along.length - 1]!;
      const shift = Math.min(maximumShift, Math.max(minimumShift, preferredShift));
      for (let index = 0; index < along.length; index += 1) {
        along[index] = along[index]! + shift;
      }
    }

    for (let index = 0; index < group.length; index += 1) {
      const warning = group[index]!;
      const coordinate = along[index]!;
      const position = side === 'left'
        ? { x: inset, y: coordinate }
        : side === 'right'
          ? { x: world.width - inset, y: coordinate }
          : side === 'top'
            ? { x: coordinate, y: inset }
            : { x: coordinate, y: world.height - inset };
      result.push(Object.freeze({ ...warning, position: Object.freeze(position) }));
    }
  }

  return Object.freeze(result);
}
