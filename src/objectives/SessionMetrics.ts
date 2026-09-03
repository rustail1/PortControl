import type { CargoManifest } from '../ships/ShipModel.ts';

export interface CargoUnloadFactLike {
  readonly shipId: string;
  readonly shipType: string;
  readonly cargoType: string;
}

export interface ExitedShipFactLike {
  readonly shipId: string;
  readonly shipType: string;
  readonly scoreDelta: number;
}

export interface WrongDockAttemptFact {
  readonly shipId: string;
}

export interface StormHitFact {
  readonly shipId: string;
  readonly shipType: string;
}

export interface SpawnedShipProvenance {
  readonly shipId: string;
  readonly shipType: string;
  readonly initialPositiveCargoTypeCount: number;
}

export interface ServicedShipExitFact {
  readonly shipId: string;
  readonly shipType: string;
  readonly exitTimeSeconds: number;
}

export interface SessionMetricsSnapshot {
  readonly cargoUnloadedTotal: number;
  readonly cargoUnloadedByType: Readonly<Record<string, number>>;
  readonly servicedShipExits: number;
  readonly exitsByShipType: Readonly<Record<string, number>>;
  readonly warningCount: number;
  readonly wrongDockAttemptCount: number;
  readonly multiCargoShipExits: number;
  readonly stormHitsByShipType: Readonly<Record<string, number>>;
  readonly exitTimeline: readonly ServicedShipExitFact[];
  readonly spawnedShipProvenance: readonly SpawnedShipProvenance[];
  readonly countedExitShipIds: readonly string[];
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}

function assertNonNegativeFinite(value: number, label: string): void {
  if (!Number.isFinite(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative finite number`);
  }
}

function increment(record: Record<string, number>, key: string, amount = 1): void {
  record[key] = (record[key] ?? 0) + amount;
}

function copyCounter(source: Readonly<Record<string, number>>): Record<string, number> {
  const result: Record<string, number> = {};
  for (const [key, value] of Object.entries(source)) {
    assertNonNegativeInteger(value, `counter.${key}`);
    result[key] = value;
  }
  return result;
}

function freezeCounter(source: Readonly<Record<string, number>>): Readonly<Record<string, number>> {
  return Object.freeze({ ...source });
}

function positiveCargoTypeCount(cargo: CargoManifest): number {
  let count = 0;
  for (const [cargoType, quantity] of Object.entries(cargo)) {
    if (!cargoType) {
      throw new RangeError('cargo type must not be empty');
    }
    if (!Number.isFinite(quantity) || quantity < 0) {
      throw new RangeError(`cargo.${cargoType} must be a non-negative finite number`);
    }
    if (quantity > 0) {
      count += 1;
    }
  }
  return count;
}

export class SessionMetrics {
  #cargoUnloadedTotal = 0;
  #cargoUnloadedByType: Record<string, number> = {};
  #servicedShipExits = 0;
  #exitsByShipType: Record<string, number> = {};
  #warningCount = 0;
  #wrongDockAttemptCount = 0;
  #multiCargoShipExits = 0;
  #stormHitsByShipType: Record<string, number> = {};
  #exitTimeline: ServicedShipExitFact[] = [];
  readonly #spawnedShipProvenance = new Map<string, SpawnedShipProvenance>();
  readonly #countedExitShipIds = new Set<string>();

  public get cargoUnloadedTotal(): number {
    return this.#cargoUnloadedTotal;
  }

  public cargoUnloadedForType(cargoType: string): number {
    return this.#cargoUnloadedByType[cargoType] ?? 0;
  }

  public get servicedShipExits(): number {
    return this.#servicedShipExits;
  }

  public exitsForShipType(shipType: string): number {
    return this.#exitsByShipType[shipType] ?? 0;
  }

  public get warningCount(): number {
    return this.#warningCount;
  }

  public get wrongDockAttemptCount(): number {
    return this.#wrongDockAttemptCount;
  }

  public get multiCargoShipExits(): number {
    return this.#multiCargoShipExits;
  }

  public stormHitsForShipType(shipType: string): number {
    return this.#stormHitsByShipType[shipType] ?? 0;
  }

  public servicedExitsAtOrBefore(maxSeconds: number): number {
    assertNonNegativeFinite(maxSeconds, 'maxSeconds');
    let count = 0;
    for (const exit of this.#exitTimeline) {
      if (exit.exitTimeSeconds <= maxSeconds) {
        count += 1;
      }
    }
    return count;
  }

  public registerSpawnedShip(input: {
    readonly shipId: string;
    readonly shipType: string;
    readonly initialCargo: CargoManifest;
  }): void {
    if (!input.shipId) {
      throw new RangeError('shipId must not be empty');
    }
    if (!input.shipType) {
      throw new RangeError('shipType must not be empty');
    }
    const provenance = Object.freeze({
      shipId: input.shipId,
      shipType: input.shipType,
      initialPositiveCargoTypeCount: positiveCargoTypeCount(input.initialCargo),
    });
    const existing = this.#spawnedShipProvenance.get(input.shipId);
    if (existing !== undefined) {
      if (
        existing.shipType !== provenance.shipType ||
        existing.initialPositiveCargoTypeCount !== provenance.initialPositiveCargoTypeCount
      ) {
        throw new RangeError(`Conflicting spawned ship provenance: ${input.shipId}`);
      }
      return;
    }
    this.#spawnedShipProvenance.set(input.shipId, provenance);
  }

  public recordWarnings(count: number): void {
    assertNonNegativeInteger(count, 'warning count');
    this.#warningCount += count;
  }

  public recordCargoUnloaded(facts: readonly CargoUnloadFactLike[]): void {
    for (const fact of facts) {
      if (!fact.shipId || !fact.shipType || !fact.cargoType) {
        throw new RangeError('cargo unload fact ids must not be empty');
      }
      this.#cargoUnloadedTotal += 1;
      increment(this.#cargoUnloadedByType, fact.cargoType);
    }
  }

  public recordExit(fact: ExitedShipFactLike, exitTimeSeconds: number): boolean {
    if (!fact.shipId || !fact.shipType) {
      throw new RangeError('exit fact ids must not be empty');
    }
    assertNonNegativeFinite(exitTimeSeconds, 'exitTimeSeconds');
    if (this.#countedExitShipIds.has(fact.shipId)) {
      return false;
    }
    this.#countedExitShipIds.add(fact.shipId);
    this.#servicedShipExits += 1;
    increment(this.#exitsByShipType, fact.shipType);
    this.#exitTimeline.push(
      Object.freeze({
        shipId: fact.shipId,
        shipType: fact.shipType,
        exitTimeSeconds,
      }),
    );
    const provenance = this.#spawnedShipProvenance.get(fact.shipId);
    if (provenance?.initialPositiveCargoTypeCount !== undefined &&
        provenance.initialPositiveCargoTypeCount >= 2) {
      this.#multiCargoShipExits += 1;
    }
    return true;
  }

  public recordWrongDockAttempts(facts: readonly WrongDockAttemptFact[]): void {
    for (const fact of facts) {
      if (!fact.shipId) {
        throw new RangeError('wrong dock fact shipId must not be empty');
      }
      this.#wrongDockAttemptCount += 1;
    }
  }

  public recordStormHits(facts: readonly StormHitFact[]): void {
    for (const fact of facts) {
      if (!fact.shipId || !fact.shipType) {
        throw new RangeError('storm hit fact ids must not be empty');
      }
      increment(this.#stormHitsByShipType, fact.shipType);
    }
  }

  public toSnapshot(): SessionMetricsSnapshot {
    return Object.freeze({
      cargoUnloadedTotal: this.#cargoUnloadedTotal,
      cargoUnloadedByType: freezeCounter(this.#cargoUnloadedByType),
      servicedShipExits: this.#servicedShipExits,
      exitsByShipType: freezeCounter(this.#exitsByShipType),
      warningCount: this.#warningCount,
      wrongDockAttemptCount: this.#wrongDockAttemptCount,
      multiCargoShipExits: this.#multiCargoShipExits,
      stormHitsByShipType: freezeCounter(this.#stormHitsByShipType),
      exitTimeline: Object.freeze(
        this.#exitTimeline.map((exit) => Object.freeze({ ...exit })),
      ),
      spawnedShipProvenance: Object.freeze(
        [...this.#spawnedShipProvenance.values()].map((entry) =>
          Object.freeze({ ...entry }),
        ),
      ),
      countedExitShipIds: Object.freeze([...this.#countedExitShipIds]),
    });
  }

  public restore(snapshot: SessionMetricsSnapshot): void {
    assertNonNegativeInteger(snapshot.cargoUnloadedTotal, 'cargoUnloadedTotal');
    assertNonNegativeInteger(snapshot.servicedShipExits, 'servicedShipExits');
    assertNonNegativeInteger(snapshot.warningCount, 'warningCount');
    assertNonNegativeInteger(snapshot.wrongDockAttemptCount, 'wrongDockAttemptCount');
    assertNonNegativeInteger(snapshot.multiCargoShipExits, 'multiCargoShipExits');

    this.#cargoUnloadedTotal = snapshot.cargoUnloadedTotal;
    this.#cargoUnloadedByType = copyCounter(snapshot.cargoUnloadedByType);
    this.#servicedShipExits = snapshot.servicedShipExits;
    this.#exitsByShipType = copyCounter(snapshot.exitsByShipType);
    this.#warningCount = snapshot.warningCount;
    this.#wrongDockAttemptCount = snapshot.wrongDockAttemptCount;
    this.#multiCargoShipExits = snapshot.multiCargoShipExits;
    this.#stormHitsByShipType = copyCounter(snapshot.stormHitsByShipType);
    this.#exitTimeline = snapshot.exitTimeline.map((exit) => {
      if (!exit.shipId || !exit.shipType) {
        throw new RangeError('exit timeline ids must not be empty');
      }
      assertNonNegativeFinite(exit.exitTimeSeconds, 'exitTimeSeconds');
      return Object.freeze({ ...exit });
    });
    this.#spawnedShipProvenance.clear();
    for (const entry of snapshot.spawnedShipProvenance) {
      if (!entry.shipId || !entry.shipType) {
        throw new RangeError('spawn provenance ids must not be empty');
      }
      assertNonNegativeInteger(
        entry.initialPositiveCargoTypeCount,
        'initialPositiveCargoTypeCount',
      );
      this.#spawnedShipProvenance.set(entry.shipId, Object.freeze({ ...entry }));
    }
    this.#countedExitShipIds.clear();
    for (const shipId of snapshot.countedExitShipIds) {
      if (!shipId) {
        throw new RangeError('counted exit ship id must not be empty');
      }
      this.#countedExitShipIds.add(shipId);
    }
  }
}
