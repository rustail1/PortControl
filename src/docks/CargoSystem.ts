import type { DomainEventQueue } from '../core/DomainEventQueue.ts';
import { ShipState, type ShipModel } from '../ships/index.ts';
import type { DockModel } from './DockModel.ts';
import type { DockSystem } from './DockSystem.ts';

export type CargoDomainEvents = {
  readonly cargo_unloaded: {
    shipId: string;
    shipType: string;
    dockId: string;
    cargoType: string;
  };
};

export interface CargoUnloadCandidate {
  readonly ship: ShipModel;
  readonly dock: DockModel;
}

export interface CargoUnloadFact {
  readonly shipId: string;
  readonly shipType: string;
  readonly cargoType: string;
}

export interface CargoStepResult {
  readonly unloadedFacts: readonly CargoUnloadFact[];
}

export interface CargoSystemOptions {
  readonly dockSystem: DockSystem;
  readonly events: DomainEventQueue<CargoDomainEvents>;
  readonly resolveUnloadDurationMs?: (base: number, ship: ShipModel) => number;
}

interface Transaction {
  ship: ShipModel;
  dock: DockModel;
  elapsedMs: number;
  durationMs: number;
}

export class CargoSystem {
  readonly #dockSystem: DockSystem;
  readonly #events: DomainEventQueue<CargoDomainEvents>;
  readonly #resolve: (base: number, ship: ShipModel) => number;
  readonly #active = new Map<string, Transaction>();

  public constructor(options: CargoSystemOptions) {
    this.#dockSystem = options.dockSystem;
    this.#events = options.events;
    this.#resolve =
      options.resolveUnloadDurationMs ?? ((base) => base);
  }

  public step(
    candidates: readonly CargoUnloadCandidate[],
    deltaSeconds: number,
  ): CargoStepResult {
    if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0) {
      throw new RangeError(
        'deltaSeconds must be non-negative and finite',
      );
    }
    const unloadedFacts: CargoUnloadFact[] = [];
    for (const candidate of candidates) {
      if (
        !this.#active.has(candidate.ship.id) &&
        candidate.ship.state === ShipState.Unloading &&
        candidate.dock.occupiedBy === candidate.ship.id
      ) {
        const durationMs = this.#resolve(
          candidate.ship.characteristics.unloadStepMs,
          candidate.ship,
        );
        if (!Number.isFinite(durationMs) || durationMs <= 0) {
          throw new RangeError(
            'unload duration must be positive and finite',
          );
        }
        this.#active.set(candidate.ship.id, {
          ...candidate,
          elapsedMs: 0,
          durationMs,
        });
      }
    }
    for (const transaction of this.#active.values()) {
      this.#advance(transaction, deltaSeconds * 1000, unloadedFacts);
    }
    return Object.freeze({
      unloadedFacts: Object.freeze(unloadedFacts),
    });
  }

  #compatibleType(transaction: Transaction): string | null {
    return (
      transaction.dock.definition.acceptedCargoTypes.find(
        (type) => transaction.ship.cargoQuantity(type) > 0,
      ) ?? null
    );
  }

  #advance(
    transaction: Transaction,
    deltaMs: number,
    unloadedFacts: CargoUnloadFact[],
  ): void {
    if (
      transaction.ship.state === ShipState.ReadyToLeave &&
      transaction.dock.occupiedBy === transaction.ship.id
    ) {
      return;
    }
    if (transaction.ship.state === ShipState.Leaving) {
      if (transaction.dock.occupiedBy === transaction.ship.id) {
        this.#dockSystem.releaseOccupancy(
          transaction.dock,
          transaction.ship.id,
        );
      }
      this.#active.delete(transaction.ship.id);
      return;
    }
    if (
      transaction.ship.state !== ShipState.Unloading ||
      transaction.dock.occupiedBy !== transaction.ship.id
    ) {
      this.#active.delete(transaction.ship.id);
      return;
    }
    transaction.elapsedMs += deltaMs;
    while (transaction.elapsedMs >= transaction.durationMs) {
      const type = this.#compatibleType(transaction);
      if (type === null) {
        this.#finish(transaction);
        return;
      }
      transaction.elapsedMs -= transaction.durationMs;
      if (!transaction.ship.removeCargoUnit(type)) {
        this.#finish(transaction);
        return;
      }
      const fact: CargoUnloadFact = Object.freeze({
        shipId: transaction.ship.id,
        shipType: transaction.ship.characteristics.type,
        cargoType: type,
      });
      unloadedFacts.push(fact);
      this.#events.emit('cargo_unloaded', {
        shipId: transaction.ship.id,
        shipType: transaction.ship.characteristics.type,
        dockId: transaction.dock.id,
        cargoType: type,
      });
      if (this.#compatibleType(transaction) === null) {
        this.#finish(transaction);
        return;
      }
    }
  }

  #finish(transaction: Transaction): void {
    transaction.ship.clearRoute();
    if (transaction.ship.cargoTotal === 0) {
      transaction.ship.setState(ShipState.ReadyToLeave);
      return;
    }

    this.#active.delete(transaction.ship.id);
    if (
      !this.#dockSystem.releaseOccupancy(
        transaction.dock,
        transaction.ship.id,
      )
    ) {
      return;
    }
    transaction.ship.setState(ShipState.Navigating);
  }
}
