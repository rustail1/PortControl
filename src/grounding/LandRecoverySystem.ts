import type { LandClearanceGeometry } from '../geometry/LandClearanceGeometry.ts';
import {
  LandRecoveryMotion,
  normalizeRotationDeg,
  type ShipModel,
  type ShipPosition,
} from '../ships/ShipModel.ts';
import { ShipState } from '../ships/ShipState.ts';

const PREDICTION_HZ = 60;
const PREDICTION_DT = 1 / PREDICTION_HZ;
const NUMERIC_MARGIN = 2;
const ANGLE_EPSILON_DEG = 1e-7;
const SPEED_EPSILON = 1e-7;
const REVERSAL_MAGNITUDES_DEG = Object.freeze([180, 150, 120, 90] as const);
const TURN_SIGNS = Object.freeze([-1, 1] as const);

export interface LandRecoveryStepResult {
  readonly startedShipIds: readonly string[];
  readonly finishedShipIds: readonly string[];
}

interface RecoveryCandidate {
  readonly headingDeg: number;
  readonly turnSign: -1 | 1;
}

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function directedRemainingDeg(currentDeg: number, targetDeg: number, turnSign: -1 | 1): number {
  const current = normalizeRotationDeg(currentDeg);
  const target = normalizeRotationDeg(targetDeg);
  return turnSign === 1
    ? normalizeRotationDeg(target - current)
    : normalizeRotationDeg(current - target);
}

function moveAngleDirectedDeg(
  currentDeg: number,
  targetDeg: number,
  turnSign: -1 | 1,
  maximumDeltaDeg: number,
): number {
  const remaining = directedRemainingDeg(currentDeg, targetDeg, turnSign);
  if (remaining <= maximumDeltaDeg + ANGLE_EPSILON_DEG) {
    return normalizeRotationDeg(targetDeg);
  }
  return normalizeRotationDeg(currentDeg + turnSign * maximumDeltaDeg);
}

function forwardPoint(position: ShipPosition, headingDeg: number, distance: number): ShipPosition {
  const radians = headingDeg * Math.PI / 180;
  return {
    x: position.x + Math.cos(radians) * distance,
    y: position.y + Math.sin(radians) * distance,
  };
}

function activeFreeWaterState(ship: ShipModel): boolean {
  return ship.state === ShipState.Entering ||
    ship.state === ShipState.Navigating ||
    ship.state === ShipState.Leaving;
}

export class LandRecoverySystem {
  readonly #geometry: LandClearanceGeometry;
  readonly #navigationClearanceExtra: number;

  public constructor(options: {
    readonly geometry: LandClearanceGeometry;
    readonly navigationClearanceExtra: number;
  }) {
    assertFiniteNonNegative(options.navigationClearanceExtra, 'navigationClearanceExtra');
    this.#geometry = options.geometry;
    this.#navigationClearanceExtra = options.navigationClearanceExtra;
  }

  public step(ships: readonly ShipModel[], deltaSeconds: number): LandRecoveryStepResult {
    assertFiniteNonNegative(deltaSeconds, 'deltaSeconds');
    const startedShipIds: string[] = [];
    const finishedShipIds: string[] = [];

    for (const ship of ships) {
      if (!activeFreeWaterState(ship)) continue;
      if (ship.routeMotionHeld) continue;
      if (ship.routeRecoveryHeadingDeg !== null) continue;

      if (ship.landRecoveryHeadingDeg !== null) {
        if (this.#canFinish(ship)) {
          ship.finishLandRecovery();
          finishedShipIds.push(ship.id);
        }
        continue;
      }

      const routeHazardTakeover = this.#unfinishedRouteEndsIntoLand(ship);
      if (!routeHazardTakeover && !this.#landAhead(ship)) continue;

      const movingCandidate = this.#firstClearArcCandidate(ship);
      if (movingCandidate !== null) {
        this.#beginRecovery(ship, movingCandidate, LandRecoveryMotion.Arc, routeHazardTakeover);
        startedShipIds.push(ship.id);
        continue;
      }

      const pivotCandidate = this.#firstClearPivotCandidate(ship);
      if (pivotCandidate !== null) {
        this.#beginRecovery(ship, pivotCandidate, LandRecoveryMotion.Pivot, routeHazardTakeover);
        startedShipIds.push(ship.id);
      }
    }

    return Object.freeze({
      startedShipIds: Object.freeze(startedShipIds),
      finishedShipIds: Object.freeze(finishedShipIds),
    });
  }

  #beginRecovery(
    ship: ShipModel,
    candidate: RecoveryCandidate,
    motion: LandRecoveryMotion,
    routeHazardTakeover: boolean,
  ): void {
    if (routeHazardTakeover) {
      ship.beginLandRecoveryFromRouteHazard(candidate.headingDeg, candidate.turnSign, motion);
      return;
    }
    ship.beginLandRecovery(candidate.headingDeg, candidate.turnSign, motion);
  }

  #unfinishedRouteEndsIntoLand(ship: ShipModel): boolean {
    const route = ship.route;
    if (route === null || ship.routeProgress >= route.totalLength - ANGLE_EPSILON_DEG) return false;
    const remainingDistance = route.totalLength - ship.routeProgress;
    if (remainingDistance > this.#probeDistance(ship) + SPEED_EPSILON) return false;
    const tangent = route.tangentAtDistance(route.totalLength);
    if (tangent === null) return false;
    const end = route.pointAtDistance(route.totalLength);
    const headingDeg = normalizeRotationDeg(Math.atan2(tangent.y, tangent.x) * 180 / Math.PI);
    return !this.#probeClear(ship, end, headingDeg);
  }

  #clearance(ship: ShipModel): number {
    return ship.characteristics.collisionRadius + this.#navigationClearanceExtra;
  }

  #autonomousSpeed(ship: ShipModel): number {
    return ship.routeSpeed > SPEED_EPSILON
      ? Math.min(ship.routeSpeed, ship.characteristics.speed)
      : ship.characteristics.speed;
  }

  #turnRadius(ship: ShipModel, speed: number): number {
    const radiansPerSecond = ship.characteristics.turnRateDeg * Math.PI / 180;
    if (radiansPerSecond <= ANGLE_EPSILON_DEG) return Number.POSITIVE_INFINITY;
    return speed / radiansPerSecond;
  }

  #probeDistance(ship: ShipModel): number {
    const speed = this.#autonomousSpeed(ship);
    const turnRadius = this.#turnRadius(ship, speed);
    if (!Number.isFinite(turnRadius)) return Number.POSITIVE_INFINITY;
    return turnRadius + this.#clearance(ship) + speed * PREDICTION_DT + NUMERIC_MARGIN;
  }

  #probeClear(ship: ShipModel, position: ShipPosition, headingDeg: number): boolean {
    const distance = this.#probeDistance(ship);
    if (!Number.isFinite(distance)) return false;
    return !this.#geometry.blocksSegment(
      position,
      forwardPoint(position, headingDeg, distance),
      this.#clearance(ship),
    );
  }

  #landAhead(ship: ShipModel): boolean {
    return !this.#probeClear(ship, ship.position, ship.rotationDeg);
  }

  #canFinish(ship: ShipModel): boolean {
    const target = ship.landRecoveryHeadingDeg;
    const turnSign = ship.landRecoveryTurnSign;
    if (target === null || turnSign === null) return false;
    if (directedRemainingDeg(ship.rotationDeg, target, turnSign) > ANGLE_EPSILON_DEG) {
      return false;
    }
    return this.#probeClear(ship, ship.position, target);
  }

  #candidateSequence(ship: ShipModel): readonly RecoveryCandidate[] {
    const candidates: RecoveryCandidate[] = [];
    for (const magnitudeDeg of REVERSAL_MAGNITUDES_DEG) {
      for (const turnSign of TURN_SIGNS) {
        candidates.push(Object.freeze({
          headingDeg: normalizeRotationDeg(ship.rotationDeg + turnSign * magnitudeDeg),
          turnSign,
        }));
      }
    }
    return candidates;
  }

  #firstClearArcCandidate(ship: ShipModel): RecoveryCandidate | null {
    if (ship.routeSpeed <= SPEED_EPSILON) return null;
    for (const candidate of this.#candidateSequence(ship)) {
      if (this.#arcIsClear(ship, candidate)) return candidate;
    }
    return null;
  }

  #arcIsClear(ship: ShipModel, candidate: RecoveryCandidate): boolean {
    const speed = this.#autonomousSpeed(ship);
    const maximumTurnDeg = ship.characteristics.turnRateDeg * PREDICTION_DT;
    if (maximumTurnDeg <= ANGLE_EPSILON_DEG) return false;

    let position = ship.position;
    let headingDeg = ship.rotationDeg;
    const clearance = this.#clearance(ship);
    const maximumSteps = Math.ceil(
      directedRemainingDeg(headingDeg, candidate.headingDeg, candidate.turnSign) /
        maximumTurnDeg,
    ) + 1;

    for (let step = 0; step < maximumSteps; step += 1) {
      const remaining = directedRemainingDeg(headingDeg, candidate.headingDeg, candidate.turnSign);
      if (remaining <= ANGLE_EPSILON_DEG) break;
      headingDeg = moveAngleDirectedDeg(
        headingDeg,
        candidate.headingDeg,
        candidate.turnSign,
        maximumTurnDeg,
      );
      const next = forwardPoint(position, headingDeg, speed * PREDICTION_DT);
      if (this.#geometry.blocksSegment(position, next, clearance)) return false;
      position = next;
    }

    if (directedRemainingDeg(headingDeg, candidate.headingDeg, candidate.turnSign) > ANGLE_EPSILON_DEG) {
      return false;
    }
    return this.#probeClear(ship, position, candidate.headingDeg);
  }

  #firstClearPivotCandidate(ship: ShipModel): RecoveryCandidate | null {
    for (const candidate of this.#candidateSequence(ship)) {
      if (this.#probeClear(ship, ship.position, candidate.headingDeg)) return candidate;
    }
    return null;
  }
}
