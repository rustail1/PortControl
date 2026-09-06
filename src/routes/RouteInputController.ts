import type { Point, Size } from '../camera/SquareWorldViewport.ts';
import { SquareWorldViewport } from '../camera/SquareWorldViewport.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import { ShipRoute } from '../ships/ShipRoute.ts';
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

export interface RawRouteDraft {
  readonly shipId: string;
  readonly points: readonly Point[];
  /** Gesture origin, used only to simplify its shape; commit starts at the live ship. */
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

const ROUTE_PROGRESS_EPSILON = 1e-9;

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
      points: copyPoints(active.points),
      start: Object.freeze({ ...active.routeStart }),
      ...copyLiveTip(active),
    });
  }

  public cancelActiveDraft(): RouteInputOutcome {
    if (this.#active === null) {
      return { kind: 'ignored' };
    }
    this.#active = null;
    return { kind: 'cancelled' };
  }

  public syncActiveDraftToShip(): void {
    this.#advanceActiveDraftProgress();
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
      routeStart: { ...worldPoint },
      points: [],
      lastWorldPosition: { ...worldPoint },
      activated: false,
    };
    return { kind: 'started', shipId: ship.id };
  }

  public pointerMove(input: NormalizedPointerInput): RouteInputOutcome {
    if (!this.#owns(input.pointerId)) {
      return { kind: 'ignored' };
    }
    const cancellation = this.#cancelIfActiveShipIsInputLocked();
    if (cancellation !== null) {
      return cancellation;
    }
    const worldPoint = this.#toWorld(input);
    if (worldPoint === null) {
      return this.#finishAtWorldBoundary(input);
    }
    if (!this.#activateIfThresholdReached(input)) {
      if (this.#active !== null) this.#active.lastWorldPosition = { ...worldPoint };
      return { kind: 'ignored' };
    }
    if (this.#active !== null) this.#active.lastWorldPosition = { ...worldPoint };
    const sampled = this.#sample(worldPoint);
    this.#advanceActiveDraftProgress();
    if (!sampled) {
      return { kind: 'ignored' };
    }
    return { kind: 'updated', pointCount: this.#active?.points.length ?? 0 };
  }

  public pointerUp(input: NormalizedPointerInput): RouteInputOutcome {
    if (!this.#owns(input.pointerId)) {
      return { kind: 'ignored' };
    }
    const cancellation = this.#cancelIfActiveShipIsInputLocked();
    if (cancellation !== null) {
      return cancellation;
    }
    const worldPoint = this.#toWorld(input);
    if (worldPoint === null) {
      return this.#finishAtWorldBoundary(input);
    }
    if (!this.#activateIfThresholdReached(input)) {
      const active = this.#active;
      this.#active = null;
      return active === null
        ? { kind: 'ignored' }
        : { kind: 'tapped', shipId: active.ship.id };
    }
    if (this.#active !== null) this.#active.lastWorldPosition = { ...worldPoint };
    this.#sample(worldPoint);
    return this.#finish();
  }

  public pointerCancel(input: NormalizedPointerInput): RouteInputOutcome {
    if (!this.#owns(input.pointerId)) {
      return { kind: 'ignored' };
    }
    this.#active = null;
    return { kind: 'cancelled' };
  }

  #toWorld(input: NormalizedPointerInput): Point | null {
    return this.#viewport.screenToWorld(input.screenPosition, input.internalViewport);
  }

  #toUnboundedWorld(input: NormalizedPointerInput): Point {
    const layout = this.#viewport.layout(input.internalViewport);
    return {
      x: ((input.screenPosition.x - layout.x) * this.#viewport.logicalWorld.width) / layout.size,
      y: ((input.screenPosition.y - layout.y) * this.#viewport.logicalWorld.height) / layout.size,
    };
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
    if (
      deltaX * deltaX + deltaY * deltaY <
      ROUTE_DRAG_ACTIVATION_CSS_PX ** 2
    ) {
      return false;
    }
    active.activated = true;
    return true;
  }

  #sample(point: Point): boolean {
    const active = this.#active;
    if (active === null || active.points.length >= this.#sampling.maxRawPoints) {
      return false;
    }
    const previous = active.points.at(-1);
    if (previous !== undefined) {
      const deltaX = point.x - previous.x;
      const deltaY = point.y - previous.y;
      if (
        deltaX * deltaX + deltaY * deltaY <
        this.#sampling.sampleDistance ** 2
      ) {
        return false;
      }
    }
    active.points.push({ ...point });
    return true;
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

  #finish(): RouteInputOutcome {
    const cancellation = this.#cancelIfActiveShipIsInputLocked();
    if (cancellation !== null) {
      return cancellation;
    }
    this.#advanceActiveDraftProgress();
    const active = this.#active;
    if (active === null) {
      return { kind: 'ignored' };
    }
    this.#active = null;
    return {
      kind: 'finished',
      draft: Object.freeze({
        shipId: active.ship.id,
        points: copyPoints(active.points),
        start: Object.freeze({ ...active.routeStart }),
        ...copyLiveTip(active),
      }),
    };
  }

  #advanceActiveDraftProgress(): void {
    const active = this.#active;
    if (active === null || !active.activated) return;
    const tip = copyLiveTip(active);
    const points = this.#processing === undefined
      ? [...active.points, ...(tip.tip === undefined ? [] : [tip.tip])]
      : simplifyRouteDraft({ points: active.points, start: active.routeStart, ...tip }, this.#processing);
    if (points.length === 0) return;
    const route = new ShipRoute(points, active.routeStart);
    let progress = 0;
    while (progress < route.totalLength) {
      const cursor = route.cursorAtDistance(progress);
      const segmentEnd = route.distanceAtCursor(cursor + 1);
      if (segmentEnd <= progress + ROUTE_PROGRESS_EPSILON) break;
      const projected = route.projectProgress(
        active.ship.position,
        progress,
        segmentEnd - progress,
      );
      progress = projected;
      if (progress < segmentEnd - ROUTE_PROGRESS_EPSILON) break;
    }
    if (progress <= ROUTE_PROGRESS_EPSILON) return;
    const projectedPoint = route.pointAtDistance(progress);
    // Lateral motion on the old route does not mean this draft's bend was passed.
    if (Math.hypot(
      active.ship.x - projectedPoint.x,
      active.ship.y - projectedPoint.y,
    ) > this.#sampling.sampleDistance + ROUTE_PROGRESS_EPSILON) return;
    const passed = route.cursorAtDistance(progress);
    if (passed === 0) return;
    // Preserve the simplification origin until a whole stable bend is passed.
    // Moving it along the first segment would relocate every future bend.
    let rawCount = 0;
    for (let index = 0; index < passed; index += 1) {
      const point = points[index]!;
      while (rawCount < active.points.length) {
        const raw = active.points[rawCount++]!;
        if (raw.x === point.x && raw.y === point.y) break;
      }
    }
    active.routeStart = points[passed - 1]!;
    active.points.splice(0, rawCount);
  }
}
