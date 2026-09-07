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

const SHORE_CLAMP_ITERATIONS = 32;
const TURN_AWAY_SEARCH_STEPS = 180;

function pointAlong(
  start: ShipPosition,
  end: ShipPosition,
  progress: number,
): ShipPosition {
  return {
    x: start.x + (end.x - start.x) * progress,
    y: start.y + (end.y - start.y) * progress,
  };
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
      const wasContacting = this.#contacting.has(candidate.ship.id);
      this.#contacting.add(candidate.ship.id);
      const correction = this.#turnAwayFromBlockedStep(
        candidate.previousPosition,
        candidate.ship.position,
        clearance,
      );
      candidate.ship.setPosition(correction.position);
      candidate.ship.beginRouteRecovery(correction.headingDeg);
      if (!wasContacting) avoidedShipIds.push(candidate.ship.id);
    }
    return Object.freeze({
      terminalGrounding: null,
      avoidedShipIds: Object.freeze(avoidedShipIds),
    });
  }

  #turnAwayFromBlockedStep(
    start: ShipPosition,
    blockedEnd: ShipPosition,
    clearance: number,
  ): { readonly position: ShipPosition; readonly headingDeg: number } {
    const movementX = blockedEnd.x - start.x;
    const movementY = blockedEnd.y - start.y;
    const movementDistance = Math.hypot(movementX, movementY);
    const reverseHeadingDeg = movementDistance > 1e-9
      ? Math.atan2(-movementY, -movementX) * 180 / Math.PI
      : 180;
    if (movementDistance <= 1e-9 || this.#geometry.blocksSegment(start, start, clearance)) {
      return { position: { ...start }, headingDeg: reverseHeadingDeg };
    }

    let validProgress = 0;
    let blockedProgress = 1;
    for (let iteration = 0; iteration < SHORE_CLAMP_ITERATIONS; iteration += 1) {
      const midpoint = (validProgress + blockedProgress) / 2;
      if (this.#geometry.blocksSegment(start, pointAlong(start, blockedEnd, midpoint), clearance)) {
        blockedProgress = midpoint;
      } else {
        validProgress = midpoint;
      }
    }
    const shoreline = pointAlong(start, blockedEnd, validProgress);
    const remainingDistance = movementDistance * (1 - validProgress);
    const movementHeading = Math.atan2(movementY, movementX);
    for (let step = 91; step <= TURN_AWAY_SEARCH_STEPS; step += 1) {
      for (const sign of [1, -1]) {
        const heading = movementHeading + sign * step * Math.PI / 180;
        const position = {
          x: shoreline.x + Math.cos(heading) * remainingDistance,
          y: shoreline.y + Math.sin(heading) * remainingDistance,
        };
        if (
          !this.#geometry.blocksSegment(shoreline, position, clearance) &&
          !this.#geometry.blocksSegment(start, position, clearance)
        ) {
          return {
            position,
            headingDeg: heading * 180 / Math.PI,
          };
        }
      }
    }
    return { position: shoreline, headingDeg: reverseHeadingDeg };
  }
}
