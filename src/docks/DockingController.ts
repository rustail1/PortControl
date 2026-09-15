import type { LandClearanceGeometry } from '../geometry/LandClearanceGeometry.ts';
import type { ShipPosition } from '../shared/geometry/Point.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import { ShipRoute } from '../ships/ShipRoute.ts';
import { ShipState } from '../ships/ShipState.ts';
import {
  HarborManeuverMotor,
  type HarborManeuverPath,
} from './HarborManeuverMotor.ts';
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
  readonly landGeometry?: LandClearanceGeometry;
  readonly navigationClearanceExtra?: number;
  readonly maneuverMotor?: HarborManeuverMotor;
}

export interface WrongDockAttemptFact { readonly shipId: string; readonly dockId: string; }

export interface DockingStepResult {
  readonly reservedShipIds: readonly string[];
  readonly startedShipIds: readonly string[];
  readonly completedShipIds: readonly string[];
  readonly cancelledShipIds: readonly string[];
  readonly invariantShipIds: readonly string[];
  readonly wrongDockAttemptFacts: readonly WrongDockAttemptFact[];
}

export interface DockLane {
  readonly approach: ShipPosition;
  readonly alignment: ShipPosition;
  readonly berth: ShipPosition;
  readonly release: ShipPosition;
}

export type DockingTransactionSnapshot =
  | {
      readonly phase: 'awaiting_assist';
      readonly shipId: string;
      readonly dockId: string;
    }
  | {
      readonly phase: 'docking_assist';
      readonly shipId: string;
      readonly dockId: string;
      readonly startX: number;
      readonly startY: number;
      readonly progress: number;
      readonly speed: number;
    }
  | {
      readonly phase: 'departure_assist';
      readonly shipId: string;
      readonly dockId: string;
      readonly startX: number;
      readonly startY: number;
      readonly progress: number;
      readonly speed: number;
    };

export interface PreparedDepartureManeuver {
  readonly dockId: string;
  readonly startX: number;
  readonly startY: number;
  readonly releaseX: number;
  readonly releaseY: number;
}

export interface DockingControllerSnapshot {
  readonly transactions: readonly DockingTransactionSnapshot[];
  readonly incompatibleInside: readonly string[];
}

interface TransactionIdentity {
  readonly shipId: string;
  readonly dockId: string;
  readonly ship: ShipModel;
}

interface AwaitingAssist extends TransactionIdentity {
  readonly phase: 'awaiting_assist';
}

interface DockingAssist extends TransactionIdentity {
  readonly phase: 'docking_assist';
  readonly startX: number;
  readonly startY: number;
  readonly progress: number;
  readonly speed: number;
}

interface DepartureAssist extends TransactionIdentity {
  readonly phase: 'departure_assist';
  readonly route: ShipRoute;
  readonly startX: number;
  readonly startY: number;
  readonly progress: number;
  readonly speed: number;
}

type DockingTransaction = AwaitingAssist | DockingAssist | DepartureAssist;

interface Nomination {
  readonly candidate: DockApproachCandidate;
  readonly dock: DockModel;
  readonly distanceSquared: number;
}

function compareOrdinal(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function compareNomination(left: Nomination, right: Nomination): number {
  return left.distanceSquared - right.distanceSquared ||
    left.candidate.spawnSequence - right.candidate.spawnSequence;
}

function distanceSquaredToPoint(ship: ShipModel, point: ShipPosition): number {
  const dx = ship.x - point.x;
  const dy = ship.y - point.y;
  return dx * dx + dy * dy;
}

function freezePoint(point: ShipPosition): ShipPosition {
  return Object.freeze({ x: point.x, y: point.y });
}

function distanceBetween(left: ShipPosition, right: ShipPosition): number {
  return Math.hypot(right.x - left.x, right.y - left.y);
}

function uniquePathPoints(start: ShipPosition, candidates: readonly ShipPosition[]): readonly ShipPosition[] {
  const points: ShipPosition[] = [];
  let previous = start;
  for (const candidate of candidates) {
    if (Math.hypot(candidate.x - previous.x, candidate.y - previous.y) <= 1e-9) continue;
    const frozen = freezePoint(candidate);
    points.push(frozen);
    previous = frozen;
  }
  if (points.length === 0) points.push(freezePoint(start));
  return Object.freeze(points);
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
  let waterPoint: ShipPosition | null = null;
  for (let multiplier = 1; multiplier <= 1024; multiplier += 1) {
    const candidate = {
      x: definition.position.x + outwardX * definition.approachRadius * multiplier,
      y: definition.position.y + outwardY * definition.approachRadius * multiplier,
    };
    if (landGeometry === undefined || !landGeometry.blocksSegment(candidate, candidate, clearance)) {
      waterPoint = freezePoint(candidate);
      break;
    }
  }
  if (waterPoint === null) throw new Error(`dock ${definition.id} has no navigable lane point`);

  // Alignment is a semantic harbor-assist phase marker on the exact berth axis.
  // It intentionally does not curve/cut geometry: physics changes time, not space.
  const alignment = freezePoint({
    x: definition.position.x + (waterPoint.x - definition.position.x) * 0.55,
    y: definition.position.y + (waterPoint.y - definition.position.y) * 0.55,
  });
  return Object.freeze({
    approach: waterPoint,
    alignment,
    berth: freezePoint(definition.position),
    release: waterPoint,
  });
}

export class DockingController {
  readonly #docks: DockCollection;
  readonly #dockSystem: DockSystem;
  readonly #config: DockingConfig;
  readonly #landGeometry: LandClearanceGeometry | undefined;
  readonly #navigationClearanceExtra: number;
  readonly #motor: HarborManeuverMotor;
  readonly #transactions = new Map<string, DockingTransaction>();
  readonly #incompatibleInside = new Set<string>();

  public constructor(options: DockingControllerOptions) {
    this.#docks = options.docks;
    this.#dockSystem = options.dockSystem;
    this.#config = options.config;
    this.#landGeometry = options.landGeometry;
    this.#navigationClearanceExtra = options.navigationClearanceExtra ?? 0;
    this.#motor = options.maneuverMotor ?? new HarborManeuverMotor();
    if (!Number.isFinite(this.#navigationClearanceExtra) || this.#navigationClearanceExtra < 0) {
      throw new RangeError('navigationClearanceExtra must be non-negative and finite');
    }
  }

  public step(candidates: readonly DockApproachCandidate[], deltaSeconds: number): DockingStepResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be non-negative and finite');
    }
    this.#validateCandidates(candidates);
    const result = {
      reservedShipIds: [] as string[], startedShipIds: [] as string[], completedShipIds: [] as string[],
      cancelledShipIds: [] as string[], invariantShipIds: [] as string[], wrongDockAttemptFacts: [] as WrongDockAttemptFact[],
    };
    this.#trackWrongDockAttempts(candidates, result.wrongDockAttemptFacts);
    this.#advanceTransactions(deltaSeconds, result);
    this.#arbitrate(candidates, result);
    return Object.freeze({
      reservedShipIds: Object.freeze(result.reservedShipIds),
      startedShipIds: Object.freeze(result.startedShipIds),
      completedShipIds: Object.freeze(result.completedShipIds),
      cancelledShipIds: Object.freeze(result.cancelledShipIds),
      invariantShipIds: Object.freeze(result.invariantShipIds),
      wrongDockAttemptFacts: Object.freeze(result.wrongDockAttemptFacts),
    });
  }

  public toSnapshot(): DockingControllerSnapshot {
    const transactions = [...this.#transactions.values()]
      .sort((left, right) => compareOrdinal(left.shipId, right.shipId))
      .map((transaction): DockingTransactionSnapshot => {
        if (transaction.phase === 'awaiting_assist') {
          return Object.freeze({ phase: transaction.phase, shipId: transaction.shipId, dockId: transaction.dockId });
        }
        return Object.freeze({
          phase: transaction.phase,
          shipId: transaction.shipId,
          dockId: transaction.dockId,
          startX: transaction.startX,
          startY: transaction.startY,
          progress: transaction.progress,
          speed: transaction.speed,
        });
      });
    return Object.freeze({
      transactions: Object.freeze(transactions),
      incompatibleInside: Object.freeze([...this.#incompatibleInside].sort()),
    });
  }

  public restore(snapshot: DockingControllerSnapshot, resolveShip: (shipId: string) => ShipModel | null): void {
    this.#transactions.clear();
    this.#incompatibleInside.clear();
    for (const key of snapshot.incompatibleInside) this.#incompatibleInside.add(key);
    for (const item of snapshot.transactions) {
      const ship = resolveShip(item.shipId);
      if (ship === null) throw new RangeError(`docking snapshot references missing ship: ${item.shipId}`);
      if (this.#docks.get(item.dockId) === undefined) throw new RangeError(`docking snapshot references missing dock: ${item.dockId}`);
      if (item.phase === 'awaiting_assist') {
        this.#transactions.set(item.shipId, { ...item, ship });
      } else if (item.phase === 'docking_assist') {
        this.#transactions.set(item.shipId, { ...item, ship });
      } else {
        if (ship.route === null) throw new RangeError('departure assist snapshot requires ship route');
        this.#transactions.set(item.shipId, { ...item, ship, route: ship.route });
      }
    }
  }

  public isShipCollidable(ship: ShipModel): boolean {
    if (ship.state === ShipState.Unloading || ship.state === ShipState.Destroyed) return false;
    if (ship.state === ShipState.ApproachingDock || ship.state === ShipState.Docking) {
      return this.#config.collisionEnabledDuringHarborAssist;
    }
    return true;
  }

  public isShipInManeuver(shipId: string): boolean {
    return this.#transactions.has(shipId);
  }

  public departureRouteStart(ship: ShipModel): DockLane['release'] | null {
    const dock = [...this.#docks.values()].find((candidate) => candidate.occupiedBy === ship.id);
    return dock === undefined ? null : this.#deriveLane(dock, ship).release;
  }

  public departurePresentationPrefix(ship: ShipModel): readonly ShipPosition[] {
    const dock = [...this.#docks.values()].find((candidate) => candidate.occupiedBy === ship.id);
    if (dock === undefined) return Object.freeze([]);
    const lane = this.#deriveLane(dock, ship);
    const transaction = this.#transactions.get(ship.id);
    if (transaction?.phase === 'departure_assist') {
      const path = this.#departurePath(transaction, lane, dock.definition.dockAngle);
      const points = transaction.progress < path.phaseProgress.alignmentEnd - 1e-6
        ? [lane.alignment, lane.release]
        : [lane.release];
      return Object.freeze(points.map((point) => Object.freeze({ ...point })));
    }
    if (ship.state === ShipState.ReadyToLeave) {
      return Object.freeze([
        Object.freeze({ ...lane.alignment }),
        Object.freeze({ ...lane.release }),
      ]);
    }
    return Object.freeze([]);
  }

  public prepareDeparture(ship: ShipModel, route: ShipRoute): PreparedDepartureManeuver | null {
    if (ship.state !== ShipState.ReadyToLeave || this.#transactions.has(ship.id)) return null;
    const dock = [...this.#docks.values()].find((candidate) => candidate.occupiedBy === ship.id);
    if (dock === undefined) return null;
    const lane = this.#deriveLane(dock, ship);
    const routeStart = route.pointAtDistance(0);
    if (Math.hypot(routeStart.x - lane.release.x, routeStart.y - lane.release.y) > 1e-6) return null;
    return Object.freeze({
      dockId: dock.id,
      startX: ship.x,
      startY: ship.y,
      releaseX: lane.release.x,
      releaseY: lane.release.y,
    });
  }

  public commitPreparedDeparture(ship: ShipModel, route: ShipRoute, prepared: PreparedDepartureManeuver): void {
    ship.setRouteSpeed(0);
    ship.holdRouteMotion();
    this.#transactions.set(ship.id, {
      phase: 'departure_assist', shipId: ship.id, dockId: prepared.dockId, ship, route,
      startX: prepared.startX, startY: prepared.startY, progress: 0, speed: 0,
    });
  }

  public canBeginDeparture(ship: ShipModel, route: ShipRoute): boolean {
    return this.prepareDeparture(ship, route) !== null;
  }

  public forgetShip(shipId: string): void {
    for (const key of [...this.#incompatibleInside]) {
      if (key.startsWith(`${shipId}|`)) this.#incompatibleInside.delete(key);
    }
    this.#transactions.delete(shipId);
  }

  public beginDeparture(ship: ShipModel): boolean {
    if (ship.state !== ShipState.Leaving || ship.route === null || this.#transactions.has(ship.id)) return false;
    const dock = [...this.#docks.values()].find((candidate) => candidate.occupiedBy === ship.id);
    if (dock === undefined) return false;
    const lane = this.#deriveLane(dock, ship);
    const routeStart = ship.route.pointAtDistance(ship.routeProgress);
    if (Math.hypot(routeStart.x - lane.release.x, routeStart.y - lane.release.y) > 1e-6) return false;
    this.commitPreparedDeparture(ship, ship.route, {
      dockId: dock.id, startX: ship.x, startY: ship.y,
      releaseX: lane.release.x, releaseY: lane.release.y,
    });
    return true;
  }

  #validateCandidates(candidates: readonly DockApproachCandidate[]): void {
    const shipIds = new Set<string>();
    const sequences = new Set<number>();
    for (const candidate of candidates) {
      if (!Number.isInteger(candidate.spawnSequence) || candidate.spawnSequence < 0) {
        throw new RangeError('spawnSequence must be a non-negative integer');
      }
      if (shipIds.has(candidate.ship.id) || sequences.has(candidate.spawnSequence)) {
        throw new RangeError('candidates must have unique ship ids and spawn sequences');
      }
      shipIds.add(candidate.ship.id);
      sequences.add(candidate.spawnSequence);
    }
  }

  #advanceTransactions(
    deltaSeconds: number,
    result: { startedShipIds: string[]; completedShipIds: string[]; cancelledShipIds: string[]; invariantShipIds: string[] },
  ): void {
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
        if (transaction.phase === 'departure_assist') this.#dockSystem.releaseOccupancy(dock, ship.id);
        else this.#dockSystem.releaseReservation(dock, ship.id);
        this.#transactions.delete(ship.id);
        result.cancelledShipIds.push(ship.id);
        continue;
      }
      if (transaction.phase === 'departure_assist') {
        if (dock.occupiedBy !== ship.id) {
          this.#transactions.delete(ship.id);
          result.invariantShipIds.push(ship.id);
          continue;
        }
        this.#advanceDeparture(transaction, ship, dock, deltaSeconds, result);
        continue;
      }
      if (dock.reservedBy !== ship.id) {
        this.#transactions.delete(ship.id);
        result.invariantShipIds.push(ship.id);
        continue;
      }
      if (transaction.phase === 'awaiting_assist') {
        const assist: DockingAssist = {
          phase: 'docking_assist', shipId: ship.id, dockId: dock.id, ship,
          startX: ship.x, startY: ship.y, progress: 0,
          speed: Math.min(ship.routeSpeed, ship.characteristics.speed),
        };
        this.#transactions.set(ship.id, assist);
        ship.beginDocking();
        result.startedShipIds.push(ship.id);
        this.#advanceDocking(assist, ship, dock, deltaSeconds, result);
      } else {
        this.#advanceDocking(transaction, ship, dock, deltaSeconds, result);
      }
    }
  }

  #advanceDocking(
    transaction: DockingAssist,
    ship: ShipModel,
    dock: DockModel,
    deltaSeconds: number,
    result: { completedShipIds: string[]; invariantShipIds: string[] },
  ): void {
    const lane = this.#deriveLane(dock, ship);
    const path = this.#dockingPath(transaction, lane, dock.definition.dockAngle);
    const next = this.#motor.step(
      ship,
      path,
      { progress: transaction.progress, speed: transaction.speed },
      'docking',
      deltaSeconds,
    );
    ship.setPosition(next.position);
    ship.setRotationDeg(next.rotationDeg);
    ship.setRouteSpeed(next.speed);
    if (!next.completed) {
      this.#transactions.set(ship.id, { ...transaction, progress: next.progress, speed: next.speed });
      return;
    }
    ship.setPosition(lane.berth);
    ship.setRotationDeg(dock.definition.dockAngle);
    ship.setRouteSpeed(0);
    this.#transactions.delete(ship.id);
    if (!this.#dockSystem.occupyReserved(dock, ship.id)) {
      result.invariantShipIds.push(ship.id);
      return;
    }
    ship.beginUnloading();
    result.completedShipIds.push(ship.id);
  }

  #advanceDeparture(
    transaction: DepartureAssist,
    ship: ShipModel,
    dock: DockModel,
    deltaSeconds: number,
    result: { completedShipIds: string[]; invariantShipIds: string[] },
  ): void {
    const lane = this.#deriveLane(dock, ship);
    const path = this.#departurePath(transaction, lane, dock.definition.dockAngle);
    const next = this.#motor.step(
      ship,
      path,
      { progress: transaction.progress, speed: transaction.speed },
      'departure',
      deltaSeconds,
    );
    ship.setPosition(next.position);
    ship.setRotationDeg(next.rotationDeg);
    ship.setRouteSpeed(next.speed);
    if (!next.completed) {
      this.#transactions.set(ship.id, { ...transaction, progress: next.progress, speed: next.speed });
      return;
    }
    ship.setPosition(lane.release);
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

  #dockingPath(transaction: DockingAssist, lane: DockLane, finalHeadingDeg: number): HarborManeuverPath {
    const start = freezePoint({ x: transaction.startX, y: transaction.startY });
    const approachEnd = distanceBetween(start, lane.approach);
    const alignmentEnd = approachEnd + distanceBetween(lane.approach, lane.alignment);
    return Object.freeze({
      start,
      points: uniquePathPoints(start, [lane.approach, lane.alignment, lane.berth]),
      finalHeadingDeg,
      phaseProgress: Object.freeze({ approachEnd, alignmentEnd }),
    });
  }

  #departurePath(transaction: DepartureAssist, lane: DockLane, finalHeadingDeg: number): HarborManeuverPath {
    const start = freezePoint({ x: transaction.startX, y: transaction.startY });
    const alignmentEnd = distanceBetween(start, lane.alignment);
    return Object.freeze({
      start,
      points: uniquePathPoints(start, [lane.alignment, lane.release]),
      finalHeadingDeg,
      phaseProgress: Object.freeze({ approachEnd: 0, alignmentEnd }),
    });
  }

  #deriveLane(dock: DockModel, ship: ShipModel): DockLane {
    return deriveDockLane(
      dock.definition,
      this.#landGeometry,
      ship.characteristics.collisionRadius + this.#navigationClearanceExtra,
    );
  }

  #trackWrongDockAttempts(candidates: readonly DockApproachCandidate[], facts: WrongDockAttemptFact[]): void {
    const seen = new Set<string>();
    for (const candidate of candidates) {
      if (candidate.ship.state !== ShipState.Navigating) continue;
      for (const dock of this.#docks.values()) {
        const key = `${candidate.ship.id}|${dock.id}`;
        seen.add(key);
        const lane = this.#deriveLane(dock, candidate.ship);
        const inside = distanceSquaredToPoint(candidate.ship, lane.approach) <= dock.definition.approachRadius ** 2;
        const incompatible = this.#dockSystem.classify(dock, candidate.ship).status === 'incompatible';
        if (inside && incompatible) {
          if (!this.#incompatibleInside.has(key)) facts.push(Object.freeze({ shipId: candidate.ship.id, dockId: dock.id }));
          this.#incompatibleInside.add(key);
        } else {
          this.#incompatibleInside.delete(key);
        }
      }
    }
    for (const key of [...this.#incompatibleInside]) if (!seen.has(key)) this.#incompatibleInside.delete(key);
  }

  #arbitrate(candidates: readonly DockApproachCandidate[], result: { reservedShipIds: string[] }): void {
    const docks = [...this.#docks.values()].sort((left, right) => compareOrdinal(left.id, right.id));
    const nominations: Nomination[] = [];
    for (const candidate of candidates) {
      if (candidate.ship.state !== ShipState.Navigating || this.#transactions.has(candidate.ship.id)) continue;
      let nomination: Nomination | null = null;
      for (const dock of docks) {
        const lane = this.#deriveLane(dock, candidate.ship);
        const squared = distanceSquaredToPoint(candidate.ship, lane.approach);
        if (squared > dock.definition.approachRadius ** 2 || this.#dockSystem.classify(dock, candidate.ship).status !== 'eligible') continue;
        if (
          nomination === null || squared < nomination.distanceSquared ||
          squared === nomination.distanceSquared && compareOrdinal(dock.id, nomination.dock.id) < 0
        ) {
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
      winner.candidate.ship.beginDockApproach();
      this.#transactions.set(winner.candidate.ship.id, {
        phase: 'awaiting_assist', shipId: winner.candidate.ship.id, dockId: winner.dock.id, ship: winner.candidate.ship,
      });
      result.reservedShipIds.push(winner.candidate.ship.id);
    }
  }
}
