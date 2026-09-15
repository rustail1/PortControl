import type { ShipPosition } from '../shared/geometry/Point.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import { normalizeRotationDeg } from '../ships/ShipModel.ts';
import { ShipRoute } from '../ships/ShipRoute.ts';
import { moveAngleTowardsDeg } from '../ships/ShipMotor.ts';

export type HarborManeuverMode = 'docking' | 'departure';

export interface HarborManeuverPath {
  readonly start: ShipPosition;
  readonly points: readonly ShipPosition[];
  readonly finalHeadingDeg: number;
  readonly phaseProgress: {
    readonly approachEnd: number;
    readonly alignmentEnd: number;
  };
}

export interface HarborManeuverState {
  readonly progress: number;
  readonly speed: number;
}

export interface HarborManeuverStepResult extends HarborManeuverState {
  readonly position: ShipPosition;
  readonly rotationDeg: number;
  readonly completed: boolean;
}

// Owner-approved semantic harbor feel. These are deliberately not Frozen
// machine values; Frozen Baseline fixed-duration docking data is not movement authority.
const APPROACH_SPEED_SCALE = 0.55;
const ALIGN_SPEED_SCALE = 0.32;
const CREEP_SPEED_SCALE = 0.12;
const DEPARTURE_EXIT_SPEED_SCALE = 0.60;
const HEADING_FULL_SPEED_ERROR_DEG = 20;
const HEADING_STOP_ERROR_DEG = 100;
const DOCK_POSITION_EPSILON = 1e-6;
const DOCK_HEADING_EPSILON_DEG = 1.5;
const DOCK_SPEED_EPSILON = 0.75;
const HARBOR_BRAKING_MULTIPLIER = 2.25;

function assertFiniteNonNegative(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function moveTowards(current: number, target: number, maximumDelta: number): number {
  if (current < target) return Math.min(current + maximumDelta, target);
  return Math.max(current - maximumDelta, target);
}

function angleDeltaDeg(left: number, right: number): number {
  return Math.abs(((right - left + 540) % 360) - 180);
}

function harborAcceleration(ship: ShipModel): number {
  return ship.characteristics.speed * Math.max(0.6, ship.characteristics.turnRateDeg / 120);
}

function harborBrakingAcceleration(ship: ShipModel): number {
  return harborAcceleration(ship) * HARBOR_BRAKING_MULTIPLIER;
}

function headingSpeedScale(errorDeg: number): number {
  if (errorDeg <= HEADING_FULL_SPEED_ERROR_DEG) return 1;
  if (errorDeg >= HEADING_STOP_ERROR_DEG) return 0;
  const t = (errorDeg - HEADING_FULL_SPEED_ERROR_DEG) /
    (HEADING_STOP_ERROR_DEG - HEADING_FULL_SPEED_ERROR_DEG);
  return Math.cos(t * Math.PI / 2) ** 2;
}

function dockingPhaseScale(
  progress: number,
  phaseProgress: HarborManeuverPath['phaseProgress'],
): number {
  if (progress < phaseProgress.approachEnd) return APPROACH_SPEED_SCALE;
  if (progress < phaseProgress.alignmentEnd) return ALIGN_SPEED_SCALE;
  return CREEP_SPEED_SCALE;
}

function departurePhaseScale(
  progress: number,
  totalLength: number,
): number {
  const progressRatio = totalLength <= DOCK_POSITION_EPSILON ? 1 : progress / totalLength;
  // Departure already starts from zero physical speed and is acceleration-limited.
  // Do not reuse inbound final-creep as an artificial launch plateau.
  if (progressRatio < 0.62) return ALIGN_SPEED_SCALE;
  return DEPARTURE_EXIT_SPEED_SCALE;
}

function brakingSpeedLimit(targetSpeed: number, acceleration: number, distance: number): number {
  return Math.sqrt(Math.max(0, targetSpeed * targetSpeed + 2 * acceleration * distance));
}

function routeFor(path: HarborManeuverPath): ShipRoute {
  if (path.points.length === 0) throw new RangeError('harbor maneuver path requires a point');
  return new ShipRoute(path.points, path.start);
}

function routeHeadingDeg(route: ShipRoute, progress: number): number | null {
  const tangent = route.tangentAtDistance(progress);
  if (tangent === null) return null;
  return normalizeRotationDeg(Math.atan2(tangent.y, tangent.x) * 180 / Math.PI);
}

function validatePhaseProgress(path: HarborManeuverPath, totalLength: number): void {
  const { approachEnd, alignmentEnd } = path.phaseProgress;
  assertFiniteNonNegative(approachEnd, 'harbor approach phase progress');
  assertFiniteNonNegative(alignmentEnd, 'harbor alignment phase progress');
  if (approachEnd > alignmentEnd + DOCK_POSITION_EPSILON) {
    throw new RangeError('harbor approach phase must end before alignment phase');
  }
  if (alignmentEnd > totalLength + DOCK_POSITION_EPSILON) {
    throw new RangeError('harbor alignment phase cannot end beyond maneuver path');
  }
}

function dockingBoundarySpeedLimit(
  ship: ShipModel,
  progress: number,
  totalLength: number,
  phaseProgress: HarborManeuverPath['phaseProgress'],
  acceleration: number,
): number {
  if (progress < phaseProgress.approachEnd) {
    return brakingSpeedLimit(
      ship.characteristics.speed * ALIGN_SPEED_SCALE,
      acceleration,
      phaseProgress.approachEnd - progress,
    );
  }
  if (progress < phaseProgress.alignmentEnd) {
    return brakingSpeedLimit(
      ship.characteristics.speed * CREEP_SPEED_SCALE,
      acceleration,
      phaseProgress.alignmentEnd - progress,
    );
  }
  return brakingSpeedLimit(0, acceleration, totalLength - progress);
}

export class HarborManeuverMotor {
  public step(
    ship: ShipModel,
    path: HarborManeuverPath,
    state: HarborManeuverState,
    mode: HarborManeuverMode,
    deltaSeconds: number,
  ): HarborManeuverStepResult {
    assertFiniteNonNegative(deltaSeconds, 'deltaSeconds');
    assertFiniteNonNegative(state.progress, 'maneuver progress');
    assertFiniteNonNegative(state.speed, 'maneuver speed');

    const route = routeFor(path);
    const totalLength = route.totalLength;
    validatePhaseProgress(path, totalLength);
    const progress = Math.min(state.progress, totalLength);
    const finalHeading = normalizeRotationDeg(path.finalHeadingDeg);
    const atPathEnd = progress >= totalLength - DOCK_POSITION_EPSILON;
    const travelHeading = routeHeadingDeg(route, progress) ?? finalHeading;
    const headingTarget = atPathEnd ? finalHeading : travelHeading;
    const rotationDeg = moveAngleTowardsDeg(
      ship.rotationDeg,
      headingTarget,
      ship.characteristics.turnRateDeg * deltaSeconds,
    );
    const headingError = angleDeltaDeg(rotationDeg, headingTarget);
    const headingScale = headingSpeedScale(headingError);
    const acceleration = harborAcceleration(ship);
    const brakingAcceleration = harborBrakingAcceleration(ship);
    const baseScale = mode === 'docking'
      ? dockingPhaseScale(progress, path.phaseProgress)
      : departurePhaseScale(progress, totalLength);
    let targetSpeed = ship.characteristics.speed * baseScale * headingScale;

    if (mode === 'docking') {
      targetSpeed = atPathEnd
        ? 0
        : Math.min(
            targetSpeed,
            dockingBoundarySpeedLimit(
              ship,
              progress,
              totalLength,
              path.phaseProgress,
              brakingAcceleration,
            ),
          );
    }

    const currentSpeed = Math.min(state.speed, ship.characteristics.speed);
    const speed = moveTowards(
      currentSpeed,
      targetSpeed,
      (currentSpeed > targetSpeed ? brakingAcceleration : acceleration) * deltaSeconds,
    );
    const forwardProjection = Math.max(0, Math.cos(headingError * Math.PI / 180));
    const translationSpeed = speed * headingScale * forwardProjection;
    const nextProgress = Math.min(progress + translationSpeed * deltaSeconds, totalLength);
    const position = route.pointAtDistance(nextProgress);

    if (mode === 'departure') {
      return Object.freeze({
        progress: nextProgress,
        speed,
        position: Object.freeze(position),
        rotationDeg,
        completed: nextProgress >= totalLength - DOCK_POSITION_EPSILON,
      });
    }

    const remaining = totalLength - nextProgress;
    const completed = remaining <= DOCK_POSITION_EPSILON &&
      speed <= DOCK_SPEED_EPSILON &&
      angleDeltaDeg(rotationDeg, finalHeading) <= DOCK_HEADING_EPSILON_DEG;

    return Object.freeze({
      progress: nextProgress,
      speed: completed ? 0 : speed,
      position: Object.freeze(position),
      rotationDeg: completed ? finalHeading : rotationDeg,
      completed,
    });
  }
}
