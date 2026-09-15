import { RuntimeConfigRegistry } from '../config/RuntimeConfigRegistry.ts';
import type { ConfigBundle } from '../config/types.ts';

export interface DockingConfig {
  readonly reservationTieBreak: string;
  readonly collisionEnabledDuringHarborAssist: boolean;
}

export function createDockingConfig(bundle: ConfigBundle): DockingConfig {
  const docking = new RuntimeConfigRegistry(bundle).balance().docking;
  return Object.freeze({ ...docking });
}
