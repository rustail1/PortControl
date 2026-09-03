import type { DomainEventQueue } from '../core/DomainEventQueue.ts';
import { ShipState, type ShipModel } from '../ships/index.ts';
import type { DockModel } from './DockModel.ts';
import type { DockSystem } from './DockSystem.ts';

export interface CargoDomainEvents { readonly [key: string]: unknown; cargo_unloaded: { shipId: string; shipType: string; dockId: string; cargoType: string }; }
export interface CargoUnloadCandidate { readonly ship: ShipModel; readonly dock: DockModel; }
export interface CargoSystemOptions { readonly dockSystem: DockSystem; readonly events: DomainEventQueue<CargoDomainEvents>; readonly resolveUnloadDurationMs?: (base: number, ship: ShipModel) => number; }
interface Transaction { ship: ShipModel; dock: DockModel; elapsedMs: number; durationMs: number; }
export class CargoSystem {
  readonly #dockSystem: DockSystem; readonly #events: DomainEventQueue<CargoDomainEvents>; readonly #resolve: (base: number, ship: ShipModel) => number; readonly #active = new Map<string, Transaction>();
  public constructor(options: CargoSystemOptions) { this.#dockSystem=options.dockSystem; this.#events=options.events; this.#resolve=options.resolveUnloadDurationMs ?? ((base)=>base); }
  public step(candidates: readonly CargoUnloadCandidate[], deltaSeconds: number): void {
    if (!Number.isFinite(deltaSeconds)||deltaSeconds<0) throw new RangeError('deltaSeconds must be non-negative and finite');
    for (const candidate of candidates) if (!this.#active.has(candidate.ship.id) && candidate.ship.state===ShipState.Unloading && candidate.dock.occupiedBy===candidate.ship.id) { const durationMs=this.#resolve(candidate.ship.characteristics.unloadStepMs,candidate.ship); if(!Number.isFinite(durationMs)||durationMs<=0) throw new RangeError('unload duration must be positive and finite'); this.#active.set(candidate.ship.id,{...candidate,elapsedMs:0,durationMs}); }
    for (const transaction of [...this.#active.values()]) this.#advance(transaction,deltaSeconds*1000);
  }
  #compatibleType(transaction: Transaction): string | null { return transaction.dock.definition.acceptedCargoTypes.find((type)=>transaction.ship.cargoQuantity(type)>0) ?? null; }
  #advance(transaction: Transaction, deltaMs: number): void {
    if (transaction.ship.state!==ShipState.Unloading || transaction.dock.occupiedBy!==transaction.ship.id) { this.#active.delete(transaction.ship.id); return; }
    transaction.elapsedMs += deltaMs;
    while (transaction.elapsedMs >= transaction.durationMs) {
      const type=this.#compatibleType(transaction); if(type===null) return this.#finish(transaction);
      transaction.elapsedMs -= transaction.durationMs;
      if (!transaction.ship.removeCargoUnit(type)) return this.#finish(transaction);
      this.#events.emit('cargo_unloaded',{shipId:transaction.ship.id,shipType:transaction.ship.characteristics.type,dockId:transaction.dock.id,cargoType:type});
      if (this.#compatibleType(transaction)===null) return this.#finish(transaction);
    }
  }
  #finish(transaction: Transaction): void { this.#active.delete(transaction.ship.id); if(!this.#dockSystem.releaseOccupancy(transaction.dock,transaction.ship.id)) return; transaction.ship.clearRoute(); transaction.ship.setState(transaction.ship.cargoTotal===0?ShipState.ReadyToLeave:ShipState.Navigating); }
}
