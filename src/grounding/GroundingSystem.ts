import type { GroundingTerminalCandidate } from '../core/GameSession.ts';
import type { LandClearanceGeometry } from '../geometry/LandClearanceGeometry.ts';
import type { ShipModel, ShipPosition } from '../ships/ShipModel.ts';
import { ShipState } from '../ships/ShipState.ts';

export interface GroundingShipCandidate {
  readonly ship: ShipModel;
  readonly spawnSequence: number;
  readonly previousPosition: ShipPosition;
}

export interface GroundingStepResult {
  readonly terminalGrounding: GroundingTerminalCandidate | null;
}

export function participatesInGrounding(state: ShipModel['state']): boolean {
  return (
    state === ShipState.Entering ||
    state === ShipState.Navigating ||
    state === ShipState.ApproachingDock ||
    state === ShipState.Leaving
  );
}

export class GroundingSystem {
  readonly #geometry: LandClearanceGeometry;
  readonly #navigationClearanceExtra: number;

  public constructor(options: {
    readonly geometry: LandClearanceGeometry;
    readonly navigationClearanceExtra: number;
  }) {
    if (
      !Number.isFinite(options.navigationClearanceExtra) ||
      options.navigationClearanceExtra < 0
    ) {
      throw new RangeError(
        'navigationClearanceExtra must be a non-negative finite number',
      );
    }
    this.#geometry = options.geometry;
    this.#navigationClearanceExtra = options.navigationClearanceExtra;
  }

  public resolve(candidates: readonly GroundingShipCandidate[]): GroundingStepResult {
    let winner: GroundingShipCandidate | null = null;
    for (const candidate of candidates) {
      if (
        !Number.isSafeInteger(candidate.spawnSequence) ||
        candidate.spawnSequence < 0
      ) {
        throw new RangeError('spawnSequence must be a non-negative safe integer');
      }
      if (!participatesInGrounding(candidate.ship.state)) {
        continue;
      }
      const clearance =
        candidate.ship.characteristics.collisionRadius +
        this.#navigationClearanceExtra;
      if (
        !this.#geometry.blocksSegment(
          candidate.previousPosition,
          candidate.ship.position,
          clearance,
        )
      ) {
        continue;
      }
      if (
        winner === null ||
        candidate.spawnSequence < winner.spawnSequence ||
        (candidate.spawnSequence === winner.spawnSequence &&
          candidate.ship.id < winner.ship.id)
      ) {
        winner = candidate;
      }
    }
    if (winner === null) {
      return Object.freeze({ terminalGrounding: null });
    }
    return Object.freeze({
      terminalGrounding: Object.freeze({
        shipId: winner.ship.id,
        failReason: 'grounding' as const,
        details: Object.freeze({ spawnSequence: winner.spawnSequence }),
      }),
    });
  }
}
