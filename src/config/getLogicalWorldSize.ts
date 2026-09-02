import type { Size } from '../camera/SquareWorldViewport.ts';
import type { ConfigBundle } from './types.ts';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getLogicalWorldSize(bundle: ConfigBundle): Size {
  const balance = bundle.configs['balance.json'];
  const simulation = balance?.['simulation'];
  const logicalWorld = isRecord(simulation)
    ? simulation['logicalWorld']
    : undefined;

  if (
    !Array.isArray(logicalWorld) ||
    logicalWorld.length !== 2 ||
    typeof logicalWorld[0] !== 'number' ||
    typeof logicalWorld[1] !== 'number'
  ) {
    throw new TypeError(
      'Validated balance config must define simulation.logicalWorld',
    );
  }

  return Object.freeze({ width: logicalWorld[0], height: logicalWorld[1] });
}
