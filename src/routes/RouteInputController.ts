import type { Point, Size } from '../camera/SquareWorldViewport.ts';
import { SquareWorldViewport } from '../camera/SquareWorldViewport.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import { ShipState } from '../ships/ShipState.ts';
import type { SimplifyConfig } from './RouteSimplifier.ts';

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
  readonly #hitTest: (worldPoint: Point, worldToCssPixelScale: number) => ShipModel | null;
  #active: ActiveRouteInteraction | null = null;

  public constructor(options: RouteInputControllerOptions) {
    this.#viewport = options.viewport;
    this.#sampling = assertSamplingConfig(options.sampling);
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
      points: copyPoints(active.points),
      start: Object.freeze({ ...active.routeStart }),
      ...copyLiveTip(active),
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
      routeStart: { ...ship.position },
      points: [],
      lastWorldPosition: { ...worldPoint },
      activated: false,
    };
    return { kind: 'started', shipId: ship.id };
  }

  public pointerMove(input: NormalizedPointerInput): RouteInputOutcome {
    const active = this.#ownedActive(input.pointerId);
    if (active === null) return { kind: 'ignored' };
    const worldPoint = this.#toWorld(input);
    if (worldPoint === null) return this.#finish();
    active.lastWorldPosition = { ...worldPoint };
    if (!active.activated) {
      if (!this.#activationReached(active, input.cssPosition)) {
        return { kind: 'ignored' };
      }
      active.activated = true;
      active.routeStart = { ...active.ship.position };
      this.#appendSample(active, worldPoint);
      return { kind: 'updated', pointCount: active.points.length };
    }
    this.#appendSample(active, worldPoint);
    return { kind: 'updated', pointCount: active.points.length };
  }

  public pointerUp(input: NormalizedPointerInput): RouteInputOutcome {
    const active = this.#ownedActive(input.pointerId);
    if (active === null) return { kind: 'ignored' };
    const worldPoint = this.#toWorld(input);
    if (worldPoint !== null) {
      active.lastWorldPosition = { ...worldPoint };
      if (!active.activated && this.#activationReached(active, input.cssPosition)) {
        active.activated = true;
        active.routeStart = { ...active.ship.position };
        this.#appendSample(active, worldPoint);
      } else if (active.activated) {
        this.#appendSample(active, worldPoint);
      }
    }
    return active.activated
      ? this.#finish()
      : this.#tap();
  }

  public pointerCancel(input: NormalizedPointerInput): RouteInputOutcome {
    const active = this.#ownedActive(input.pointerId);
    if (active === null) return { kind: 'ignored' };
    return this.cancelActiveDraft();
  }

  #ownedActive(pointerId: number): ActiveRouteInteraction | null {
    return this.#active?.pointerId === pointerId ? this.#active : null;
  }

  #activationReached(active: ActiveRouteInteraction, cssPosition: Point): boolean {
    return Math.hypot(
      cssPosition.x - active.initialCssPosition.x,
      cssPosition.y - active.initialCssPosition.y,
    ) >= ROUTE_DRAG_ACTIVATION_CSS_PX;
  }

  #appendSample(active: ActiveRouteInteraction, point: Point): void {
    const previous = active.points.at(-1) ?? active.routeStart;
    if (
      Math.hypot(point.x - previous.x, point.y - previous.y) <
      this.#sampling.sampleDistance
    ) return;
    if (active.points.length < this.#sampling.maxRawPoints) {
      active.points.push({ ...point });
    }
  }

  #tap(): RouteInputOutcome {
    const active = this.#active!;
    this.#active = null;
    return { kind: 'tapped', shipId: active.ship.id };
  }

  #finish(): RouteInputOutcome {
    const active = this.#active!;
    this.#active = null;
    return {
      kind: 'finished',
      draft: Object.freeze({
        shipId: active.ship.id,
        start: Object.freeze({ ...active.routeStart }),
        points: copyPoints(active.points),
        ...copyLiveTip(active),
      }),
    };
  }

  #toWorld(input: NormalizedPointerInput): Point | null {
    return this.#viewport.internalToWorld(
      input.screenPosition,
      input.internalViewport,
    );
  }
}
