import { normalizeRotationDeg, type ShipModel } from '../ships/ShipModel.ts';
import type { LandClearanceGeometry } from '../geometry/LandClearanceGeometry.ts';
import { moveAngleTowardsDeg } from '../ships/ShipMotor.ts';
import { ShipRoute } from '../ships/ShipRoute.ts';
import { ShipState } from '../ships/ShipState.ts';
import type { DockCollection, DockModel } from './DockModel.ts';
import type { DockingConfig } from './DockingConfig.ts';
import type { DockSystem } from './DockSystem.ts';

export interface DockApproachCandidate {
  readonly ship: ShipModel;
  readonly spawnSequence: number;
}

export interface DockingControllerOptions {
  readonly docks: DockCollection;
  readonly dockSystem: DockSystem;
  readonly config: DockingConfig;
  readonly resolveSnapDurationMs?: (baseSnapDurationMs: number) => number;
  readonly landGeometry?: LandClearanceGeometry;
  readonly navigationClearanceExtra?: number;
}

export interface DockingStepResult {
  readonly reservedShipIds: readonly string[];
  readonly startedShipIds: readonly string[];
  readonly completedShipIds: readonly string[];
  readonly cancelledShipIds: readonly string[];
  readonly invariantShipIds: readonly string[];
}

export interface DockLane {
  readonly approach: { readonly x: number; readonly y: number };
  readonly berth: { readonly x: number; readonly y: number };
  readonly release: { readonly x: number; readonly y: number };
}

interface TransactionIdentity {
  readonly shipId: string;
  readonly dockId: string;
  readonly ship: ShipModel;
}

interface AwaitingSnap extends TransactionIdentity {
  readonly phase: 'awaiting_snap';
}

interface Snapping extends TransactionIdentity {
  readonly phase: 'snapping';
  readonly startX: number;
  readonly startY: number;
  readonly startRotationDeg: number;
  readonly approachX: number;
  readonly approachY: number;
  readonly splitProgress: number;
  readonly progress: number;
  readonly curveLength: number;
}

interface Departing extends TransactionIdentity {
  readonly phase: 'departing';
  readonly route: ShipRoute;
  readonly startX: number;
  readonly startY: number;
  readonly releaseX: number;
  readonly releaseY: number;
  readonly elapsedMs: number;
  readonly durationMs: number;
}

type DockingTransaction = AwaitingSnap | Snapping | Departing;

interface Nomination {
  readonly candidate: DockApproachCandidate;
  readonly dock: DockModel;
  readonly distanceSquared: number;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNomination(left: Nomination, right: Nomination): number {
  return left.distanceSquared - right.distanceSquared
    || left.candidate.spawnSequence - right.candidate.spawnSequence;
}

function cubicBezier(start: number, control1: number, control2: number, end: number, t: number): number {
  const inverse = 1 - t;
  return inverse ** 3 * start +
    3 * inverse ** 2 * t * control1 +
    3 * inverse * t ** 2 * control2 +
    t ** 3 * end;
}

export function deriveDockLane(
  definition: DockModel['definition'],
  landGeometry?: LandClearanceGeometry,
  clearance = 0,
): DockLane {
  if (!Number.isFinite(clearance) || clearance < 0) {
    throw new RangeError('dock lane clearance must be non-negative and finite');
  }
  const radians = definition.dockAngle * Math.PI / 180;
  const outwardX = Math.cos(radians);
  const outwardY = Math.sin(radians);
  let waterPoint: { readonly x: number; readonly y: number } | null = null;
  for (let multiplier = 1; multiplier <= 1024; multiplier += 1) {
    const candidate = {
      x: definition.position.x + outwardX * definition.snapRadius * multiplier,
      y: definition.position.y + outwardY * definition.snapRadius * multiplier,
    };
    if (landGeometry === undefined || !landGeometry.blocksSegment(candidate, candidate, clearance)) {
      waterPoint = Object.freeze(candidate);
      break;
    }
  }
  if (waterPoint === null) throw new Error(`dock ${definition.id} has no navigable lane point`);
  return Object.freeze({
    approach: waterPoint,
    berth: Object.freeze({ ...definition.position }),
    release: waterPoint,
  });
}

function cubicPoint(
  start: { readonly x: number; readonly y: number },
  control1: { readonly x: number; readonly y: number },
  control2: { readonly x: number; readonly y: number },
  end: { readonly x: number; readonly y: number },
  progress: number,
): { readonly position: { readonly x: number; readonly y: number }; readonly headingDeg: number } {
  const inverse = 1 - progress;
  const tangentX = 3 * inverse ** 2 * (control1.x - start.x) +
    6 * inverse * progress * (control2.x - control1.x) +
    3 * progress ** 2 * (end.x - control2.x);
  const tangentY = 3 * inverse ** 2 * (control1.y - start.y) +
    6 * inverse * progress * (control2.y - control1.y) +
    3 * progress ** 2 * (end.y - control2.y);
  return {
    position: {
      x: cubicBezier(start.x, control1.x, control2.x, end.x, progress),
      y: cubicBezier(start.y, control1.y, control2.y, end.y, progress),
    },
    headingDeg: normalizeRotationDeg(Math.atan2(tangentY, tangentX) * 180 / Math.PI),
  };
}

function distanceSquared(ship: ShipModel, dock: DockModel): number {
  const dx = ship.x - dock.definition.position.x;
  const dy = ship.y - dock.definition.position.y;
  return dx * dx + dy * dy;
}

const DOCK_CURVE_LENGTH_SAMPLES = 64;
const DOCK_TURN_PROGRESS_ITERATIONS = 24;

type SnapPath = Pick<
  Snapping,
  'startX' | 'startY' | 'startRotationDeg' | 'approachX' | 'approachY' | 'splitProgress'
>;

function sampleSnapPath(
  path: SnapPath,
  lane: DockLane,
  progress: number,
): ReturnType<typeof cubicPoint> {
  const inwardRadians = Math.atan2(
    lane.berth.y - lane.approach.y,
    lane.berth.x - lane.approach.x,
  );
  const inward = { x: Math.cos(inwardRadians), y: Math.sin(inwardRadians) };
  if (path.splitProgress > 1e-9 && progress <= path.splitProgress) {
    const localProgress = progress / path.splitProgress;
    const start = { x: path.startX, y: path.startY };
    const approach = { x: path.approachX, y: path.approachY };
    const distance = Math.hypot(approach.x - start.x, approach.y - start.y);
    const startRadians = path.startRotationDeg * Math.PI / 180;
    return cubicPoint(
      start,
      {
        x: start.x + Math.cos(startRadians) * distance / 3,
        y: start.y + Math.sin(startRadians) * distance / 3,
      },
      {
        x: approach.x - inward.x * distance / 3,
        y: approach.y - inward.y * distance / 3,
      },
      approach,
      localProgress,
    );
  }
  const denominator = 1 - path.splitProgress;
  const localProgress = denominator <= 1e-9
    ? 1
    : (progress - path.splitProgress) / denominator;
  const distance = Math.hypot(
    lane.berth.x - lane.approach.x,
    lane.berth.y - lane.approach.y,
  );
  return cubicPoint(
    lane.approach,
    {
      x: lane.approach.x + inward.x * distance / 3,
      y: lane.approach.y + inward.y * distance / 3,
    },
    {
      x: lane.berth.x - inward.x * distance / 3,
      y: lane.berth.y - inward.y * distance / 3,
    },
    lane.berth,
    Math.min(Math.max(localProgress, 0), 1),
  );
}

function measureSnapPath(path: SnapPath, lane: DockLane): number {
  let length = 0;
  let previous = sampleSnapPath(path, lane, 0).position;
  for (let index = 1; index <= DOCK_CURVE_LENGTH_SAMPLES; index += 1) {
    const current = sampleSnapPath(
      path,
      lane,
      index / DOCK_CURVE_LENGTH_SAMPLES,
    ).position;
    length += Math.hypot(current.x - previous.x, current.y - previous.y);
    previous = current;
  }
  return length;
}

function angleDistanceDeg(left: number, right: number): number {
  return Math.abs(((right - left + 540) % 360) - 180);
}

function turnLimitedSnapProgress(
  path: Snapping,
  lane: DockLane,
  desiredProgress: number,
  currentHeadingDeg: number,
  maximumTurnDeg: number,
): number {
  if (
    angleDistanceDeg(
      currentHeadingDeg,
      sampleSnapPath(path, lane, desiredProgress).headingDeg,
    ) <= maximumTurnDeg
  ) return desiredProgress;
  let reachable = path.progress;
  let unreachable = desiredProgress;
  for (let iteration = 0; iteration < DOCK_TURN_PROGRESS_ITERATIONS; iteration += 1) {
    const candidate = (reachable + unreachable) / 2;
    if (
      angleDistanceDeg(
        currentHeadingDeg,
        sampleSnapPath(path, lane, candidate).headingDeg,
      ) <= maximumTurnDeg
    ) {
      reachable = candidate;
    } else {
      unreachable = candidate;
    }
  }
  return reachable;
}

export class DockingController {
  readonly #docks: DockCollection;
  readonly #dockSystem: DockSystem;
  readonly #config: DockingConfig;
  readonly #resolveSnapDurationMs: (baseSnapDurationMs: number) => number;
  readonly #landGeometry: LandClearanceGeometry | undefined;
  readonly #navigationClearanceExtra: number;
  readonly #transactions = new Map<string, DockingTransaction>();

  public constructor(options: DockingControllerOptions) {
    this.#docks = options.docks;
    this.#dockSystem = options.dockSystem;
    this.#config = options.config;
    this.#resolveSnapDurationMs = options.resolveSnapDurationMs ?? ((base) => base);
    this.#landGeometry = options.landGeometry;
    this.#navigationClearanceExtra = options.navigationClearanceExtra ?? 0;
    if (!Number.isFinite(this.#navigationClearanceExtra) || this.#navigationClearanceExtra < 0) {
      throw new RangeError('navigationClearanceExtra must be non-negative and finite');
    }
  }

  public step(candidates: readonly DockApproachCandidate[], deltaSeconds: number): DockingStepResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) throw new RangeError('deltaSeconds must be non-negative and finite');
    this.#validateCandidates(candidates);
    const result = { reservedShipIds: [] as string[], startedShipIds: [] as string[], completedShipIds: [] as string[], cancelledShipIds: [] as string[], invariantShipIds: [] as string[] };
    this.#advanceTransactions(deltaSeconds * 1000, result);
    this.#arbitrate(candidates, result);
    return Object.freeze({
      reservedShipIds: Object.freeze(result.reservedShipIds),
      startedShipIds: Object.freeze(result.startedShipIds),
      completedShipIds: Object.freeze(result.completedShipIds),
      cancelledShipIds: Object.freeze(result.cancelledShipIds),
      invariantShipIds: Object.freeze(result.invariantShipIds),
    });
  }

  public isShipCollidable(ship: ShipModel): boolean {
    if (ship.state === ShipState.Unloading || ship.state === ShipState.Destroyed) return false;
    if (ship.state === ShipState.ApproachingDock || ship.state === ShipState.Docking) {
      return this.#config.collisionEnabledUntilSnapComplete;
    }
    return true;
  }

  public isShipInManeuver(shipId: string): boolean {
    return this.#transactions.has(shipId);
  }

  public departureRouteStart(ship: ShipModel): DockLane['release'] | null {
    const dock = [...this.#docks.values()].find(
      (candidate) => candidate.occupiedBy === ship.id,
    );
    return dock === undefined ? null : this.#deriveLane(dock, ship).release;
  }

  public beginDeparture(ship: ShipModel): boolean {
    if (
      ship.state !== ShipState.Leaving ||
      ship.route === null ||
      this.#transactions.has(ship.id)
    ) return false;
    const dock = [...this.#docks.values()].find(
      (candidate) => candidate.occupiedBy === ship.id,
    );
    if (dock === undefined) return false;
    const durationMs = this.#resolveSnapDurationMs(this.#config.baseSnapDurationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new RangeError('effective snap duration must be positive and finite');
    }
    const lane = this.#deriveLane(dock, ship);
    const routeStart = ship.route.pointAtDistance(ship.routeProgress);
    if (Math.hypot(routeStart.x - lane.release.x, routeStart.y - lane.release.y) > 1e-6) {
      return false;
    }
    ship.holdRouteMotion();
    this.#transactions.set(ship.id, {
      phase: 'departing',
      shipId: ship.id,
      dockId: dock.id,
      ship,
      route: ship.route,
      startX: ship.x,
      startY: ship.y,
      releaseX: lane.release.x,
      releaseY: lane.release.y,
      elapsedMs: 0,
      durationMs,
    });
    return true;
  }

  #validateCandidates(candidates: readonly DockApproachCandidate[]): void {
    const shipIds = new Set<string>();
    const sequences = new Set<number>();
    for (const candidate of candidates) {
      if (!Number.isInteger(candidate.spawnSequence) || candidate.spawnSequence < 0) throw new RangeError('spawnSequence must be a non-negative integer');
      if (shipIds.has(candidate.ship.id) || sequences.has(candidate.spawnSequence)) throw new RangeError('candidates must have unique ship ids and spawn sequences');
      shipIds.add(candidate.ship.id);
      sequences.add(candidate.spawnSequence);
    }
  }

  #advanceTransactions(elapsedMs: number, result: { startedShipIds: string[]; completedShipIds: string[]; cancelledShipIds: string[]; invariantShipIds: string[] }): void {
    const transactions = [...this.#transactions.values()].sort((left, right) => compareOrdinal(left.shipId, right.shipId));
    for (const transaction of transactions) {
      const ship = transaction.ship;
      const dock = this.#docks.get(transaction.dockId);
      if (dock === undefined) {
        this.#transactions.delete(transaction.shipId);
        result.invariantShipIds.push(transaction.shipId);
        continue;
      }
      if (ship.state === ShipState.Destroyed) {
        if (transaction.phase === 'departing') {
          this.#dockSystem.releaseOccupancy(dock, ship.id);
        } else {
          this.#dockSystem.releaseReservation(dock, ship.id);
        }
        this.#transactions.delete(ship.id);
        result.cancelledShipIds.push(ship.id);
        continue;
      }
      if (transaction.phase === 'departing') {
        if (dock.occupiedBy !== ship.id) {
          this.#transactions.delete(ship.id);
          result.invariantShipIds.push(ship.id);
          continue;
        }
        this.#advanceDeparture(transaction, ship, dock, elapsedMs, result);
        continue;
      }
      if (dock.reservedBy !== ship.id) {
        this.#transactions.delete(ship.id);
        result.invariantShipIds.push(ship.id);
        continue;
      }
      if (transaction.phase === 'awaiting_snap') {
        const lane = this.#deriveLane(dock, ship);
        const approachDistance = Math.hypot(
          lane.approach.x - ship.x,
          lane.approach.y - ship.y,
        );
        const berthDistance = Math.hypot(
          lane.berth.x - lane.approach.x,
          lane.berth.y - lane.approach.y,
        );
        const totalDistance = approachDistance + berthDistance;
        const path: SnapPath = {
          startX: ship.x,
          startY: ship.y,
          startRotationDeg: ship.rotationDeg,
          approachX: lane.approach.x,
          approachY: lane.approach.y,
          splitProgress: totalDistance <= 1e-9 ? 0 : approachDistance / totalDistance,
        };
        const snapping: Snapping = {
          phase: 'snapping', shipId: ship.id, dockId: dock.id, ship, startX: ship.x, startY: ship.y,
          startRotationDeg: ship.rotationDeg,
          approachX: lane.approach.x,
          approachY: lane.approach.y,
          splitProgress: path.splitProgress,
          progress: 0,
          curveLength: measureSnapPath(path, lane),
        };
        this.#transactions.set(ship.id, snapping);
        ship.setState(ShipState.Docking);
        result.startedShipIds.push(ship.id);
        this.#advanceSnap(snapping, ship, dock, elapsedMs, result);
      } else {
        this.#advanceSnap(transaction, ship, dock, elapsedMs, result);
      }
    }
  }

  #advanceSnap(transaction: Snapping, ship: ShipModel, dock: DockModel, deltaMs: number, result: { completedShipIds: string[]; invariantShipIds: string[] }): void {
    const lane = this.#deriveLane(dock, ship);
    const desiredProgress = transaction.curveLength <= 1e-9
      ? 1
      : Math.min(
          transaction.progress + ship.characteristics.speed * deltaMs / 1000 / transaction.curveLength,
          1,
        );
    const progress = turnLimitedSnapProgress(
      transaction,
      lane,
      desiredProgress,
      ship.rotationDeg,
      ship.characteristics.turnRateDeg * deltaMs / 1000,
    );
    const sample = sampleSnapPath(transaction, lane, progress);
    const headingTarget = progress <= transaction.progress + 1e-12 && desiredProgress > progress
      ? sampleSnapPath(transaction, lane, desiredProgress).headingDeg
      : sample.headingDeg;
    ship.setPosition(sample.position);
    ship.setRotationDeg(moveAngleTowardsDeg(
      ship.rotationDeg,
      headingTarget,
      ship.characteristics.turnRateDeg * deltaMs / 1000,
    ));
    if (progress < 1) {
      this.#transactions.set(ship.id, { ...transaction, progress });
      return;
    }
    ship.setPositionXY(dock.definition.position.x, dock.definition.position.y);
    ship.setRotationDeg(dock.definition.dockAngle);
    this.#transactions.delete(ship.id);
    if (!this.#dockSystem.occupyReserved(dock, ship.id)) {
      result.invariantShipIds.push(ship.id);
      return;
    }
    ship.setState(ShipState.Unloading);
    result.completedShipIds.push(ship.id);
  }

  #advanceDeparture(
    transaction: Departing,
    ship: ShipModel,
    dock: DockModel,
    deltaMs: number,
    result: { completedShipIds: string[]; invariantShipIds: string[] },
  ): void {
    const elapsedMs = transaction.elapsedMs + deltaMs;
    const progress = Math.min(Math.max(elapsedMs / transaction.durationMs, 0), 1);
    ship.setPositionXY(
      transaction.startX + (transaction.releaseX - transaction.startX) * progress,
      transaction.startY + (transaction.releaseY - transaction.startY) * progress,
    );
    ship.setRotationDeg(dock.definition.dockAngle);
    if (progress < 1) {
      this.#transactions.set(ship.id, { ...transaction, elapsedMs });
      return;
    }
    ship.setPositionXY(transaction.releaseX, transaction.releaseY);
    if (!ship.resumeHeldRouteAtCurrentPosition()) {
      result.invariantShipIds.push(ship.id);
      return;
    }
    if (!this.#dockSystem.releaseOccupancy(dock, ship.id)) {
      ship.holdRouteMotion();
      result.invariantShipIds.push(ship.id);
      return;
    }
    this.#transactions.delete(ship.id);
    result.completedShipIds.push(ship.id);
  }

  #deriveLane(dock: DockModel, ship: ShipModel): DockLane {
    return deriveDockLane(
      dock.definition,
      this.#landGeometry,
      ship.characteristics.collisionRadius + this.#navigationClearanceExtra,
    );
  }

  #arbitrate(candidates: readonly DockApproachCandidate[], result: { reservedShipIds: string[] }): void {
    const docks = [...this.#docks.values()].sort((left, right) => compareOrdinal(left.id, right.id));
    const nominations: Nomination[] = [];
    for (const candidate of candidates) {
      if (candidate.ship.state !== ShipState.Navigating || this.#transactions.has(candidate.ship.id)) continue;
      let nomination: Nomination | null = null;
      for (const dock of docks) {
        const squared = distanceSquared(candidate.ship, dock);
        if (squared > dock.definition.snapRadius * dock.definition.snapRadius || this.#dockSystem.classify(dock, candidate.ship).status !== 'eligible') continue;
        if (nomination === null || squared < nomination.distanceSquared || (squared === nomination.distanceSquared && compareOrdinal(dock.id, nomination.dock.id) < 0)) {
          nomination = { candidate, dock, distanceSquared: squared };
        }
      }
      if (nomination !== null) nominations.push(nomination);
    }
    const winnersByDock = new Map<string, Nomination>();
    for (const nomination of nominations) {
      const existing = winnersByDock.get(nomination.dock.id);
      if (existing === undefined || compareNomination(nomination, existing) < 0) winnersByDock.set(nomination.dock.id, nomination);
    }
    for (const winner of [...winnersByDock.values()].sort((left, right) => compareOrdinal(left.dock.id, right.dock.id))) {
      if (this.#dockSystem.reserve(winner.dock, winner.candidate.ship).status !== 'eligible') continue;
      winner.candidate.ship.setState(ShipState.ApproachingDock);
      this.#transactions.set(winner.candidate.ship.id, { phase: 'awaiting_snap', shipId: winner.candidate.ship.id, dockId: winner.dock.id, ship: winner.candidate.ship });
      result.reservedShipIds.push(winner.candidate.ship.id);
    }
  }
}
