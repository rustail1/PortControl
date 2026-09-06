import { normalizeRotationDeg, type ShipModel } from './ShipModel.ts';
import { ShipState } from './ShipState.ts';

export interface SteeringTarget {
  readonly x: number;
  readonly y: number;
}

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

export class ShipMotor {
  public stepRoute(ship: ShipModel, waypointTolerance: number, deltaSeconds: number): void {
    if (
      ship.state !== ShipState.Entering &&
      ship.state !== ShipState.Navigating &&
      ship.state !== ShipState.ReadyToLeave &&
      ship.state !== ShipState.Leaving
    ) return;
    const route = ship.route;
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
    if (ship.routeProgress >= route.totalLength) {
      if (
        ship.state === ShipState.Entering ||
        ship.state === ShipState.Navigating ||
        ship.state === ShipState.Leaving
      ) {
        this.#stepForward(ship, deltaSeconds);
      }
      return;
    }
    assertFinite(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be non-negative');
    }
    const cursor = route.cursorAtDistance(ship.routeProgress);
    const segmentEnd = route.distanceAtCursor(cursor + 1);
    ship.advanceRouteProgress(
      route.projectProgress(
        ship.position,
        ship.routeProgress,
        segmentEnd - ship.routeProgress,
      ),
    );
    const nextProgress = Math.min(
      ship.routeProgress + ship.characteristics.speed * deltaSeconds,
      route.totalLength,
    );
    const nextPosition = route.pointAtDistance(nextProgress);
    ship.setPosition(nextPosition);
    ship.advanceRouteProgress(nextProgress);

    const headingPoint = route.pointAtDistance(
      Math.min(nextProgress + waypointTolerance, route.totalLength),
    );
    const headingX = headingPoint.x - nextPosition.x;
    const headingY = headingPoint.y - nextPosition.y;
    const tangent = Math.hypot(headingX, headingY) > 1e-9
      ? { x: headingX, y: headingY }
      : route.tangentAtDistance(nextProgress);
    if (tangent !== null) {
      ship.setRotationDeg(
        (Math.atan2(tangent.y, tangent.x) * 180) / Math.PI,
      );
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

  #stepForward(ship: ShipModel, deltaSeconds: number): void {
    assertFinite(deltaSeconds, 'deltaSeconds');
    if (deltaSeconds < 0) {
      throw new RangeError('deltaSeconds must be non-negative');
    }
    const rotationRadians = (ship.rotationDeg * Math.PI) / 180;
    ship.setPositionXY(
      ship.x + Math.cos(rotationRadians) * ship.characteristics.speed * deltaSeconds,
      ship.y + Math.sin(rotationRadians) * ship.characteristics.speed * deltaSeconds,
    );
  }
}
