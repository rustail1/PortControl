import type { SimulationSnapshot } from './SessionSnapshot.ts';

export interface SnapshotBoundaryState {
  readonly queuedCommands: number;
  readonly hasLiveDraft: boolean;
  readonly pendingEvents: number;
}

export class SimulationSnapshotService {
  public capture<T extends SimulationSnapshot>(
    snapshot: T,
    boundary: SnapshotBoundaryState,
  ): T {
    if (
      boundary.queuedCommands !== 0 ||
      boundary.hasLiveDraft ||
      boundary.pendingEvents !== 0
    ) {
      throw new Error(
        'simulation snapshot requires a clean end-of-fixed-step boundary',
      );
    }
    return structuredClone(snapshot) as T;
  }
}
