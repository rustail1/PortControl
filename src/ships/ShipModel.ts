import type {
  ShipCharacteristics,
  ShipCharacteristicsRegistry,
} from './ShipCharacteristics.ts';
import { ShipState, type ShipState as ShipStateValue } from './ShipState.ts';
import { ShipRoute, type ShipRouteSnapshot } from './ShipRoute.ts';

export interface ShipPosition {
  readonly x: number;
  readonly y: number;
}

export interface ShipModelInit {
  readonly id: string;
  readonly characteristics: ShipCharacteristics;
  readonly position: ShipPosition;
  readonly rotationDeg: number;
  readonly state: ShipStateValue;
  readonly route?: ShipRouteSnapshot | null;
  readonly routeCursor?: number;
}

export interface ShipModelSnapshot {
  readonly id: string;
  readonly shipType: string;
  readonly position: ShipPosition;
  readonly rotationDeg: number;
  readonly state: ShipStateValue;
  readonly route: ShipRouteSnapshot | null;
  readonly routeCursor: number;
}

const shipStates = new Set<string>(Object.values(ShipState));

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

export function normalizeRotationDeg(rotationDeg: number): number {
  assertFinite(rotationDeg, 'rotationDeg');
  return ((rotationDeg % 360) + 360) % 360;
}

export class ShipModel {
  public readonly id: string;
  public readonly characteristics: ShipCharacteristics;
  #x: number;
  #y: number;
  #rotationDeg: number;
  #state: ShipStateValue;
  #route: ShipRoute | null;
  #routeCursor: number;

  public constructor(init: ShipModelInit) {
    if (!init.id) {
      throw new RangeError('id must not be empty');
    }
    assertFinite(init.position.x, 'position.x');
    assertFinite(init.position.y, 'position.y');
    if (!shipStates.has(init.state)) {
      throw new RangeError(`Unknown ship state: ${init.state}`);
    }

    this.id = init.id;
    this.characteristics = init.characteristics;
    this.#x = init.position.x;
    this.#y = init.position.y;
    this.#rotationDeg = normalizeRotationDeg(init.rotationDeg);
    this.#state = init.state;
    this.#route = init.route === undefined || init.route === null ? null : ShipRoute.restore(init.route);
    this.#routeCursor = this.#route === null ? 0 : Math.min(init.routeCursor ?? 0, this.#route.length);
  }

  public get position(): ShipPosition {
    return { x: this.#x, y: this.#y };
  }
  public get x(): number { return this.#x; }
  public get y(): number { return this.#y; }

  public get rotationDeg(): number {
    return this.#rotationDeg;
  }

  public get state(): ShipStateValue {
    return this.#state;
  }
  public get route(): ShipRoute | null { return this.#route; }
  public get routeCursor(): number { return this.#routeCursor; }
  public get currentWaypoint(): ShipPosition | null { return this.#route?.at(this.#routeCursor) ?? null; }
  public replaceRoute(route: ShipRoute): void { this.#route = route; this.#routeCursor = 0; }
  public advanceRouteCursor(): void { if (this.#route !== null && this.#routeCursor < this.#route.length) this.#routeCursor += 1; }

  public setPosition(position: ShipPosition): void {
    this.setPositionXY(position.x, position.y);
  }
  public setPositionXY(x: number, y: number): void {
    assertFinite(x, 'position.x');
    assertFinite(y, 'position.y');
    this.#x = x;
    this.#y = y;
  }

  public setRotationDeg(rotationDeg: number): void {
    this.#rotationDeg = normalizeRotationDeg(rotationDeg);
  }

  public setState(state: ShipStateValue): void {
    if (!shipStates.has(state)) {
      throw new RangeError(`Unknown ship state: ${state}`);
    }
    this.#state = state;
  }

  public toSnapshot(): ShipModelSnapshot {
    return {
      id: this.id,
      shipType: this.characteristics.type,
      position: this.position,
      rotationDeg: this.rotationDeg,
      state: this.state,
      route: this.#route?.toSnapshot() ?? null,
      routeCursor: this.#routeCursor,
    };
  }

  public static restore(
    snapshot: ShipModelSnapshot,
    characteristics: ShipCharacteristicsRegistry,
  ): ShipModel {
    return new ShipModel({
      id: snapshot.id,
      characteristics: characteristics.require(snapshot.shipType),
      position: snapshot.position,
      rotationDeg: snapshot.rotationDeg,
      state: snapshot.state,
      route: snapshot.route,
      routeCursor: snapshot.routeCursor,
    });
  }
}
