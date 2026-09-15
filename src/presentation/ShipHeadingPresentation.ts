// Visual response only: this never changes simulation heading, position, or speed.
const HEADING_RESPONSE_MS = 100;

export function smoothShipHeading(previous: number, target: number, deltaMs: number): number {
  if (![previous, target, deltaMs].every(Number.isFinite) || deltaMs < 0) {
    throw new RangeError('visual heading requires finite angles and non-negative elapsed time');
  }
  const difference = ((target - previous) % 360 + 540) % 360 - 180;
  const result = previous + difference * -Math.expm1(-deltaMs / HEADING_RESPONSE_MS);
  return ((result % 360) + 360) % 360;
}
