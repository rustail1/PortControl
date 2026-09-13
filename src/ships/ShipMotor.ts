import { normalizeRotationDeg, type ShipModel } from './ShipModel.ts';
import type { ShipRoute } from './ShipRoute.ts';
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

function angleDeltaDeg(left: number, right: number): number {
  return Math.abs(((right - left + 540) % 360) - 180);
}

function routePreviewHeadingDeg(
  route: ShipRoute,
  progress: number,
  lookaheadDistance: number,
): number | null {
  const current = route.pointAtDistance(progress);
  const preview = route.pointAtDistance(
    Math.min(progress + lookaheadDistance, route.totalLength),
  );
  const previewX = preview.x - current.x;
  const previewY = preview.y - current.y;
  if (Math.hypot(previewX, previewY) > 1e-9) {
    return normalizeRotationDeg(Math.atan2(previewY, previewX) * 180 / Math.PI);
  }

  const tangent = route.tangentAtDistance(progress);
  if (tangent === null) return null;
  return normalizeRotationDeg(Math.atan2(tangent.y, tangent.x) * 180 / Math.PI);
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
      if (continueAfterRouteEnd && (
        ship.state === ShipState.Entering ||
        ship.state === ShipState.Leaving
      )) {
        this.#stepForward(ship, deltaSeconds);
      }
      return;
    }

    // Preview only local authored geometry. The preview steers the hull early enough
    // to make corners readable while the navigation point continues to advance on
    // the exact canonical route below. A half-second preview preserves each ship's
    // configured speed/turn-rate feel without introducing a separate hidden path.
    const desiredAngleDeg = routePreviewHeadingDeg(
      route,
      ship.routeProgress,
      Math.max(waypointTolerance, ship.characteristics.speed * 0.5),
    );
    if (desiredAngleDeg === null) return;
    ship.setRotationDeg(moveAngleTowardsDeg(
      ship.rotationDeg,
      desiredAngleDeg,
      ship.characteristics.turnRateDeg * deltaSeconds,
    ));

    // COR-12 canonical-follow contract:
    // - the navigation point/ship centre advances on the exact visible route;
    // - hull rotation is independent and turn-rate limited;
    // - ordinary bends keep configured speed while >90-degree heading errors pause
    //   progress until the hull has turned enough to follow the authored route safely.
    const headingErrorDeg = angleDeltaDeg(ship.rotationDeg, desiredAngleDeg);
    const alignment = headingErrorDeg <= 90 ? 1 : 0;
    const maximumDistance = ship.characteristics.speed * deltaSeconds;
    const nextProgress = Math.min(
      ship.routeProgress + maximumDistance * alignment,
      route.totalLength,
    );
    const nextPosition = route.pointAtDistance(nextProgress);
    ship.setPosition(nextPosition);
    ship.advanceRouteProgress(nextProgress);
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
