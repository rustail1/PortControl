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
const FULL_SPEED_HEADING_ERROR_DEG = 60;
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

function alignmentSpeedScale(headingErrorDeg: number): number {
  if (headingErrorDeg <= FULL_SPEED_HEADING_ERROR_DEG) return 1;
  if (headingErrorDeg >= NORMAL_CORNER_MAX_DEG) return 0;

  const ramp = (
    NORMAL_CORNER_MAX_DEG - headingErrorDeg
  ) / (
    NORMAL_CORNER_MAX_DEG - FULL_SPEED_HEADING_ERROR_DEG
  );
  return ramp * ramp * (3 - 2 * ramp);
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
  if (Math.hypot(previewX, previewY) > EPSILON) {
    return normalizeRotationDeg(Math.atan2(previewY, previewX) * 180 / Math.PI);
  }
  return routeHeadingDeg(route, progress);
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
        this.#stepForward(ship, deltaSeconds);
      }
      return;
    }

    const travelHeadingDeg = routeHeadingDeg(route, ship.routeProgress);
    if (travelHeadingDeg === null) return;

    const upcomingCorner = findUpcomingCorner(route, ship.routeProgress);
    const hasSharpUpcomingCorner = upcomingCorner !== null &&
      upcomingCorner.progress > ship.routeProgress + EPSILON &&
      upcomingCorner.turnAngleDeg > NORMAL_CORNER_MAX_DEG;

    // Ordinary bends are anticipated locally so the hull starts turning before the
    // raw vertex without changing the canonical route. Sharp/reverse turns stay on
    // their incoming tangent until the authored vertex, then pivot there.
    const steeringHeadingDeg = hasSharpUpcomingCorner
      ? travelHeadingDeg
      : routePreviewHeadingDeg(
          route,
          ship.routeProgress,
          Math.max(waypointTolerance, ship.characteristics.speed * 0.5),
        ) ?? travelHeadingDeg;

    ship.setRotationDeg(moveAngleTowardsDeg(
      ship.rotationDeg,
      steeringHeadingDeg,
      ship.characteristics.turnRateDeg * deltaSeconds,
    ));

    // Translation always belongs to the canonical route. A route more than 90 degrees
    // behind the bow still forces an in-place pivot, but the first frames after that
    // pivot ease back into motion instead of snapping from zero to full cruise speed.
    // Once the hull is within 60 degrees of the route, configured cruise speed is kept.
    const travelHeadingErrorDeg = angleDeltaDeg(ship.rotationDeg, travelHeadingDeg);
    const speedScale = alignmentSpeedScale(travelHeadingErrorDeg);
    const maximumDistance = ship.characteristics.speed * speedScale * deltaSeconds;
    let nextProgress = Math.min(
      ship.routeProgress + maximumDistance,
      route.totalLength,
    );

    // Do not jump across a >90-degree turnaround in one fixed step. Reaching the
    // exact authored vertex gives the hull a deterministic place to pivot.
    if (
      hasSharpUpcomingCorner &&
      upcomingCorner !== null &&
      nextProgress > upcomingCorner.progress
    ) {
      nextProgress = upcomingCorner.progress;
    }

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
