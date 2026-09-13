import { normalizeRotationDeg, type ShipModel } from './ShipModel.ts';
import type { ShipRoute } from './ShipRoute.ts';
import { ShipState } from './ShipState.ts';

export interface SteeringTarget {
  readonly x: number;
  readonly y: number;
}

interface UpcomingCorner {
  readonly progress: number;
  readonly turnAngleDeg: number;
}

const NORMAL_CORNER_MAX_DEG = 90;
<<<<<<< HEAD
const FULL_SPEED_HEADING_ERROR_DEG = 60;
const MIN_CORNER_SLOWDOWN_DEG = 15;
const REVERSAL_PIVOT_MIN_DEG = 120;
const PIVOT_RELEASE_ERROR_DEG = 60;
=======
>>>>>>> parent of 4abb735 (COR-12R: ease route acceleration after pivots)
const EPSILON = 1e-7;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

export function moveAngleTowardsDeg(
  rotationDeg: number,
  desiredAngleDeg: number,
  maximumDeltaDeg: number,
): number {
  assertFinite(maximumDeltaDeg, 'maximumDeltaDeg');
  if (maximumDeltaDeg < 0) {
    throw new RangeError('maximumDeltaDeg must be non-negative');
  }

  const current = normalizeRotationDeg(rotationDeg);
  const desired = normalizeRotationDeg(desiredAngleDeg);
  const shortestDelta = ((desired - current + 540) % 360) - 180;
  if (Math.abs(shortestDelta) <= maximumDeltaDeg) {
    return desired;
  }
  return normalizeRotationDeg(
    current + Math.sign(shortestDelta) * maximumDeltaDeg,
  );
}

function angleDeltaDeg(left: number, right: number): number {
  return Math.abs(((right - left + 540) % 360) - 180);
}

<<<<<<< HEAD
function alignmentSpeedScale(headingErrorDeg: number): number {
  if (headingErrorDeg <= FULL_SPEED_HEADING_ERROR_DEG) return 1;
  if (headingErrorDeg >= REVERSAL_PIVOT_MIN_DEG) return 0;
  const normalized = (headingErrorDeg - FULL_SPEED_HEADING_ERROR_DEG) /
    (REVERSAL_PIVOT_MIN_DEG - FULL_SPEED_HEADING_ERROR_DEG);
  return Math.cos(normalized * Math.PI / 2) ** 2;
}

function cornerSpeedScale(turnAngleDeg: number): number {
  if (turnAngleDeg <= MIN_CORNER_SLOWDOWN_DEG) return 1;
  if (turnAngleDeg >= REVERSAL_PIVOT_MIN_DEG) return 0;
  return Math.cos(turnAngleDeg * Math.PI / 360);
}

function moveTowards(current: number, target: number, maximumDelta: number): number {
  if (current < target) return Math.min(current + maximumDelta, target);
  return Math.max(current - maximumDelta, target);
}

function routeAcceleration(ship: ShipModel): number {
  return ship.characteristics.speed * ship.characteristics.turnRateDeg / NORMAL_CORNER_MAX_DEG;
}

function brakingSpeedLimit(targetSpeed: number, acceleration: number, distance: number): number {
  return Math.sqrt(Math.max(0, targetSpeed * targetSpeed + 2 * acceleration * distance));
}

=======
>>>>>>> parent of 4abb735 (COR-12R: ease route acceleration after pivots)
function segmentHeadingDeg(route: ShipRoute, index: number): number | null {
  const start = route.segmentStartAt(index);
  const end = route.at(index);
  if (start === null || end === null) return null;
  const dx = end.x - start.x;
  const dy = end.y - start.y;
  if (Math.hypot(dx, dy) <= EPSILON) return null;
  return normalizeRotationDeg(Math.atan2(dy, dx) * 180 / Math.PI);
}

function routeHeadingDeg(route: ShipRoute, progress: number): number | null {
  const tangent = route.tangentAtDistance(progress);
  if (tangent === null) return null;
  return normalizeRotationDeg(Math.atan2(tangent.y, tangent.x) * 180 / Math.PI);
}

function findUpcomingCorner(route: ShipRoute, progress: number): UpcomingCorner | null {
  const currentCursor = route.cursorAtDistance(progress);
  let incomingHeading = segmentHeadingDeg(route, currentCursor) ?? routeHeadingDeg(route, progress);
  if (incomingHeading === null) return null;

  for (let index = currentCursor; index < route.length - 1; index += 1) {
    const outgoingHeading = segmentHeadingDeg(route, index + 1);
    if (outgoingHeading === null) continue;
    const turnAngleDeg = angleDeltaDeg(incomingHeading, outgoingHeading);
    if (turnAngleDeg > EPSILON) {
      return {
        progress: route.distanceAtCursor(index + 1),
        turnAngleDeg,
      };
    }
    incomingHeading = outgoingHeading;
  }
  return null;
}

function routeEndContinuesForward(ship: ShipModel, continueAfterRouteEnd: boolean): boolean {
  return continueAfterRouteEnd &&
    (ship.state === ShipState.Entering || ship.state === ShipState.Leaving);
}

export class ShipMotor {
  public stepRoute(
    ship: ShipModel,
    waypointTolerance: number,
    deltaSeconds: number,
    continueAfterRouteEnd = true,
  ): void {
    if (
      ship.state !== ShipState.Entering &&
      ship.state !== ShipState.Navigating &&
      ship.state !== ShipState.ReadyToLeave &&
      ship.state !== ShipState.Leaving
    ) return;

    const route = ship.route;
    if (route !== null && ship.routeMotionHeld) return;

    if (route === null) {
      const recoveryHeading = ship.routeRecoveryHeadingDeg;
      if (recoveryHeading !== null) {
        assertFinite(deltaSeconds, 'deltaSeconds');
        if (deltaSeconds < 0) {
          throw new RangeError('deltaSeconds must be non-negative');
        }
        ship.setRotationDeg(moveAngleTowardsDeg(
          ship.rotationDeg,
          recoveryHeading,
          ship.characteristics.turnRateDeg * deltaSeconds,
        ));
        if (ship.rotationDeg === recoveryHeading) {
          ship.finishRouteRecovery();
        }
        this.#stepForward(ship, deltaSeconds);
        return;
      }
      if (
        !ship.routeMotionHeld &&
        (ship.state === ShipState.Entering ||
          ship.state === ShipState.Navigating ||
          ship.state === ShipState.Leaving)
      ) {
        this.#stepForward(ship, deltaSeconds);
      }
      return;
    }

    assertFinite(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be non-negative');
    }
    assertFinite(waypointTolerance, 'waypointTolerance');
    if (waypointTolerance < 0) {
      throw new RangeError('waypointTolerance must be non-negative');
    }

    if (ship.routeProgress >= route.totalLength) {
      if (routeEndContinuesForward(ship, continueAfterRouteEnd)) {
        ship.setRouteSpeed(ship.characteristics.speed);
        this.#stepForward(ship, deltaSeconds);
      } else {
        ship.setRouteSpeed(0);
      }
      return;
    }

    const travelHeadingDeg = routeHeadingDeg(route, ship.routeProgress);
    if (travelHeadingDeg === null) return;

    if (ship.routePivotProgress !== null) {
      const pivotPosition = route.pointAtDistance(ship.routePivotProgress);
      ship.setPosition(pivotPosition);
      ship.setRouteSpeed(0);
      ship.setRotationDeg(moveAngleTowardsDeg(
        ship.rotationDeg,
        travelHeadingDeg,
        ship.characteristics.turnRateDeg * deltaSeconds,
      ));
      if (angleDeltaDeg(ship.rotationDeg, travelHeadingDeg) > PIVOT_RELEASE_ERROR_DEG) return;
      ship.finishRoutePivot();
      return;
    } else if (angleDeltaDeg(ship.rotationDeg, travelHeadingDeg) >= REVERSAL_PIVOT_MIN_DEG) {
      ship.beginRoutePivot(ship.routeProgress);
      ship.setRotationDeg(moveAngleTowardsDeg(
        ship.rotationDeg,
        travelHeadingDeg,
        ship.characteristics.turnRateDeg * deltaSeconds,
      ));
      return;
    }

    const upcomingCorner = findUpcomingCorner(route, ship.routeProgress);
    const hasMeaningfulUpcomingCorner = upcomingCorner !== null &&
      upcomingCorner.progress > ship.routeProgress + EPSILON &&
      upcomingCorner.turnAngleDeg > MIN_CORNER_SLOWDOWN_DEG;

    ship.setRotationDeg(moveAngleTowardsDeg(
      ship.rotationDeg,
      travelHeadingDeg,
      ship.characteristics.turnRateDeg * deltaSeconds,
    ));

<<<<<<< HEAD
    const travelHeadingErrorDeg = angleDeltaDeg(ship.rotationDeg, travelHeadingDeg);
    const acceleration = routeAcceleration(ship);
    let targetSpeed = ship.characteristics.speed * alignmentSpeedScale(travelHeadingErrorDeg);
    if (hasMeaningfulUpcomingCorner && upcomingCorner !== null) {
      const cornerTargetSpeed = ship.characteristics.speed * cornerSpeedScale(upcomingCorner.turnAngleDeg);
      targetSpeed = Math.min(targetSpeed, brakingSpeedLimit(
        cornerTargetSpeed,
        acceleration,
        upcomingCorner.progress - ship.routeProgress,
      ));
    }
    if (!routeEndContinuesForward(ship, continueAfterRouteEnd)) {
      targetSpeed = Math.min(targetSpeed, brakingSpeedLimit(
        0,
        acceleration,
        route.totalLength - ship.routeProgress,
      ));
    }
    const nextSpeed = moveTowards(
      ship.routeSpeed,
      targetSpeed,
      acceleration * deltaSeconds,
    );
    ship.setRouteSpeed(nextSpeed);
    const maximumDistance = nextSpeed * deltaSeconds;
=======
    // Translation always belongs to the canonical route. Never advance while that
    // route lies behind the bow: the ship turns in place instead of visually sailing
    // backwards. Normal <=90-degree bends retain configured cruise speed.
    const travelHeadingErrorDeg = angleDeltaDeg(ship.rotationDeg, travelHeadingDeg);
    const mayAdvance = travelHeadingErrorDeg <= NORMAL_CORNER_MAX_DEG + EPSILON;
    const maximumDistance = mayAdvance
      ? ship.characteristics.speed * deltaSeconds
      : 0;
>>>>>>> parent of 4abb735 (COR-12R: ease route acceleration after pivots)
    let nextProgress = Math.min(
      ship.routeProgress + maximumDistance,
      route.totalLength,
    );

    if (
      hasMeaningfulUpcomingCorner &&
      upcomingCorner !== null &&
      nextProgress > upcomingCorner.progress
    ) {
      nextProgress = upcomingCorner.progress;
    }

    const nextPosition = route.pointAtDistance(nextProgress);
    ship.setPosition(nextPosition);
    ship.advanceRouteProgress(nextProgress);
    if (
      upcomingCorner !== null &&
      upcomingCorner.turnAngleDeg >= REVERSAL_PIVOT_MIN_DEG &&
      Math.abs(nextProgress - upcomingCorner.progress) <= EPSILON
    ) {
      ship.beginRoutePivot(upcomingCorner.progress);
    } else if (
      nextProgress >= route.totalLength - EPSILON &&
      !routeEndContinuesForward(ship, continueAfterRouteEnd)
    ) {
      ship.setRouteSpeed(0);
    }
  }

  public step(ship: ShipModel, target: SteeringTarget, deltaSeconds: number): void {
    assertFinite(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be non-negative');
    }
    assertFinite(target.x, 'target.x');
    assertFinite(target.y, 'target.y');
    if (ship.state === ShipState.Destroyed) {
      return;
    }

    const desiredAngleDeg = normalizeRotationDeg(
      (Math.atan2(target.y - ship.y, target.x - ship.x) * 180) /
        Math.PI,
    );
    const rotationDeg = moveAngleTowardsDeg(
      ship.rotationDeg,
      desiredAngleDeg,
      ship.characteristics.turnRateDeg * deltaSeconds,
    );
    const rotationRadians = (rotationDeg * Math.PI) / 180;

    ship.setRotationDeg(rotationDeg);
    ship.setPositionXY(
      ship.x + Math.cos(rotationRadians) * ship.characteristics.speed * deltaSeconds,
      ship.y + Math.sin(rotationRadians) * ship.characteristics.speed * deltaSeconds,
    );
  }

  #stepForwardDistance(ship: ShipModel, distance: number): number {
    assertFinite(distance, 'distance');
    if (distance < 0) {
      throw new RangeError('distance must be non-negative');
    }
    if (distance === 0) return 0;
    const rotationRadians = (ship.rotationDeg * Math.PI) / 180;
    ship.setPositionXY(
      ship.x + Math.cos(rotationRadians) * distance,
      ship.y + Math.sin(rotationRadians) * distance,
    );
    return distance;
  }

  #stepForward(ship: ShipModel, deltaSeconds: number): void {
    assertFinite(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be non-negative');
    }
    this.#stepForwardDistance(ship, ship.characteristics.speed * deltaSeconds);
  }
}
