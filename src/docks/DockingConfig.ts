import type { ConfigBundle } from '../config/types.ts';

export interface DockingConfig {
  readonly baseSnapDurationMs: number;
  readonly reservationTieBreak: string;
  readonly collisionEnabledUntilSnapComplete: boolean;
}

interface BalanceDocument {
  readonly docking: DockingConfig;
}

export function createDockingConfig(bundle: ConfigBundle): DockingConfig {
  const balance = bundle.configs['balance.json'] as unknown as BalanceDocument;
  return Object.freeze({ ...balance.docking });
}
