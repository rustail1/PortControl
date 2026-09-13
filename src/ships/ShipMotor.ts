import { normalizeRotationDeg, type ShipModel } from './ShipModel.ts';
import type { ShipRoute } from './ShipRoute.ts';
import { ShipState } from './ShipState.ts';

export interface SteeringTarget { readonly x: number; readonly y: number; }
interface UpcomingCorner { readonly progress: number; readonly turnAngleDeg: number; }
const MIN_CORNER_ANGLE_DEG = 15;
const FULL_PIVOT_ERROR_DEG = 150;
const EPSILON = 1e-7;

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) throw new RangeError(`${label} must be finite`);
}
export function moveAngleTowardsDeg(rotationDeg: number, desiredAngleDeg: number, maximumDeltaDeg: number): number {
  assertFinite(maximumDeltaDeg, 'maximumDeltaDeg');
  if (maximumDeltaDeg < 0) throw new RangeError('maximumDeltaDeg must be non-negative');
  const current = normalizeRotationDeg(rotationDeg);
  const desired = normalizeRotationDeg(desiredAngleDeg);
  const shortestDelta = ((desired - current + 540) % 360) - 180;
  if (Math.abs(shortestDelta) <= maximumDeltaDeg) return desired;
  return normalizeRotationDeg(current + Math.sign(shortestDelta) * maximumDeltaDeg);
}
function angleDeltaDeg(left: number, right: number): number { return Math.abs(((right - left + 540) % 360) - 180); }
function segmentHeadingDeg(route: ShipRoute, index: number): number | null {
  const start = route.segmentStartAt(index); const end = route.at(index);
  if (start === null || end === null) return null;
  const dx = end.x - start.x; const dy = end.y - start.y;
  if (Math.hypot(dx, dy) <= EPSILON) return null;
  return normalizeRotationDeg(Math.atan2(dy, dx) * 180 / Math.PI);
}
function routeHeadingDeg(route: ShipRoute, progress: number): number | null {
  const tangent = route.tangentAtDistance(progress); if (tangent === null) return null;
  return normalizeRotationDeg(Math.atan2(tangent.y, tangent.x) * 180 / Math.PI);
}
function findUpcomingCorner(route: ShipRoute, progress: number): UpcomingCorner | null {
  const currentCursor = route.cursorAtDistance(progress);
  let incomingHeading = segmentHeadingDeg(route, currentCursor) ?? routeHeadingDeg(route, progress);
  if (incomingHeading === null) return null;
  for (let index = currentCursor; index < route.length - 1; index += 1) {
    const outgoingHeading = segmentHeadingDeg(route, index + 1); if (outgoingHeading === null) continue;
    const turnAngleDeg = angleDeltaDeg(incomingHeading, outgoingHeading);
    if (turnAngleDeg >= MIN_CORNER_ANGLE_DEG) return { progress: route.distanceAtCursor(index + 1), turnAngleDeg };
    incomingHeading = outgoingHeading;
  }
  return null;
}
function lerp(left: number, right: number, t: number): number { return left + (right - left) * Math.min(Math.max(t, 0), 1); }
function maneuverSpeedScale(angleDeg: number): number {
  const angle = Math.min(Math.max(angleDeg, 0), 180);
  if (angle <= 15) return 1;
  if (angle <= 45) return lerp(1, 0.85, (angle - 15) / 30);
  if (angle <= 90) return lerp(0.85, 0.25, (angle - 45) / 45);
  if (angle <= 120) return lerp(0.25, 0.08, (angle - 90) / 30);
  if (angle <= 150) return lerp(0.08, 0, (angle - 120) / 30);
  return 0;
}
function brakingAcceleration(ship: ShipModel): number {
  return ship.characteristics.speed * Math.max(0.65, ship.characteristics.turnRateDeg / 120);
}
function isAtAuthoredCorner(route: ShipRoute, progress: number): boolean {
  if (progress <= EPSILON || progress >= route.totalLength - EPSILON) return false;
  const cursor = route.cursorAtDistance(progress);
  return cursor > 0 && Math.abs(route.distanceAtCursor(cursor) - progress) <= EPSILON;
}
function routeEndRequiresStop(ship: ShipModel, continueAfterRouteEnd: boolean): boolean {
  if (!continueAfterRouteEnd) return true;
  return ship.state === ShipState.Navigating || ship.state === ShipState.ReadyToLeave;
}

export class ShipMotor {
  public stepRoute(ship: ShipModel, waypointTolerance: number, deltaSeconds: number, continueAfterRouteEnd = true): void {
    if (ship.state !== ShipState.Entering && ship.state !== ShipState.Navigating && ship.state !== ShipState.ReadyToLeave && ship.state !== ShipState.Leaving) return;
    const route = ship.route;
    if (route !== null && ship.routeMotionHeld) return;
    if (route === null) {
      const recoveryHeading = ship.routeRecoveryHeadingDeg;
      if (recoveryHeading !== null) {
        assertFinite(deltaSeconds, 'deltaSeconds'); if (deltaSeconds < 0) throw new RangeError('deltaSeconds must be non-negative');
        ship.setRotationDeg(moveAngleTowardsDeg(ship.rotationDeg, recoveryHeading, ship.characteristics.turnRateDeg * deltaSeconds));
        if (ship.rotationDeg === recoveryHeading) ship.finishRouteRecovery();
        this.#stepForward(ship, deltaSeconds); return;
      }
      if (!ship.routeMotionHeld && (ship.state === ShipState.Entering || ship.state === ShipState.Navigating || ship.state === ShipState.Leaving)) this.#stepForward(ship, deltaSeconds);
      return;
    }
    assertFinite(deltaSeconds, 'deltaSeconds'); if (deltaSeconds < 0) throw new RangeError('deltaSeconds must be non-negative');
    assertFinite(waypointTolerance, 'waypointTolerance'); if (waypointTolerance < 0) throw new RangeError('waypointTolerance must be non-negative');
    if (ship.routeProgress >= route.totalLength) {
      if (continueAfterRouteEnd && (ship.state === ShipState.Entering || ship.state === ShipState.Leaving)) this.#stepForward(ship, deltaSeconds);
      return;
    }
    const desiredAngleDeg = routeHeadingDeg(route, ship.routeProgress); if (desiredAngleDeg === null) return;
    ship.setRotationDeg(moveAngleTowardsDeg(ship.rotationDeg, desiredAngleDeg, ship.characteristics.turnRateDeg * deltaSeconds));
    const cruiseSpeed = ship.characteristics.speed;
    const headingErrorDeg = angleDeltaDeg(ship.rotationDeg, desiredAngleDeg);
    let speed = cruiseSpeed * maneuverSpeedScale(headingErrorDeg);
    const braking = brakingAcceleration(ship);
    const corner = findUpcomingCorner(route, ship.routeProgress);
    if (corner !== null && corner.progress > ship.routeProgress + EPSILON) {
      const distanceToCorner = corner.progress - ship.routeProgress;
      const targetCornerSpeed = cruiseSpeed * maneuverSpeedScale(corner.turnAngleDeg);
      const allowedApproachSpeed = Math.sqrt(targetCornerSpeed * targetCornerSpeed + 2 * braking * distanceToCorner);
      speed = Math.min(speed, allowedApproachSpeed);
    }
    if (routeEndRequiresStop(ship, continueAfterRouteEnd)) {
      const distanceToEnd = Math.max(route.totalLength - ship.routeProgress, 0);
      const allowedEndSpeed = Math.sqrt(2 * braking * distanceToEnd);
      speed = Math.min(speed, allowedEndSpeed);
    }
    if (isAtAuthoredCorner(route, ship.routeProgress) && headingErrorDeg >= FULL_PIVOT_ERROR_DEG) speed = 0;
    let nextProgress = Math.min(ship.routeProgress + speed * deltaSeconds, route.totalLength);
    if (corner !== null && corner.progress > ship.routeProgress + EPSILON && nextProgress > corner.progress) nextProgress = corner.progress;
    const nextPosition = route.pointAtDistance(nextProgress);
    ship.setPosition(nextPosition); ship.advanceRouteProgress(nextProgress);
  }
  public step(ship: ShipModel, target: SteeringTarget, deltaSeconds: number): void {
    assertFinite(deltaSeconds, 'deltaSeconds'); if (deltaSeconds < 0) throw new RangeError('deltaSeconds must be non-negative');
    assertFinite(target.x, 'target.x'); assertFinite(target.y, 'target.y'); if (ship.state === ShipState.Destroyed) return;
    const desiredAngleDeg = normalizeRotationDeg((Math.atan2(target.y - ship.y, target.x - ship.x) * 180) / Math.PI);
    const rotationDeg = moveAngleTowardsDeg(ship.rotationDeg, desiredAngleDeg, ship.characteristics.turnRateDeg * deltaSeconds);
    const rotationRadians = (rotationDeg * Math.PI) / 180;
    ship.setRotationDeg(rotationDeg);
    ship.setPositionXY(ship.x + Math.cos(rotationRadians) * ship.characteristics.speed * deltaSeconds, ship.y + Math.sin(rotationRadians) * ship.characteristics.speed * deltaSeconds);
  }
  #stepForwardDistance(ship: ShipModel, distance: number): number {
    assertFinite(distance, 'distance'); if (distance < 0) throw new RangeError('distance must be non-negative'); if (distance === 0) return 0;
    const rotationRadians = (ship.rotationDeg * Math.PI) / 180;
    ship.setPositionXY(ship.x + Math.cos(rotationRadians) * distance, ship.y + Math.sin(rotationRadians) * distance); return distance;
  }
  #stepForward(ship: ShipModel, deltaSeconds: number): void {
    assertFinite(deltaSeconds, 'deltaSeconds'); if (deltaSeconds < 0) throw new RangeError('deltaSeconds must be non-negative');
    this.#stepForwardDistance(ship, ship.characteristics.speed * deltaSeconds);
  }
}
