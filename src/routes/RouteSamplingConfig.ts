import { RuntimeConfigRegistry } from '../config/RuntimeConfigRegistry.ts';
import type { ConfigBundle } from '../config/types.ts';
import type { RouteSamplingConfig } from './RouteInputController.ts';

export function createRouteSamplingConfig(bundle: ConfigBundle): RouteSamplingConfig {
  const route = new RuntimeConfigRegistry(bundle).balance().route;
  return Object.freeze({
    sampleDistance: route.sampleDistance,
    maxRawPoints: route.maxRawPoints,
  });
}
