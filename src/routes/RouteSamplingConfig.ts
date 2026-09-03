import type { ConfigBundle } from '../config/types.ts';

import type { RouteSamplingConfig } from './RouteInputController.ts';

interface BalanceDocument {
  readonly route: RouteSamplingConfig;
}

export function createRouteSamplingConfig(
  bundle: ConfigBundle,
): RouteSamplingConfig {
  const balance = bundle.configs['balance.json'] as unknown as BalanceDocument;
  return Object.freeze({
    sampleDistance: balance.route.sampleDistance,
    maxRawPoints: balance.route.maxRawPoints,
  });
}
