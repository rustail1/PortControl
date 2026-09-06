import type { LandClearanceGeometry } from '../geometry/LandClearanceGeometry.ts';
import type { ShipModel, ShipPosition } from '../ships/ShipModel.ts';
import { ShipState } from '../ships/ShipState.ts';

export interface GroundingShipCandidate {
  readonly ship: ShipModel;
  readonly spawnSequence: number;
  readonly previousPosition: ShipPosition;
}

export interface GroundingStepResult {
  readonly terminalGrounding: null;
  readonly avoidedShipIds: readonly string[];
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
  readonly #contacting = new Set<string>();

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
    const avoidedShipIds: string[] = [];
    const ordered = [...candidates].sort(
      (left, right) => left.spawnSequence - right.spawnSequence ||
        (left.ship.id < right.ship.id ? -1 : left.ship.id > right.ship.id ? 1 : 0),
    );
    for (const candidate of ordered) {
      if (
        !Number.isSafeInteger(candidate.spawnSequence) ||
        candidate.spawnSequence < 0
      ) {
        throw new RangeError('spawnSequence must be a non-negative safe integer');
      }
      if (!participatesInGrounding(candidate.ship.state)) {
        this.#contacting.delete(candidate.ship.id);
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
        this.#contacting.delete(candidate.ship.id);
        continue;
      }
      if (this.#contacting.has(candidate.ship.id)) continue;
      this.#contacting.add(candidate.ship.id);
      const awayX = candidate.previousPosition.x - candidate.ship.x;
      const awayY = candidate.previousPosition.y - candidate.ship.y;
      const awayHeading = Math.hypot(awayX, awayY) > 1e-9
        ? Math.atan2(awayY, awayX) * 180 / Math.PI
        : candidate.ship.rotationDeg + 180;
      candidate.ship.beginRouteRecovery(awayHeading);
      avoidedShipIds.push(candidate.ship.id);
    }
    return Object.freeze({
      terminalGrounding: null,
      avoidedShipIds: Object.freeze(avoidedShipIds),
    });
  }
}
