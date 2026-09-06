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

function isHeadingInward(rotationDeg: number, edge: string): boolean {
  const radians = rotationDeg * Math.PI / 180;
  switch (edge) {
    case 'left': return Math.cos(radians) > 0;
    case 'right': return Math.cos(radians) < 0;
    case 'top': return Math.sin(radians) > 0;
    case 'bottom': return Math.sin(radians) < 0;
    default: throw new RangeError(`Unknown exit edge: ${edge}`);
  }
}

interface ExitWorldBounds {
  readonly width: number;
  readonly height: number;
}

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
  readonly #worldBounds: ExitWorldBounds;
  readonly #pending = new Map<string, ShipModel>();
  readonly #done = new Set<string>();
  readonly #insideCargo = new Set<string>();
  readonly #enteringThroughExit = new Set<string>();
  readonly #untouchedEnteredWorld = new Set<string>();
  readonly #untouchedReturned = new Set<string>();
  readonly #insideUntouchedBoundary = new Set<string>();
  readonly #seen = new Set<string>();

  public constructor(options: {
    zones: readonly ExitZoneDefinition[];
    worldBounds: ExitWorldBounds;
    score: number;
    events: DomainEventQueue<ExitDomainEvents>;
  }) {
    if (
      !Number.isFinite(options.worldBounds.width) ||
      !Number.isFinite(options.worldBounds.height) ||
      options.worldBounds.width <= 0 ||
      options.worldBounds.height <= 0
    ) {
      throw new RangeError('worldBounds dimensions must be positive and finite');
    }
    this.#zones = options.zones;
    this.#worldBounds = Object.freeze({ ...options.worldBounds });
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
      despawnedShipIds: string[];
    },
  ): void {
    if (ship.routeRecoveryHeadingDeg !== null) {
      return;
    }
    const zone = this.#containingZone(ship);
    const boundaryEdge = zone?.edge ?? this.#touchingWorldEdge(ship);
    if (boundaryEdge === null) {
      this.#insideCargo.delete(ship.id);
      this.#enteringThroughExit.delete(ship.id);
      this.#insideUntouchedBoundary.delete(ship.id);
      if (ship.state === ShipState.Entering) {
        this.#untouchedEnteredWorld.add(ship.id);
      }
      return;
    }
    if (ship.state === ShipState.Entering) {
      if (!this.#untouchedEnteredWorld.has(ship.id)) {
        this.#enteringThroughExit.add(ship.id);
        return;
      }
      if (this.#insideUntouchedBoundary.has(ship.id)) {
        return;
      }
      this.#insideUntouchedBoundary.add(ship.id);
      if (!this.#untouchedReturned.has(ship.id)) {
        this.#untouchedReturned.add(ship.id);
        ship.beginRouteRecovery(this.#returnHeadingDeg(ship));
        return;
      }
      this.#done.add(ship.id);
      this.#untouchedEnteredWorld.delete(ship.id);
      this.#untouchedReturned.delete(ship.id);
      this.#insideUntouchedBoundary.delete(ship.id);
      result.despawnedShipIds.push(ship.id);
      return;
    }
    if (ship.cargoTotal > 0) {
      if (this.#enteringThroughExit.has(ship.id)) {
        if (isHeadingInward(ship.rotationDeg, boundaryEdge)) {
          return;
        }
        this.#enteringThroughExit.delete(ship.id);
      }
      if (
        this.#insideCargo.has(ship.id) &&
        (ship.route === null || isHeadingInward(ship.rotationDeg, boundaryEdge))
      ) {
        return;
      }
      if (
        this.#insideUntouchedBoundary.has(ship.id) &&
        ship.route !== null &&
        isHeadingInward(ship.rotationDeg, boundaryEdge)
      ) {
        this.#insideCargo.add(ship.id);
        return;
      }
      if (!this.#insideCargo.has(ship.id) || ship.route !== null) {
        ship.setState(ShipState.Navigating);
        ship.beginRouteRecovery(this.#returnHeadingDeg(ship));
        result.rejectedCargoShipIds.push(ship.id);
      }
      this.#insideCargo.add(ship.id);
      return;
    }
    if (ship.state === ShipState.Leaving && zone !== null) {
      this.#pending.set(ship.id, ship);
      result.pendingShipIds.push(ship.id);
    }
  }

  #returnHeadingDeg(ship: ShipModel): number {
    return (
      Math.atan2(
        this.#worldBounds.height / 2 - ship.y,
        this.#worldBounds.width / 2 - ship.x,
      ) * 180 / Math.PI + 360
    ) % 360;
  }

  #touchingWorldEdge(ship: ShipModel): string | null {
    const radius = ship.characteristics.collisionRadius;
    const contacts = [
      { edge: 'left', penetration: radius - ship.x },
      { edge: 'right', penetration: ship.x + radius - this.#worldBounds.width },
      { edge: 'top', penetration: radius - ship.y },
      { edge: 'bottom', penetration: ship.y + radius - this.#worldBounds.height },
    ].filter((contact) => contact.penetration >= 0);
    if (contacts.length === 0) return null;
    contacts.sort((a, b) => b.penetration - a.penetration);
    return contacts[0].edge;
  }

  #containingZone(ship: ShipModel): ExitZoneDefinition | null {
    for (const zone of this.#zones) {
      if (
        ship.x >= zone.x - zone.width / 2 &&
        ship.x <= zone.x + zone.width / 2 &&
        ship.y >= zone.y - zone.height / 2 &&
        ship.y <= zone.y + zone.height / 2
      ) {
        return zone;
      }
    }
    return null;
  }
}
