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

    const position = ship.position;
    const desiredAngleDeg = normalizeRotationDeg(
      (Math.atan2(target.y - position.y, target.x - position.x) * 180) /
        Math.PI,
    );
    const rotationDeg = moveAngleTowardsDeg(
      ship.rotationDeg,
      desiredAngleDeg,
      ship.characteristics.turnRateDeg * deltaSeconds,
    );
    const rotationRadians = (rotationDeg * Math.PI) / 180;

    ship.setRotationDeg(rotationDeg);
    ship.setPosition({
      x: position.x + Math.cos(rotationRadians) * ship.characteristics.speed * deltaSeconds,
      y: position.y + Math.sin(rotationRadians) * ship.characteristics.speed * deltaSeconds,
    });
  }
}
