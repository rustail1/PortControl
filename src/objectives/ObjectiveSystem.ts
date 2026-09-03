import type { SessionMetrics } from './SessionMetrics.ts';

export type ObjectiveDefinition =
  | Readonly<{ type: 'deliver_cargo'; target: number }>
  | Readonly<{ type: 'deliver_cargo_type'; target: number; cargoType: string }>
  | Readonly<{ type: 'service_ships'; target: number }>
  | Readonly<{ type: 'survive_seconds'; target: number }>;

export interface ObjectiveProgressSnapshot {
  readonly type: ObjectiveDefinition['type'];
  readonly target: number;
  readonly cargoType?: string;
  readonly current: number;
  readonly completed: boolean;
  readonly completionTimeSeconds: number | null;
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

export function parseObjectiveDefinition(
  level: Record<string, unknown>,
): ObjectiveDefinition {
  const source = level['objective'];
  if (typeof source !== 'object' || source === null) {
    throw new RangeError('level.objective must be an object');
  }
  const objective = source as Record<string, unknown>;
  const type = objective['type'];
  const target = objective['target'];
  assertPositiveInteger(target, 'objective.target');

  switch (type) {
    case 'deliver_cargo':
      return Object.freeze({ type, target });
    case 'deliver_cargo_type': {
      const cargoType = objective['cargoType'];
      if (typeof cargoType !== 'string' || cargoType.length === 0) {
        throw new RangeError('objective.cargoType must not be empty');
      }
      return Object.freeze({ type, target, cargoType });
    }
    case 'service_ships':
      return Object.freeze({ type, target });
    case 'survive_seconds':
      return Object.freeze({ type, target });
    default:
      throw new RangeError(`Unknown objective type: ${String(type)}`);
  }
}

function copyProgress(snapshot: ObjectiveProgressSnapshot): ObjectiveProgressSnapshot {
  return Object.freeze({
    type: snapshot.type,
    target: snapshot.target,
    ...(snapshot.cargoType === undefined ? {} : { cargoType: snapshot.cargoType }),
    current: snapshot.current,
    completed: snapshot.completed,
    completionTimeSeconds: snapshot.completionTimeSeconds,
  });
}

export class ObjectiveSystem {
  readonly #definition: ObjectiveDefinition;
  #current = 0;
  #completed = false;
  #completionTimeSeconds: number | null = null;

  public constructor(definition: ObjectiveDefinition) {
    this.#definition = definition;
  }

  public get definition(): ObjectiveDefinition {
    return this.#definition;
  }

  public get completed(): boolean {
    return this.#completed;
  }

  public get completionTimeSeconds(): number | null {
    return this.#completionTimeSeconds;
  }

  public step(
    simulationTimeSeconds: number,
    metrics: SessionMetrics,
  ): ObjectiveProgressSnapshot {
    if (!Number.isFinite(simulationTimeSeconds) || simulationTimeSeconds < 0) {
      throw new RangeError('simulationTimeSeconds must be non-negative and finite');
    }
    if (this.#completed) {
      return this.toSnapshot();
    }

    switch (this.#definition.type) {
      case 'deliver_cargo':
        this.#current = metrics.cargoUnloadedTotal;
        break;
      case 'deliver_cargo_type':
        this.#current = metrics.cargoUnloadedForType(this.#definition.cargoType);
        break;
      case 'service_ships':
        this.#current = metrics.servicedShipExits;
        break;
      case 'survive_seconds':
        this.#current = simulationTimeSeconds;
        break;
    }

    if (this.#current >= this.#definition.target) {
      this.#completed = true;
      this.#completionTimeSeconds =
        this.#definition.type === 'survive_seconds'
          ? this.#definition.target
          : simulationTimeSeconds;
    }
    return this.toSnapshot();
  }

  public toSnapshot(): ObjectiveProgressSnapshot {
    return Object.freeze({
      type: this.#definition.type,
      target: this.#definition.target,
      ...(this.#definition.type === 'deliver_cargo_type'
        ? { cargoType: this.#definition.cargoType }
        : {}),
      current: this.#current,
      completed: this.#completed,
      completionTimeSeconds: this.#completionTimeSeconds,
    });
  }

  public restore(snapshot: ObjectiveProgressSnapshot): void {
    if (
      snapshot.type !== this.#definition.type ||
      snapshot.target !== this.#definition.target ||
      (this.#definition.type === 'deliver_cargo_type' &&
        snapshot.cargoType !== this.#definition.cargoType)
    ) {
      throw new RangeError('objective snapshot does not match level objective');
    }
    if (!Number.isFinite(snapshot.current) || snapshot.current < 0) {
      throw new RangeError('objective current must be non-negative and finite');
    }
    if (
      snapshot.completionTimeSeconds !== null &&
      (!Number.isFinite(snapshot.completionTimeSeconds) ||
        snapshot.completionTimeSeconds < 0)
    ) {
      throw new RangeError('objective completion time must be non-negative and finite');
    }
    if (snapshot.completed !== (snapshot.completionTimeSeconds !== null)) {
      throw new RangeError('objective completed/time snapshot is inconsistent');
    }
    this.#current = snapshot.current;
    this.#completed = snapshot.completed;
    this.#completionTimeSeconds = snapshot.completionTimeSeconds;
  }

  public copySnapshot(): ObjectiveProgressSnapshot {
    return copyProgress(this.toSnapshot());
  }
}
