import type { Point, Size } from '../camera/SquareWorldViewport.ts';
import { SquareWorldViewport } from '../camera/SquareWorldViewport.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import { ShipState } from '../ships/ShipState.ts';

export interface RouteSamplingConfig {
  readonly sampleDistance: number;
  readonly maxRawPoints: number;
}

export interface NormalizedPointerInput {
  readonly source: 'mouse' | 'touch';
  readonly pointerId: number;
  readonly screenPosition: Point;
  readonly viewport: Size;
}

export interface RawRouteDraft {
  readonly shipId: string;
  readonly points: readonly Point[];
}

export interface ActiveRouteDraftSnapshot {
  readonly shipId: string;
  readonly pointerId: number;
  readonly points: readonly Point[];
}

export interface RouteInputControllerOptions {
  readonly viewport: SquareWorldViewport;
  readonly sampling: RouteSamplingConfig;
  readonly hitTest: (worldPoint: Point, viewport: Size) => ShipModel | null;
}

export type RouteInputOutcome =
  | { readonly kind: 'ignored' }
  | { readonly kind: 'started'; readonly shipId: string }
  | { readonly kind: 'updated'; readonly pointCount: number }
  | { readonly kind: 'finished'; readonly draft: RawRouteDraft }
  | { readonly kind: 'cancelled' };

interface ActiveRouteDraft {
  readonly pointerId: number;
  readonly ship: ShipModel;
  readonly points: Point[];
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
  readonly #hitTest: (worldPoint: Point, viewport: Size) => ShipModel | null;
  #active: ActiveRouteDraft | null = null;

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
    if (active === null) {
      return null;
    }
    return Object.freeze({
      shipId: active.ship.id,
      pointerId: active.pointerId,
      points: copyPoints(active.points),
    });
  }

  public cancelActiveDraft(): RouteInputOutcome {
    if (this.#active === null) {
      return { kind: 'ignored' };
    }
    this.#active = null;
    return { kind: 'cancelled' };
  }

  public pointerDown(input: NormalizedPointerInput): RouteInputOutcome {
    if (this.#active !== null) {
      return { kind: 'ignored' };
    }
    const worldPoint = this.#toWorld(input);
    if (worldPoint === null) {
      return { kind: 'ignored' };
    }
    const ship = this.#hitTest(worldPoint, input.viewport);
    if (ship === null || !isRouteInputState(ship.state)) {
      return { kind: 'ignored' };
    }

    this.#active = { pointerId: input.pointerId, ship, points: [] };
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
      return this.#finish();
    }
    if (!this.#sample(worldPoint)) {
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
    if (worldPoint !== null) {
      this.#sample(worldPoint);
    }
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
    return this.#viewport.screenToWorld(input.screenPosition, input.viewport);
  }

  #owns(pointerId: number): boolean {
    return this.#active?.pointerId === pointerId;
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
      }),
    };
  }
}
