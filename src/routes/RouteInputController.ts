import type { Point, Size } from '../camera/SquareWorldViewport.ts';
import { SquareWorldViewport } from '../camera/SquareWorldViewport.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import { ShipState } from '../ships/ShipState.ts';
import { simplifyRouteDraft, type SimplifyConfig } from './RouteSimplifier.ts';

export interface RouteSamplingConfig {
  readonly sampleDistance: number;
  readonly maxRawPoints: number;
}

export interface NormalizedPointerInput {
  readonly source: 'mouse' | 'touch';
  readonly pointerId: number;
  readonly screenPosition: Point;
  readonly cssPosition: Point;
  readonly internalViewport: Size;
  readonly worldToCssPixelScale: number;
}

export const ROUTE_DRAG_ACTIVATION_CSS_PX = 12;

const ROUTE_POINT_EPSILON = 1e-9;

export interface RawRouteDraft {
  readonly shipId: string;
  readonly points: readonly Point[];
  /** Gesture origin, sealed when drawing activates; later ship movement never rebases it. */
  readonly start?: Point;
  readonly tip?: Point;
}

export interface ActiveRouteDraftSnapshot {
  readonly shipId: string;
  readonly pointerId: number;
  readonly points: readonly Point[];
  readonly start: Point;
  readonly tip?: Point;
}

export interface RouteInputControllerOptions {
  readonly viewport: SquareWorldViewport;
  readonly sampling: RouteSamplingConfig;
  readonly processing?: SimplifyConfig;
  readonly hitTest: (worldPoint: Point, worldToCssPixelScale: number) => ShipModel | null;
}

export type RouteInputOutcome =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'started'; readonly shipId: string }
  | { readonly kind: 'tapped'; readonly shipId: string }
  | { readonly kind: 'updated'; readonly pointCount: number }
  | { readonly kind: 'finished'; readonly draft: RawRouteDraft }
  | { readonly kind: 'cancelled' };

interface ActiveRouteInteraction {
  readonly pointerId: number;
  readonly ship: ShipModel;
  readonly initialCssPosition: Point;
  gestureWorldOrigin: Point;
  routeStart: Point;
  readonly points: Point[];
  lastWorldPosition: Point;
  activated: boolean;
}

function assertSamplingConfig(sampling: RouteSamplingConfig): RouteSamplingConfig {
  if (!Number.isFinite(sampling.sampleDistance) || sampling.sampleDistance <= 0) {
    throw new RangeError('sampleDistance must be a positive finite number');
  }
  if (!Number.isInteger(sampling.maxRawPoints) || sampling.maxRawPoints <= 0) {
    throw new RangeError('maxRawPoints must be a positive integer');
  }
  return Object.freeze({ ...sampling });
}

function copyPoints(points: readonly Point[]): readonly Point[] {
  return Object.freeze(points.map((point) => Object.freeze({ ...point })));
}

export function materializeRouteDraft(
  draft: Pick<RawRouteDraft, 'points' | 'start' | 'tip'>,
): readonly Point[] {
  const points = [...draft.points];
  const last = points.at(-1) ?? draft.start;
  if (
    draft.tip !== undefined &&
    (last === undefined || last.x !== draft.tip.x || last.y !== draft.tip.y)
  ) points.push(draft.tip);
  return copyPoints(points);
}

/**
 * Clips the already-travelled gesture prefix when the authoritative route start
 * has moved ahead of the original pointer gesture origin (for example while a
 * docked ship follows its guided departure lane). The returned suffix is still
 * raw authored/sample geometry; canonicalization happens exactly once later.
 */
export function materializeRouteDraftFromStart(
  draft: Pick<RawRouteDraft, 'points' | 'start' | 'tip'>,
  routeStart: Point,
): readonly Point[] {
  const points = materializeRouteDraft(draft);
  const gestureStart = draft.start;
  if (gestureStart === undefined || points.length === 0) return points;
  if (
    Math.hypot(routeStart.x - gestureStart.x, routeStart.y - gestureStart.y) <=
    ROUTE_POINT_EPSILON
  ) return points;

  const controls = [gestureStart, ...points];
  let bestSegmentIndex = 0;
  let bestT = 0;
  let bestDistanceSquared = Number.POSITIVE_INFINITY;

  for (let index = 0; index < controls.length - 1; index += 1) {
    const from = controls[index]!;
    const to = controls[index + 1]!;
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const lengthSquared = dx * dx + dy * dy;
    if (lengthSquared <= ROUTE_POINT_EPSILON * ROUTE_POINT_EPSILON) continue;
    const unclampedT = (
      (routeStart.x - from.x) * dx + (routeStart.y - from.y) * dy
    ) / lengthSquared;
    const t = Math.max(0, Math.min(1, unclampedT));
    const projectedX = from.x + dx * t;
    const projectedY = from.y + dy * t;
    const distanceSquared =
      (routeStart.x - projectedX) ** 2 + (routeStart.y - projectedY) ** 2;
    if (distanceSquared < bestDistanceSquared - ROUTE_POINT_EPSILON) {
      bestDistanceSquared = distanceSquared;
      bestSegmentIndex = index;
      bestT = t;
    }
  }

  let firstFutureControlIndex = bestSegmentIndex + 1;
  if (bestT >= 1 - ROUTE_POINT_EPSILON) {
    firstFutureControlIndex += 1;
  }
  return copyPoints(controls.slice(firstFutureControlIndex));
}

function copyLiveTip(active: ActiveRouteInteraction): { readonly tip?: Point } {
  const last = active.points.at(-1) ?? active.routeStart;
  const tip = active.lastWorldPosition;
  return last.x === tip.x && last.y === tip.y
    ? {} : { tip: Object.freeze({ ...tip }) };
}

export function isRouteInputState(state: ShipModel['state']): boolean {
  return (
    state === ShipState.Entering ||
    state === ShipState.Navigating ||
    state === ShipState.ReadyToLeave ||
    state === ShipState.Leaving
  );
}

export class RouteInputController {
  readonly #viewport: SquareWorldViewport;
  readonly #sampling: RouteSamplingConfig;
  readonly #processing: SimplifyConfig | undefined;
  readonly #hitTest: (worldPoint: Point, worldToCssPixelScale: number) => ShipModel | null;
  #active: ActiveRouteInteraction | null = null;

  public constructor(options: RouteInputControllerOptions) {
    this.#viewport = options.viewport;
    this.#sampling = assertSamplingConfig(options.sampling);
    this.#processing = options.processing;
    this.#hitTest = options.hitTest;
  }

  public get selectedShipId(): string | null {
    return this.#active?.ship.id ?? null;
  }

  public get activePointerId(): number | null {
    return this.#active?.pointerId ?? null;
  }

  public get activeDraftSnapshot(): ActiveRouteDraftSnapshot | null {
    const active = this.#active;
    if (active === null || !active.activated) {
      return null;
    }
    return Object.freeze({
      shipId: active.ship.id,
      pointerId: active.pointerId,
      ...this.#draftGeometry(active),
      start: Object.freeze({ ...active.routeStart }),
    });
  }

  public cancelActiveDraft(): RouteInputOutcome {
    if (this.#active === null) {
      return { kind: 'ignored' };
    }
    if (this.#active.activated) {
      return this.#finish();
    }
    this.#active = null;
    return { kind: 'cancelled' };
  }

  public rebaseActiveDraftToShip(): void {
    const active = this.#active;
    if (active === null || !active.activated) return;
    active.routeStart = { ...active.ship.position };
    active.gestureWorldOrigin = { ...active.lastWorldPosition };
    active.points.splice(0);
  }

  public pointerDown(input: NormalizedPointerInput): RouteInputOutcome {
    if (this.#active !== null) {
      return { kind: 'ignored' };
    }
    const worldPoint = this.#toWorld(input);
    if (worldPoint === null) {
      return { kind: 'ignored' };
    }
    const ship = this.#hitTest(worldPoint, input.worldToCssPixelScale);
    if (ship === null || !isRouteInputState(ship.state)) {
      return { kind: 'ignored' };
    }

    this.#active = {
      pointerId: input.pointerId,
      ship,
      initialCssPosition: { ...input.cssPosition },
      gestureWorldOrigin: { ...worldPoint },
      routeStart: { ...ship.position },
      points: [],
      lastWorldPosition: { ...worldPoint },
      activated: false,
    };
    return { kind: 'started', shipId: ship.id };
  }

  public pointerMove(input: NormalizedPointerInput): RouteInputOutcome {
    if (!this.#owns(input.pointerId)) return { kind: 'ignored' };
    const cancellation = this.#cancelIfActiveShipIsInputLocked();
    if (cancellation !== null) return cancellation;
    const worldPoint = this.#toWorld(input);
    if (worldPoint === null) return this.#finishAtWorldBoundary(input);
    if (!this.#activateIfThresholdReached(input)) {
      if (this.#active !== null) this.#active.lastWorldPosition = { ...worldPoint };
      return { kind: 'ignored' };
    }
    if (this.#active !== null) this.#active.lastWorldPosition = { ...worldPoint };
    if (!this.#sample(worldPoint)) return { kind: 'ignored' };
    return { kind: 'updated', pointCount: this.#active?.points.length ?? 0 };
  }

  public pointerUp(input: NormalizedPointerInput): RouteInputOutcome {
    if (!this.#owns(input.pointerId)) return { kind: 'ignored' };
    const cancellation = this.#cancelIfActiveShipIsInputLocked();
    if (cancellation !== null) return cancellation;
    const worldPoint = this.#toWorld(input);
    if (worldPoint === null) return this.#finishAtWorldBoundary(input);
    if (!this.#activateIfThresholdReached(input)) {
      return this.#tap();
    }
    if (this.#active !== null) this.#active.lastWorldPosition = { ...worldPoint };
    this.#sample(worldPoint);
    return this.#finish();
  }

  public pointerCancel(input: NormalizedPointerInput): RouteInputOutcome {
    if (!this.#owns(input.pointerId)) return { kind: 'ignored' };
    return this.cancelActiveDraft();
  }

  #owns(pointerId: number): boolean {
    return this.#active?.pointerId === pointerId;
  }

  #activateIfThresholdReached(input: NormalizedPointerInput): boolean {
    const active = this.#active;
    if (active === null) return false;
    if (active.activated) return true;
    const deltaX = input.cssPosition.x - active.initialCssPosition.x;
    const deltaY = input.cssPosition.y - active.initialCssPosition.y;
    if (deltaX * deltaX + deltaY * deltaY < ROUTE_DRAG_ACTIVATION_CSS_PX ** 2) {
      return false;
    }
    active.routeStart = { ...active.ship.position };
    active.points.splice(0);
    active.activated = true;
    return true;
  }

  #draftGeometry(active: ActiveRouteInteraction): {
    readonly points: readonly Point[];
    readonly tip?: Point;
  } {
    const tip = copyLiveTip(active);
    if (this.#processing === undefined) {
      return { points: copyPoints(active.points), ...tip };
    }
    return {
      points: copyPoints(simplifyRouteDraft({
        points: active.points,
        start: active.gestureWorldOrigin,
        ...tip,
      }, this.#processing)),
    };
  }

  #sample(point: Point): boolean {
    const active = this.#active;
    if (active === null || active.points.length >= this.#sampling.maxRawPoints) {
      return false;
    }
    const previous = active.points.at(-1);
    if (previous !== undefined && Math.hypot(point.x - previous.x, point.y - previous.y) <
      this.#sampling.sampleDistance) return false;
    active.points.push({ ...point });
    return true;
  }

  #tap(): RouteInputOutcome {
    const active = this.#active!;
    this.#active = null;
    return { kind: 'tapped', shipId: active.ship.id };
  }

  #finish(): RouteInputOutcome {
    const cancellation = this.#cancelIfActiveShipIsInputLocked();
    if (cancellation !== null) return cancellation;
    const active = this.#active;
    if (active === null) return { kind: 'ignored' };
    this.#active = null;
    return {
      kind: 'finished',
      draft: Object.freeze({
        shipId: active.ship.id,
        start: Object.freeze({ ...active.routeStart }),
        ...this.#draftGeometry(active),
      }),
    };
  }

  #toWorld(input: NormalizedPointerInput): Point | null {
    return this.#viewport.screenToWorld(
      input.screenPosition,
      input.internalViewport,
    );
  }

  #toUnboundedWorld(input: NormalizedPointerInput): Point {
    const layout = this.#viewport.layout(input.internalViewport);
    return {
      x: ((input.screenPosition.x - layout.x) * this.#viewport.logicalWorld.width) / layout.size,
      y: ((input.screenPosition.y - layout.y) * this.#viewport.logicalWorld.height) / layout.size,
    };
  }

  #finishAtWorldBoundary(input: NormalizedPointerInput): RouteInputOutcome {
    const active = this.#active;
    if (active === null) return { kind: 'ignored' };
    if (!this.#activateIfThresholdReached(input)) {
      this.#active = null;
      return { kind: 'cancelled' };
    }
    const boundaryPoint = this.#worldBoundaryIntersection(
      active.lastWorldPosition,
      this.#toUnboundedWorld(input),
    );
    if (boundaryPoint !== null) {
      active.lastWorldPosition = boundaryPoint;
      this.#appendBoundaryPoint(boundaryPoint);
    }
    return this.#finish();
  }

  #appendBoundaryPoint(point: Point): void {
    const active = this.#active;
    if (active === null) return;
    const previous = active.points.at(-1);
    if (previous?.x === point.x && previous.y === point.y) return;
    if (active.points.length < this.#sampling.maxRawPoints) {
      active.points.push({ ...point });
    } else if (active.points.length > 0) {
      active.points[active.points.length - 1] = { ...point };
    }
  }

  #worldBoundaryIntersection(from: Point, to: Point): Point | null {
    const width = this.#viewport.logicalWorld.width;
    const height = this.#viewport.logicalWorld.height;
    const deltaX = to.x - from.x;
    const deltaY = to.y - from.y;
    const candidates: { t: number; point: Point }[] = [];
    const addCandidate = (t: number, x: number, y: number): void => {
      if (t < 0 || t > 1 || x < 0 || x > width || y < 0 || y > height) return;
      candidates.push({
        t,
        point: {
          x: Math.min(Math.max(x, 0), width),
          y: Math.min(Math.max(y, 0), height),
        },
      });
    };
    if (deltaX !== 0) {
      for (const x of [0, width]) {
        const t = (x - from.x) / deltaX;
        addCandidate(t, x, from.y + deltaY * t);
      }
    }
    if (deltaY !== 0) {
      for (const y of [0, height]) {
        const t = (y - from.y) / deltaY;
        addCandidate(t, from.x + deltaX * t, y);
      }
    }
    candidates.sort((left, right) => left.t - right.t);
    return candidates[0]?.point ?? null;
  }

  #cancelIfActiveShipIsInputLocked(): RouteInputOutcome | null {
    if (this.#active !== null && !isRouteInputState(this.#active.ship.state)) {
      this.#active = null;
      return { kind: 'cancelled' };
    }
    return null;
  }
}
