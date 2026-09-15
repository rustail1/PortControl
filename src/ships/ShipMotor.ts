import { LandRecoveryMotion, normalizeRotationDeg, RouteTurnMode, type ShipModel } from './ShipModel.ts';
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
const FULL_SPEED_HEADING_ERROR_DEG = 60;
const MIN_CORNER_SLOWDOWN_DEG = 15;
const ROUTE_HEADING_PIVOT_MIN_DEG = NORMAL_CORNER_MAX_DEG;
const REVERSAL_PIVOT_MIN_DEG = 120;
const ROUTE_REORIENTATION_RELEASE_ERROR_DEG = NORMAL_CORNER_MAX_DEG;
const REVERSAL_PIVOT_RELEASE_ERROR_DEG = 60;
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


function moveAngleTowardsDirectedDeg(
  rotationDeg: number,
  desiredAngleDeg: number,
  turnSign: -1 | 1,
  maximumDeltaDeg: number,
): number {
  assertFinite(maximumDeltaDeg, 'maximumDeltaDeg');
  if (maximumDeltaDeg < 0) {
    throw new RangeError('maximumDeltaDeg must be non-negative');
  }
  const current = normalizeRotationDeg(rotationDeg);
  const desired = normalizeRotationDeg(desiredAngleDeg);
  const remaining = turnSign === 1
    ? normalizeRotationDeg(desired - current)
    : normalizeRotationDeg(current - desired);
  if (remaining <= maximumDeltaDeg + EPSILON) return desired;
  return normalizeRotationDeg(current + turnSign * maximumDeltaDeg);
}

function angleDeltaDeg(left: number, right: number): number {
  return Math.abs(((right - left + 540) % 360) - 180);
}

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
    (ship.state === ShipState.Entering ||
      ship.state === ShipState.Navigating ||
      ship.state === ShipState.Leaving);
}

function stepRouteReorientation(
  ship: ShipModel,
  route: ShipRoute,
  travelHeadingDeg: number,
  deltaSeconds: number,
): void {
  ship.setRotationDeg(moveAngleTowardsDeg(
    ship.rotationDeg,
    travelHeadingDeg,
    ship.characteristics.turnRateDeg * deltaSeconds,
  ));
  ship.setRouteSpeed(0);
  const pivotProgress = ship.routePivotProgress;
  if (pivotProgress === null) {
    throw new Error('reorientation turn requires routePivotProgress');
  }
  ship.setPosition(route.pointAtDistance(pivotProgress));
  if (angleDeltaDeg(ship.rotationDeg, travelHeadingDeg) <= ROUTE_REORIENTATION_RELEASE_ERROR_DEG + EPSILON) {
    ship.finishRouteTurn();
  }
}

export class ShipMotor {
  public stepRoute(
    ship: ShipModel,
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
      const landRecoveryHeading = ship.landRecoveryHeadingDeg;
      if (landRecoveryHeading !== null) {
        assertFinite(deltaSeconds, 'deltaSeconds');
        if (deltaSeconds < 0) {
          throw new RangeError('deltaSeconds must be non-negative');
        }
        const turnSign = ship.landRecoveryTurnSign;
        const motion = ship.landRecoveryMotion;
        if (turnSign === null || motion === null) {
          throw new Error('land recovery requires heading, turn sign, and motion');
        }
        ship.setRotationDeg(moveAngleTowardsDirectedDeg(
          ship.rotationDeg,
          landRecoveryHeading,
          turnSign,
          ship.characteristics.turnRateDeg * deltaSeconds,
        ));
        if (motion === LandRecoveryMotion.Pivot) {
          ship.setRouteSpeed(0);
          return;
        }
        this.#stepForwardDistance(ship, ship.routeSpeed * deltaSeconds);
        return;
      }
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
        const nextSpeed = moveTowards(
          ship.routeSpeed,
          ship.characteristics.speed,
          routeAcceleration(ship) * deltaSeconds,
        );
        ship.setRouteSpeed(nextSpeed);
        this.#stepForwardDistance(ship, nextSpeed * deltaSeconds);
      }
      return;
    }

    assertFinite(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be non-negative');
    }
    if (ship.routeProgress >= route.totalLength) {
      if (routeEndContinuesForward(ship, continueAfterRouteEnd)) {
        const nextSpeed = moveTowards(
          ship.routeSpeed,
          ship.characteristics.speed,
          routeAcceleration(ship) * deltaSeconds,
        );
        ship.setRouteSpeed(nextSpeed);
        this.#stepForwardDistance(ship, nextSpeed * deltaSeconds);
      } else {
        ship.setRouteSpeed(0);
      }
      return;
    }

    const travelHeadingDeg = routeHeadingDeg(route, ship.routeProgress);
    if (travelHeadingDeg === null) return;

    if (ship.routePivotProgress !== null) {
      const turnMode = ship.routeTurnMode;
      if (turnMode === null) {
        throw new Error('route turn requires an explicit routeTurnMode');
      }
      if (turnMode === RouteTurnMode.Reorientation) {
        stepRouteReorientation(ship, route, travelHeadingDeg, deltaSeconds);
        return;
      }

      ship.setRotationDeg(moveAngleTowardsDeg(
        ship.rotationDeg,
        travelHeadingDeg,
        ship.characteristics.turnRateDeg * deltaSeconds,
      ));
      const pivotPosition = route.pointAtDistance(ship.routePivotProgress);
      ship.setPosition(pivotPosition);
      ship.setRouteSpeed(0);
      if (angleDeltaDeg(ship.rotationDeg, travelHeadingDeg) > REVERSAL_PIVOT_RELEASE_ERROR_DEG) return;
      ship.finishRouteTurn();
      return;
    // More than 90 degrees puts the authored tangent behind the hull's forward
    // half-plane. Reorient in place until forward exact-polyline motion is honest.
    } else if (angleDeltaDeg(ship.rotationDeg, travelHeadingDeg) > ROUTE_HEADING_PIVOT_MIN_DEG + EPSILON) {
      ship.beginRouteTurn(RouteTurnMode.Reorientation, ship.routeProgress);
      stepRouteReorientation(ship, route, travelHeadingDeg, deltaSeconds);
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
      ship.beginRouteTurn(RouteTurnMode.AuthoredReversal, upcomingCorner.progress);
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
