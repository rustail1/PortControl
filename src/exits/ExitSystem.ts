import type { ConfigBundle } from '../config/types.ts';
import type { DomainEventQueue } from '../core/DomainEventQueue.ts';
import { ShipState, type ShipModel } from '../ships/index.ts';

export interface ExitZoneDefinition {
  readonly id: string;
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly edge: string;
}

export type ExitDomainEvents = {
  readonly ship_exited: {
    shipId: string;
    shipType: string;
    scoreDelta: number;
  };
};

export interface ExitedShipFact {
  readonly shipId: string;
  readonly shipType: string;
  readonly scoreDelta: number;
}

export interface ExitStepResult {
  readonly pendingShipIds: readonly string[];
  readonly rejectedCargoShipIds: readonly string[];
  readonly despawnedShipIds: readonly string[];
  readonly scoreDelta: number;
  readonly exitedShipFacts: readonly ExitedShipFact[];
}

type ExitBlock = {
  blockType?: string;
  enabled?: boolean;
  id: string;
  x: number;
  y: number;
  props: { width: number; height: number; edge: string };
};

export function createExitZones(
  level: Record<string, unknown>,
): readonly ExitZoneDefinition[] {
  const blocks = (
    (level.layout as { blocks?: unknown[] }).blocks ?? []
  ) as ExitBlock[];
  return Object.freeze(
    blocks
      .filter(
        (block) =>
          block.blockType === 'exit_zone' && block.enabled,
      )
      .map((block) =>
        Object.freeze({
          id: block.id,
          x: block.x,
          y: block.y,
          width: block.props.width,
          height: block.props.height,
          edge: block.props.edge,
        }),
      ),
  );
}

export function createExitScore(bundle: ConfigBundle): number {
  return (
    bundle.configs['balance.json'] as {
      score: { shipExit: number };
    }
  ).score.shipExit;
}

export class ExitSystem {
  readonly #zones: readonly ExitZoneDefinition[];
  readonly #score: number;
  readonly #events: DomainEventQueue<ExitDomainEvents>;
  readonly #pending = new Map<string, ShipModel>();
  readonly #done = new Set<string>();
  readonly #insideCargo = new Set<string>();
  readonly #seen = new Set<string>();

  public constructor(options: {
    zones: readonly ExitZoneDefinition[];
    score: number;
    events: DomainEventQueue<ExitDomainEvents>;
  }) {
    this.#zones = options.zones;
    this.#score = options.score;
    this.#events = options.events;
  }

  public step(ships: readonly ShipModel[]): ExitStepResult {
    const result = {
      pendingShipIds: [] as string[],
      rejectedCargoShipIds: [] as string[],
      despawnedShipIds: [] as string[],
      scoreDelta: 0,
      exitedShipFacts: [] as ExitedShipFact[],
    };
    this.#finalizePending(result);
    this.#seen.clear();
    for (const ship of ships) {
      if (
        this.#seen.has(ship.id) ||
        this.#done.has(ship.id) ||
        this.#pending.has(ship.id)
      ) {
        continue;
      }
      this.#seen.add(ship.id);
      this.#detect(ship, result);
    }
    return result;
  }

  #finalizePending(result: {
    despawnedShipIds: string[];
    scoreDelta: number;
    exitedShipFacts: ExitedShipFact[];
  }): void {
    for (const [id, ship] of this.#pending) {
      this.#pending.delete(id);
      if (
        ship.state !== ShipState.Leaving ||
        ship.cargoTotal !== 0
      ) {
        continue;
      }
      this.#done.add(id);
      result.despawnedShipIds.push(id);
      result.scoreDelta += this.#score;
      const fact: ExitedShipFact = Object.freeze({
        shipId: id,
        shipType: ship.characteristics.type,
        scoreDelta: this.#score,
      });
      result.exitedShipFacts.push(fact);
      this.#events.emit('ship_exited', fact);
    }
  }

  #detect(
    ship: ShipModel,
    result: {
      pendingShipIds: string[];
      rejectedCargoShipIds: string[];
    },
  ): void {
    if (!this.#insideAny(ship)) {
      this.#insideCargo.delete(ship.id);
      return;
    }
    if (ship.cargoTotal > 0) {
      if (!this.#insideCargo.has(ship.id)) {
        ship.clearRoute();
        result.rejectedCargoShipIds.push(ship.id);
      }
      this.#insideCargo.add(ship.id);
      return;
    }
    if (ship.state === ShipState.Leaving) {
      this.#pending.set(ship.id, ship);
      result.pendingShipIds.push(ship.id);
    }
  }

  #insideAny(ship: ShipModel): boolean {
    for (const zone of this.#zones) {
      if (
        ship.x >= zone.x - zone.width / 2 &&
        ship.x <= zone.x + zone.width / 2 &&
        ship.y >= zone.y - zone.height / 2 &&
        ship.y <= zone.y + zone.height / 2
      ) {
        return true;
      }
    }
    return false;
  }
}
