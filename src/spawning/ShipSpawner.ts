import type { ShipCharacteristicsRegistry } from '../ships/ShipCharacteristics.ts';
import { ShipModel } from '../ships/ShipModel.ts';
import { ShipState } from '../ships/ShipState.ts';
import type { ReadySpawnCommand } from './IncomingSpawnSystem.ts';

export interface SpawnedShipRecord {
  readonly ship: ShipModel;
  readonly spawnSequence: number;
  readonly transactionId: string;
  readonly spawnPointId: string;
}

export class ShipSpawner {
  readonly #characteristics: ShipCharacteristicsRegistry;

  public constructor(characteristics: ShipCharacteristicsRegistry) {
    this.#characteristics = characteristics;
  }

  public materialize(command: ReadySpawnCommand): SpawnedShipRecord {
    const ship = new ShipModel({
      id: command.payload.shipId,
      characteristics: this.#characteristics.require(command.payload.shipType),
      position: {
        x: command.spawnPoint.x,
        y: command.spawnPoint.y,
      },
      rotationDeg: command.spawnPoint.directionDeg,
      state: ShipState.Entering,
      cargo: command.payload.cargo,
      route: null,
    });

    return Object.freeze({
      ship,
      spawnSequence: command.payload.spawnSequence,
      transactionId: command.transactionId,
      spawnPointId: command.spawnPointId,
    });
  }
}
