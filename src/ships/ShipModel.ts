import type {
  ShipCharacteristics,
  ShipCharacteristicsRegistry,
} from './ShipCharacteristics.ts';
import { ShipState, type ShipState as ShipStateValue } from './ShipState.ts';
import { canTransitionShip, type ShipTransitionReason } from './ShipLifecycle.ts';
import { ShipRoute, type ShipRouteSnapshot } from './ShipRoute.ts';
import type { ShipPosition } from '../shared/geometry/Point.ts';

export type { ShipPosition } from '../shared/geometry/Point.ts';

export type CargoManifest = Readonly<Record<string, number>>;

export const RouteTurnMode = {
  Reorientation: 'reorientation',
  AuthoredReversal: 'authored_reversal',
} as const;

export type RouteTurnMode = (typeof RouteTurnMode)[keyof typeof RouteTurnMode];

export const LandRecoveryMotion = {
  Arc: 'arc',
  Pivot: 'pivot',
} as const;

export type LandRecoveryMotion = (typeof LandRecoveryMotion)[keyof typeof LandRecoveryMotion];

const landRecoveryMotions = new Set<string>(Object.values(LandRecoveryMotion));
const routeTurnModes = new Set<string>(Object.values(RouteTurnMode));

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
  readonly routeTurnMode?: RouteTurnMode;
  readonly routeMotionHeld?: boolean;
  readonly routeRecoveryHeadingDeg?: number;
  readonly landRecoveryHeadingDeg?: number;
  readonly landRecoveryTurnSign?: -1 | 1;
  readonly landRecoveryMotion?: LandRecoveryMotion;
  readonly routeRevision?: number;
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
  readonly routeTurnMode?: RouteTurnMode;
  readonly routeMotionHeld?: boolean;
  readonly routeRecoveryHeadingDeg?: number;
  readonly landRecoveryHeadingDeg?: number;
  readonly landRecoveryTurnSign?: -1 | 1;
  readonly landRecoveryMotion?: LandRecoveryMotion;
  readonly routeRevision?: number;
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
  #routeTurnMode: RouteTurnMode | null;
  #routeMotionHeld: boolean;
  #routeRecoveryHeadingDeg: number | null;
  #landRecoveryHeadingDeg: number | null;
  #landRecoveryTurnSign: -1 | 1 | null;
  #landRecoveryMotion: LandRecoveryMotion | null;
  #routeRevision: number;

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
    const hasRoutePivotProgress = init.routePivotProgress !== undefined;
    const hasRouteTurnMode = init.routeTurnMode !== undefined;
    if (hasRoutePivotProgress !== hasRouteTurnMode) {
      throw new RangeError('routePivotProgress and routeTurnMode must be provided together');
    }
    if (hasRouteTurnMode && !routeTurnModes.has(init.routeTurnMode as string)) {
      throw new RangeError(`Unknown routeTurnMode: ${String(init.routeTurnMode)}`);
    }
    if (hasRoutePivotProgress && (
      !Number.isFinite(init.routePivotProgress) || init.routePivotProgress! < 0 || this.#route === null
    )) {
      throw new RangeError('routePivotProgress requires a route and non-negative finite progress');
    }
    this.#routePivotProgress = init.routePivotProgress === undefined
      ? null
      : Math.min(init.routePivotProgress, this.#route!.totalLength);
    this.#routeTurnMode = init.routeTurnMode ?? null;
    this.#routeMotionHeld = init.routeMotionHeld ?? false;
    this.#routeRecoveryHeadingDeg = init.routeRecoveryHeadingDeg === undefined
      ? null
      : normalizeRotationDeg(init.routeRecoveryHeadingDeg);
    const landRecoveryFields = [
      init.landRecoveryHeadingDeg,
      init.landRecoveryTurnSign,
      init.landRecoveryMotion,
    ];
    const landRecoveryFieldCount = landRecoveryFields.filter((value) => value !== undefined).length;
    if (landRecoveryFieldCount !== 0 && landRecoveryFieldCount !== landRecoveryFields.length) {
      throw new RangeError('land recovery heading, turn sign, and motion must be provided together');
    }
    if (init.landRecoveryTurnSign !== undefined && init.landRecoveryTurnSign !== -1 && init.landRecoveryTurnSign !== 1) {
      throw new RangeError('land recovery turn sign must be -1 or 1');
    }
    if (init.landRecoveryMotion !== undefined && !landRecoveryMotions.has(init.landRecoveryMotion)) {
      throw new RangeError(`Unknown land recovery motion: ${String(init.landRecoveryMotion)}`);
    }
    if (landRecoveryFieldCount > 0 && this.#routeRecoveryHeadingDeg !== null) {
      throw new RangeError('land recovery and boundary route recovery cannot be active together');
    }
    if (landRecoveryFieldCount > 0 && this.#route !== null) {
      throw new RangeError('land recovery snapshot cannot carry an authored route');
    }
    this.#landRecoveryHeadingDeg = init.landRecoveryHeadingDeg === undefined
      ? null
      : normalizeRotationDeg(init.landRecoveryHeadingDeg);
    this.#landRecoveryTurnSign = init.landRecoveryTurnSign ?? null;
    this.#landRecoveryMotion = init.landRecoveryMotion ?? null;
    const initialRouteRevision = init.routeRevision ?? (this.#route === null ? 0 : 1);
    if (!Number.isSafeInteger(initialRouteRevision) || initialRouteRevision < 0) {
      throw new RangeError('routeRevision must be a non-negative safe integer');
    }
    this.#routeRevision = initialRouteRevision;
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
  public get routeTurnMode(): RouteTurnMode | null { return this.#routeTurnMode; }
  public get routeMotionHeld(): boolean { return this.#routeMotionHeld; }
  public get routeRecoveryHeadingDeg(): number | null { return this.#routeRecoveryHeadingDeg; }
  public get landRecoveryHeadingDeg(): number | null { return this.#landRecoveryHeadingDeg; }
  public get landRecoveryTurnSign(): -1 | 1 | null { return this.#landRecoveryTurnSign; }
  public get landRecoveryMotion(): LandRecoveryMotion | null { return this.#landRecoveryMotion; }
  public get routeRevision(): number { return this.#routeRevision; }
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
    this.#routeTurnMode = null;
    this.#routeMotionHeld = false;
    this.#routeRecoveryHeadingDeg = null;
    this.#landRecoveryHeadingDeg = null;
    this.#landRecoveryTurnSign = null;
    this.#landRecoveryMotion = null;
    this.#routeRevision += 1;
  }
  public clearRoute(): void {
    this.#route = null;
    this.#routeCursor = 0;
    this.#routeProgress = 0;
    this.#routeSpeed = 0;
    this.#routePivotProgress = null;
    this.#routeTurnMode = null;
    this.#routeMotionHeld = true;
    this.#routeRecoveryHeadingDeg = null;
    this.#landRecoveryHeadingDeg = null;
    this.#landRecoveryTurnSign = null;
    this.#landRecoveryMotion = null;
    this.#routeRevision += 1;
  }
  public beginRouteRecovery(headingDeg: number): void {
    this.clearRoute();
    this.#routeRecoveryHeadingDeg = normalizeRotationDeg(headingDeg);
  }
  public finishRouteRecovery(): void {
    this.#routeRecoveryHeadingDeg = null;
    this.#routeMotionHeld = false;
  }
  public beginLandRecovery(
    headingDeg: number,
    turnSign: -1 | 1,
    motion: LandRecoveryMotion,
  ): void {
    if (this.#route !== null && this.#routeProgress < this.#route.totalLength - 1e-7) {
      throw new Error('land recovery requires an absent or fully consumed authored route');
    }
    this.#beginLandRecovery(headingDeg, turnSign, motion);
  }
  public beginLandRecoveryFromRouteHazard(
    headingDeg: number,
    turnSign: -1 | 1,
    motion: LandRecoveryMotion,
  ): void {
    if (this.#route === null || this.#routeProgress >= this.#route.totalLength - 1e-7) {
      throw new Error('route-hazard land recovery requires an unfinished authored route');
    }
    this.#beginLandRecovery(headingDeg, turnSign, motion);
  }
  #beginLandRecovery(
    headingDeg: number,
    turnSign: -1 | 1,
    motion: LandRecoveryMotion,
  ): void {
    if (turnSign !== -1 && turnSign !== 1) {
      throw new RangeError('land recovery turn sign must be -1 or 1');
    }
    if (!landRecoveryMotions.has(motion)) {
      throw new RangeError(`Unknown land recovery motion: ${String(motion)}`);
    }
    if (this.#routeRecoveryHeadingDeg !== null) {
      throw new Error('land recovery cannot start during boundary route recovery');
    }
    if (this.#route !== null) {
      this.#route = null;
      this.#routeCursor = 0;
      this.#routeProgress = 0;
      this.#routePivotProgress = null;
      this.#routeTurnMode = null;
      this.#routeMotionHeld = false;
      this.#routeRevision += 1;
    }
    this.#landRecoveryHeadingDeg = normalizeRotationDeg(headingDeg);
    this.#landRecoveryTurnSign = turnSign;
    this.#landRecoveryMotion = motion;
  }
  public finishLandRecovery(): void {
    this.#landRecoveryHeadingDeg = null;
    this.#landRecoveryTurnSign = null;
    this.#landRecoveryMotion = null;
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

  public beginRouteTurn(mode: RouteTurnMode, progress: number): void {
    if (!routeTurnModes.has(mode)) {
      throw new RangeError(`Unknown route turn mode: ${String(mode)}`);
    }
    if (this.#route === null || !Number.isFinite(progress)) {
      throw new RangeError('route turn requires a route and finite progress');
    }
    this.#routePivotProgress = Math.min(Math.max(progress, 0), this.#route.totalLength);
    this.#routeTurnMode = mode;
    this.#routeSpeed = 0;
  }

  public finishRouteTurn(): void {
    this.#routePivotProgress = null;
    this.#routeTurnMode = null;
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

  #transition(state: ShipStateValue, reason: ShipTransitionReason): void {
    if (!shipStates.has(state)) throw new RangeError(`Unknown ship state: ${state}`);
    if (!canTransitionShip(this.#state, state, reason)) {
      throw new Error(`Invalid ship transition: ${this.#state} -> ${state} (${reason})`);
    }
    this.#state = state;
  }

  public beginNavigationFromRoute(): void { this.#transition(ShipState.Navigating, 'route_committed'); }
  public beginDockApproach(): void { this.#transition(ShipState.ApproachingDock, 'dock_reserved'); }
  public beginDocking(): void { this.#transition(ShipState.Docking, 'harbor_assist_started'); }
  public beginUnloading(): void { this.#transition(ShipState.Unloading, 'berth_lock_completed'); }
  public finishCargoService(input: { readonly cargoRemaining: boolean }): void {
    this.#transition(input.cargoRemaining ? ShipState.Navigating : ShipState.ReadyToLeave, input.cargoRemaining ? 'cargo_partial_complete' : 'cargo_fully_complete');
  }
  public beginLeaving(): void { this.#transition(ShipState.Leaving, 'departure_started'); }
  public rejectExitWithCargo(): void { this.#transition(ShipState.Navigating, 'exit_rejected_cargo'); }
  public destroy(reason: 'collision' | 'grounding'): void {
    if (this.#state === ShipState.Destroyed) return;
    this.#transition(ShipState.Destroyed, reason === 'collision' ? 'terminal_collision' : 'terminal_grounding');
    this.#routeSpeed = 0;
    this.#routeMotionHeld = true;
    this.#landRecoveryHeadingDeg = null;
    this.#landRecoveryTurnSign = null;
    this.#landRecoveryMotion = null;
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
        : {
            routePivotProgress: this.#routePivotProgress,
            routeTurnMode: this.#routeTurnMode!,
          }),
      ...(this.#routeMotionHeld ? { routeMotionHeld: true } : {}),
      ...(this.#routeRecoveryHeadingDeg === null
        ? {}
        : { routeRecoveryHeadingDeg: this.#routeRecoveryHeadingDeg }),
      ...(this.#landRecoveryHeadingDeg === null
        ? {}
        : {
            landRecoveryHeadingDeg: this.#landRecoveryHeadingDeg,
            landRecoveryTurnSign: this.#landRecoveryTurnSign!,
            landRecoveryMotion: this.#landRecoveryMotion!,
          }),
      ...(this.#routeRevision === (this.#route === null ? 0 : 1)
        ? {}
        : { routeRevision: this.#routeRevision }),
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
      routeTurnMode: snapshot.routeTurnMode,
      routeMotionHeld: snapshot.routeMotionHeld,
      routeRecoveryHeadingDeg: snapshot.routeRecoveryHeadingDeg,
      landRecoveryHeadingDeg: snapshot.landRecoveryHeadingDeg,
      landRecoveryTurnSign: snapshot.landRecoveryTurnSign,
      landRecoveryMotion: snapshot.landRecoveryMotion,
      routeRevision: snapshot.routeRevision,
    });
  }
}
