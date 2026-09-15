import type { DomainEventQueue } from './DomainEventQueue.ts';
import type { CollisionDomainEvents, CollisionStepResult } from '../collision/CollisionSystem.ts';
import type { CargoDomainEvents, CargoStepResult } from '../docks/CargoSystem.ts';
import type { ExitDomainEvents, ExitStepResult } from '../exits/ExitSystem.ts';

export function projectAcceptedFacts(input: {
  readonly collision: CollisionStepResult;
  readonly cargo: CargoStepResult;
  readonly exit: ExitStepResult;
  readonly collisionEvents: DomainEventQueue<CollisionDomainEvents>;
  readonly cargoEvents: DomainEventQueue<CargoDomainEvents>;
  readonly exitEvents: DomainEventQueue<ExitDomainEvents>;
}): void {
  for (const fact of input.collision.dangerWarnings) input.collisionEvents.emit('danger_warning', fact);
  if (input.collision.terminalCollision !== null) input.collisionEvents.emit('collision', { shipAId: input.collision.terminalCollision.shipAId, shipBId: input.collision.terminalCollision.shipBId, failReason: 'collision' });
  for (const fact of input.cargo.unloadedFacts) input.cargoEvents.emit('cargo_unloaded', fact);
  for (const fact of input.exit.exitedShipFacts) input.exitEvents.emit('ship_exited', fact);
}
