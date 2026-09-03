import type { ConfigBundle } from '../config/types.ts';
import type { DomainEventQueue } from '../core/DomainEventQueue.ts';
import { ShipState, type ShipModel } from '../ships/index.ts';

export interface CollisionConfig {
  readonly warningRearmOutsideMs: number;
}

export interface CollisionShipCandidate {
  readonly ship: ShipModel;
  readonly spawnSequence: number;
}

export type CollisionDomainEvents = {
  readonly danger_warning: {
    readonly shipAId: string;
    readonly shipBId: string;
  };
  readonly collision: {
    readonly shipAId: string;
    readonly shipBId: string;
    readonly failReason: 'collision';
  };
};

export interface TerminalCollision {
  readonly shipAId: string;
  readonly shipBId: string;
  readonly distanceSquared: number;
  readonly failReason: 'collision';
}

export interface CollisionStepResult {
  readonly terminalCollision: TerminalCollision | null;
}

interface PairState {
  armed: boolean;
  outsideElapsedMs: number;
}

function assertNonNegativeFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${name} must be a non-negative finite number`);
  }
}

export function participatesInShipCollision(state: ShipState): boolean {
  return (
    state === ShipState.Entering ||
    state === ShipState.Navigating ||
    state === ShipState.ApproachingDock ||
    state === ShipState.Docking ||
    state === ShipState.Leaving
  );
}

/** Tracks unordered danger-pair entries without constructing pair-key strings. */
export class DangerPairTracker {
  readonly #pairs = new Map<string, Map<string, PairState>>();

  public entered(
    firstId: string,
    secondId: string,
    inside: boolean,
    deltaMilliseconds: number,
    rearmOutsideMilliseconds: number,
  ): boolean {
    let normalizedFirstId = firstId;
    let normalizedSecondId = secondId;
    if (normalizedSecondId < normalizedFirstId) {
      normalizedFirstId = secondId;
      normalizedSecondId = firstId;
    }
    if (inside) {
      const state = this.#get(normalizedFirstId, normalizedSecondId);
      if (state === undefined) {
        this.#set(normalizedFirstId, normalizedSecondId, { armed: false, outsideElapsedMs: 0 });
        return true;
      }
      if (state.armed) {
        state.armed = false;
        state.outsideElapsedMs = 0;
        return true;
      }
      state.outsideElapsedMs = 0;
      return false;
    }

    const state = this.#get(normalizedFirstId, normalizedSecondId);
    if (state === undefined) {
      return false;
    }
    state.outsideElapsedMs += deltaMilliseconds;
    if (state.outsideElapsedMs >= rearmOutsideMilliseconds) {
      this.#delete(normalizedFirstId, normalizedSecondId);
    }
    return false;
  }

  public forgetShip(shipId: string): void {
    this.#pairs.delete(shipId);
    for (const [firstId, seconds] of this.#pairs) {
      seconds.delete(shipId);
      if (seconds.size === 0) {
        this.#pairs.delete(firstId);
      }
    }
  }

  #get(firstId: string, secondId: string): PairState | undefined {
    return this.#pairs.get(firstId)?.get(secondId);
  }

  #set(firstId: string, secondId: string, state: PairState): void {
    let seconds = this.#pairs.get(firstId);
    if (seconds === undefined) {
      seconds = new Map<string, PairState>();
      this.#pairs.set(firstId, seconds);
    }
    seconds.set(secondId, state);
  }

  #delete(firstId: string, secondId: string): void {
    const seconds = this.#pairs.get(firstId);
    if (seconds === undefined) {
      return;
    }
    seconds.delete(secondId);
    if (seconds.size === 0) {
      this.#pairs.delete(firstId);
    }
  }
}

export function createCollisionConfig(bundle: ConfigBundle): CollisionConfig {
  const balance = bundle.configs['balance.json'] as {
    readonly collision: { readonly warningRearmOutsideMs: number };
  };
  const warningRearmOutsideMs = balance.collision.warningRearmOutsideMs;
  assertNonNegativeFinite(warningRearmOutsideMs, 'warningRearmOutsideMs');
  return Object.freeze({ warningRearmOutsideMs });
}

export class CollisionSystem {
  readonly #events: DomainEventQueue<CollisionDomainEvents>;
  readonly #config: CollisionConfig;
  readonly #dangerPairs = new DangerPairTracker();
  readonly #dangerFirst: CollisionShipCandidate[] = [];
  readonly #dangerSecond: CollisionShipCandidate[] = [];
  readonly #seenShipIds = new Set<string>();
  readonly #seenSpawnSequences = new Set<number>();
  #terminal: TerminalCollision | null = null;

  public constructor(options: {
    readonly events: DomainEventQueue<CollisionDomainEvents>;
    readonly config: CollisionConfig;
  }) {
    this.#events = options.events;
    this.#config = options.config;
  }

  public forgetShip(shipId: string): void {
    this.#dangerPairs.forgetShip(shipId);
  }

  public step(
    candidates: readonly CollisionShipCandidate[],
    deltaSeconds: number,
  ): CollisionStepResult {
    assertNonNegativeFinite(deltaSeconds, 'deltaSeconds');
    if (this.#terminal !== null) {
      return { terminalCollision: null };
    }
    this.#validateCandidates(candidates);
    this.#dangerFirst.length = 0;
    this.#dangerSecond.length = 0;

    let winningFirst: CollisionShipCandidate | null = null;
    let winningSecond: CollisionShipCandidate | null = null;
    let winningDistanceSquared = 0;
    const deltaMilliseconds = deltaSeconds * 1000;
    for (let firstIndex = 0; firstIndex < candidates.length; firstIndex += 1) {
      const firstCandidate = candidates[firstIndex];
      if (!participatesInShipCollision(firstCandidate.ship.state)) {
        continue;
      }
      for (let secondIndex = firstIndex + 1; secondIndex < candidates.length; secondIndex += 1) {
        const secondCandidate = candidates[secondIndex];
        if (!participatesInShipCollision(secondCandidate.ship.state)) {
          continue;
        }
        let first = firstCandidate;
        let second = secondCandidate;
        if (second.spawnSequence < first.spawnSequence) {
          first = secondCandidate;
          second = firstCandidate;
        }
        const dx = first.ship.x - second.ship.x;
        const dy = first.ship.y - second.ship.y;
        const distanceSquared = dx * dx + dy * dy;
        const warningRadius =
          first.ship.characteristics.warningRadius +
          second.ship.characteristics.warningRadius;
        if (
          this.#dangerPairs.entered(
            first.ship.id,
            second.ship.id,
            distanceSquared <= warningRadius * warningRadius,
            deltaMilliseconds,
            this.#config.warningRearmOutsideMs,
          )
        ) {
          this.#dangerFirst.push(first);
          this.#dangerSecond.push(second);
        }

        const collisionRadius =
          first.ship.characteristics.collisionRadius +
          second.ship.characteristics.collisionRadius;
        if (distanceSquared <= collisionRadius * collisionRadius) {
          if (
            winningFirst === null ||
            winningSecond === null ||
            this.#isEarlierCollision(
              first,
              second,
              distanceSquared,
              winningFirst,
              winningSecond,
              winningDistanceSquared,
            )
          ) {
            winningFirst = first;
            winningSecond = second;
            winningDistanceSquared = distanceSquared;
          }
        }
      }
    }

    if (winningFirst !== null && winningSecond !== null) {
      const terminalCollision: TerminalCollision = {
        shipAId: winningFirst.ship.id,
        shipBId: winningSecond.ship.id,
        distanceSquared: winningDistanceSquared,
        failReason: 'collision',
      };
      this.#terminal = terminalCollision;
      this.#dangerFirst.length = 0;
      this.#dangerSecond.length = 0;
      this.#events.emit('collision', {
        shipAId: terminalCollision.shipAId,
        shipBId: terminalCollision.shipBId,
        failReason: 'collision',
      });
      return { terminalCollision };
    }

    for (let index = 0; index < this.#dangerFirst.length; index += 1) {
      this.#events.emit('danger_warning', {
        shipAId: this.#dangerFirst[index].ship.id,
        shipBId: this.#dangerSecond[index].ship.id,
      });
    }
    return { terminalCollision: null };
  }

  #validateCandidates(candidates: readonly CollisionShipCandidate[]): void {
    this.#seenShipIds.clear();
    this.#seenSpawnSequences.clear();
    for (const candidate of candidates) {
      if (!Number.isInteger(candidate.spawnSequence) || candidate.spawnSequence < 0) {
        throw new RangeError('spawnSequence must be a non-negative integer');
      }
      if (this.#seenShipIds.has(candidate.ship.id)) {
        throw new RangeError(`Duplicate collision candidate ship: ${candidate.ship.id}`);
      }
      if (this.#seenSpawnSequences.has(candidate.spawnSequence)) {
        throw new RangeError(`Duplicate collision candidate spawnSequence: ${candidate.spawnSequence}`);
      }
      this.#seenShipIds.add(candidate.ship.id);
      this.#seenSpawnSequences.add(candidate.spawnSequence);
    }
  }

  #isEarlierCollision(
    candidateFirst: CollisionShipCandidate,
    candidateSecond: CollisionShipCandidate,
    candidateDistanceSquared: number,
    currentFirst: CollisionShipCandidate,
    currentSecond: CollisionShipCandidate,
    currentDistanceSquared: number,
  ): boolean {
    if (candidateDistanceSquared !== currentDistanceSquared) {
      return candidateDistanceSquared < currentDistanceSquared;
    }
    if (candidateFirst.spawnSequence !== currentFirst.spawnSequence) {
      return candidateFirst.spawnSequence < currentFirst.spawnSequence;
    }
    return candidateSecond.spawnSequence < currentSecond.spawnSequence;
  }
}
