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

export type CargoManifest = Readonly<Record<string, number>>;

export interface ShipModelInit {
  readonly id: string;
  readonly characteristics: ShipCharacteristics;
  readonly position: ShipPosition;
  readonly rotationDeg: number;
  readonly state: ShipStateValue;
  readonly cargo?: CargoManifest;
  readonly route?: ShipRouteSnapshot | null;
  readonly routeCursor?: number;
  readonly routeProgress?: number;
  readonly routeSpeed?: number;
  readonly routePivotProgress?: number;
  readonly routeMotionHeld?: boolean;
  readonly routeRecoveryHeadingDeg?: number;
}

export interface ShipModelSnapshot {
  readonly id: string;
  readonly shipType: string;
  readonly position: ShipPosition;
  readonly rotationDeg: number;
  readonly state: ShipStateValue;
  readonly cargo: CargoManifest;
  readonly route: ShipRouteSnapshot | null;
  readonly routeCursor: number;
  readonly routeProgress: number;
  readonly routeSpeed?: number;
  readonly routePivotProgress?: number;
  readonly routeMotionHeld?: boolean;
  readonly routeRecoveryHeadingDeg?: number;
}

const shipStates = new Set<string>(Object.values(ShipState));

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

function copyCargo(cargo: CargoManifest | undefined): CargoManifest {
  const copied: Record<string, number> = {};
  for (const [cargoType, quantity] of Object.entries(cargo ?? {})) {
    assertFinite(quantity, `cargo.${cargoType}`);
    if (quantity < 0) {
      throw new RangeError(`cargo.${cargoType} must not be negative`);
    }
    copied[cargoType] = quantity;
  }
  return Object.freeze(copied);
}

function defaultRouteSpeed(
  characteristics: ShipCharacteristics,
  state: ShipStateValue,
): number {
  return state === ShipState.ReadyToLeave ||
    state === ShipState.Docking || state === ShipState.Unloading
    ? 0
    : characteristics.speed;
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
  #cargo: CargoManifest;
  #route: ShipRoute | null;
  #routeCursor: number;
  #routeProgress: number;
  #routeSpeed: number;
  #routePivotProgress: number | null;
  #routeMotionHeld: boolean;
  #routeRecoveryHeadingDeg: number | null;

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
    this.#cargo = copyCargo(init.cargo);
    this.#route = init.route === undefined || init.route === null
      ? null
      : ShipRoute.restore(init.route, init.position);
    this.#routeProgress = this.#route === null
      ? 0
      : Math.min(
          Math.max(
            init.routeProgress ?? this.#route.distanceAtCursor(init.routeCursor ?? 0),
            0,
          ),
          this.#route.totalLength,
        );
    this.#routeCursor = this.#route?.cursorAtDistance(this.#routeProgress) ?? 0;
    this.#routeSpeed = init.routeSpeed ?? defaultRouteSpeed(this.characteristics, init.state);
    if (!Number.isFinite(this.#routeSpeed) || this.#routeSpeed < 0) {
      throw new RangeError('routeSpeed must be a non-negative finite number');
    }
    this.#routeSpeed = Math.min(this.#routeSpeed, this.characteristics.speed);
    if (init.routePivotProgress !== undefined && (
      !Number.isFinite(init.routePivotProgress) || init.routePivotProgress < 0 || this.#route === null
    )) {
      throw new RangeError('routePivotProgress requires a route and non-negative finite progress');
    }
    this.#routePivotProgress = init.routePivotProgress === undefined
      ? null
      : Math.min(init.routePivotProgress, this.#route!.totalLength);
    this.#routeMotionHeld = init.routeMotionHeld ?? false;
    this.#routeRecoveryHeadingDeg = init.routeRecoveryHeadingDeg === undefined
      ? null
      : normalizeRotationDeg(init.routeRecoveryHeadingDeg);
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
  public get cargo(): CargoManifest { return this.#cargo; }
  public cargoQuantity(type: string): number { return this.#cargo[type] ?? 0; }
  public get cargoTotal(): number { return Object.values(this.#cargo).reduce((total, quantity) => total + quantity, 0); }
  public removeCargoUnit(type: string): boolean {
    const quantity = this.cargoQuantity(type);
    if (quantity <= 0) return false;
    this.#cargo = copyCargo({ ...this.#cargo, [type]: quantity - 1 });
    return true;
  }
  public get route(): ShipRoute | null { return this.#route; }
  public get routeCursor(): number { return this.#routeCursor; }
  public get routeProgress(): number { return this.#routeProgress; }
  public get routeSpeed(): number { return this.#routeSpeed; }
  public get routePivotProgress(): number | null { return this.#routePivotProgress; }
  public get routeMotionHeld(): boolean { return this.#routeMotionHeld; }
  public get routeRecoveryHeadingDeg(): number | null { return this.#routeRecoveryHeadingDeg; }
  public get currentWaypoint(): ShipPosition | null { return this.#route?.at(this.#routeCursor) ?? null; }
  public replaceRoute(
    route: ShipRoute,
    start: ShipPosition = this.position,
    progress = 0,
  ): void {
    if (!Number.isFinite(progress) || progress < 0) {
      throw new RangeError('route progress must be a non-negative finite number');
    }
    this.#route = route.withStart(start);
    this.#routeProgress = Math.min(progress, this.#route.totalLength);
    this.#routeCursor = this.#route.cursorAtDistance(this.#routeProgress);
    this.#routePivotProgress = null;
    this.#routeMotionHeld = false;
    this.#routeRecoveryHeadingDeg = null;
  }
  public clearRoute(): void {
    this.#route = null;
    this.#routeCursor = 0;
    this.#routeProgress = 0;
    this.#routeSpeed = 0;
    this.#routePivotProgress = null;
    this.#routeMotionHeld = true;
    this.#routeRecoveryHeadingDeg = null;
  }
  public beginRouteRecovery(headingDeg: number): void {
    this.clearRoute();
    this.#routeRecoveryHeadingDeg = normalizeRotationDeg(headingDeg);
  }
  public finishRouteRecovery(): void {
    this.#routeRecoveryHeadingDeg = null;
    this.#routeMotionHeld = false;
  }
  public holdRouteMotion(): void {
    if (this.#route !== null) this.#routeMotionHeld = true;
  }
  public resumeHeldRouteAtCurrentPosition(): boolean {
    if (this.#route === null) {
      this.#routeMotionHeld = false;
      return false;
    }
    const expected = this.#route.pointAtDistance(this.#routeProgress);
    if (Math.hypot(expected.x - this.#x, expected.y - this.#y) > 1e-6) {
      return false;
    }
    this.#routeMotionHeld = false;
    this.#routeRecoveryHeadingDeg = null;
    return true;
  }
  public advanceRouteCursor(): void {
    if (this.#route === null || this.#routeCursor >= this.#route.length) return;
    this.advanceRouteProgress(this.#route.distanceAtCursor(this.#routeCursor + 1));
  }
  public advanceRouteProgress(progress: number): void {
    if (this.#route === null) return;
    if (!Number.isFinite(progress)) throw new RangeError('route progress must be finite');
    this.#routeProgress = Math.min(
      Math.max(this.#routeProgress, progress),
      this.#route.totalLength,
    );
    this.#routeCursor = this.#route.cursorAtDistance(this.#routeProgress);
  }

  public setRouteSpeed(speed: number): void {
    if (!Number.isFinite(speed) || speed < 0) {
      throw new RangeError('route speed must be a non-negative finite number');
    }
    this.#routeSpeed = Math.min(speed, this.characteristics.speed);
  }

  public beginRoutePivot(progress: number): void {
    if (this.#route === null || !Number.isFinite(progress)) {
      throw new RangeError('route pivot requires a route and finite progress');
    }
    this.#routePivotProgress = Math.min(Math.max(progress, 0), this.#route.totalLength);
    this.#routeSpeed = 0;
  }

  public finishRoutePivot(): void {
    this.#routePivotProgress = null;
  }

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
      cargo: copyCargo(this.#cargo),
      route: this.#route?.toSnapshot() ?? null,
      routeCursor: this.#routeCursor,
      routeProgress: this.#routeProgress,
      ...(Math.abs(this.#routeSpeed - defaultRouteSpeed(this.characteristics, this.#state)) > 1e-9
        ? { routeSpeed: this.#routeSpeed }
        : {}),
      ...(this.#routePivotProgress === null
        ? {}
        : { routePivotProgress: this.#routePivotProgress }),
      ...(this.#routeMotionHeld ? { routeMotionHeld: true } : {}),
      ...(this.#routeRecoveryHeadingDeg === null
        ? {}
        : { routeRecoveryHeadingDeg: this.#routeRecoveryHeadingDeg }),
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
      cargo: snapshot.cargo,
      route: snapshot.route,
      routeCursor: snapshot.routeCursor,
      routeProgress: snapshot.routeProgress,
      routeSpeed: snapshot.routeSpeed,
      routePivotProgress: snapshot.routePivotProgress,
      routeMotionHeld: snapshot.routeMotionHeld,
      routeRecoveryHeadingDeg: snapshot.routeRecoveryHeadingDeg,
    });
  }
}
