// Visual response only: this never changes simulation heading, position, or speed.
const HEADING_RESPONSE_MS = 100;

export interface ShipVisualHeading {
  readonly targetHeading: number;
  readonly snap: boolean;
}

export function resolveShipVisualHeading(
  state: string,
  simulationHeading: number,
  dockAngle: number | undefined,
): ShipVisualHeading {
  if (!Number.isFinite(simulationHeading) ||
      dockAngle !== undefined && !Number.isFinite(dockAngle)) {
    throw new RangeError('ship visual headings must be finite');
  }
  if (dockAngle === undefined) {
    return Object.freeze({ targetHeading: simulationHeading, snap: false });
  }
  if (state === 'Docking') {
    return Object.freeze({ targetHeading: simulationHeading, snap: false });
  }
  if (state === 'Unloading') {
    return Object.freeze({
      targetHeading: ((dockAngle + 180) % 360 + 360) % 360,
      snap: false,
    });
  }
  if (state === 'ReadyToLeave') {
    return Object.freeze({
      targetHeading: ((dockAngle % 360) + 360) % 360,
      snap: true,
    });
  }
  return Object.freeze({ targetHeading: simulationHeading, snap: false });
}

export function smoothShipHeading(previous: number, target: number, deltaMs: number): number {
  if (![previous, target, deltaMs].every(Number.isFinite) || deltaMs < 0) {
    throw new RangeError('visual heading requires finite angles and non-negative elapsed time');
  }
  const difference = ((target - previous) % 360 + 540) % 360 - 180;
  const result = previous + difference * -Math.expm1(-deltaMs / HEADING_RESPONSE_MS);
  return ((result % 360) + 360) % 360;
}
