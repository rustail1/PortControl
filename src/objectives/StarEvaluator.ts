import type { SessionMetrics, SessionMetricsSnapshot } from './SessionMetrics.ts';

export type StarCondition =
  | Readonly<{ type: 'complete' }>
  | Readonly<{ type: 'max_warnings'; value: number }>
  | Readonly<{ type: 'max_time_seconds'; value: number }>
  | Readonly<{ type: 'min_cargo'; value: number }>
  | Readonly<{ type: 'max_wrong_dock_attempts'; value: number }>
  | Readonly<{ type: 'min_multi_cargo_ships'; value: number }>
  | Readonly<{ type: 'min_ship_exits'; shipId: string; value: number }>
  | Readonly<{ type: 'min_ship_group_exits'; shipIds: readonly string[]; value: number }>
  | Readonly<{ type: 'service_ships_under_time'; shipTarget: number; maxSeconds: number }>
  | Readonly<{ type: 'max_hazard_hits_by_ship'; hazardType: 'storm'; shipId: string; value: number }>;

export interface StarResult {
  readonly condition: StarCondition;
  readonly earned: boolean;
}

function assertNonNegativeInteger(value: unknown, label: string): asserts value is number {
  if (!Number.isInteger(value) || (value as number) < 0) {
    throw new RangeError(`${label} must be a non-negative integer`);
  }
}

function assertPositiveInteger(value: unknown, label: string): asserts value is number {
  assertNonNegativeInteger(value, label);
  if ((value as number) < 1) {
    throw new RangeError(`${label} must be a positive integer`);
  }
}

function copyCondition(condition: StarCondition): StarCondition {
  if (condition.type === 'min_ship_group_exits') {
    return Object.freeze({
      ...condition,
      shipIds: Object.freeze([...condition.shipIds]),
    });
  }
  return Object.freeze({ ...condition });
}

export function parseStarConditions(
  level: Record<string, unknown>,
): readonly StarCondition[] {
  const source = level['starConditions'];
  if (!Array.isArray(source) || source.length !== 3) {
    throw new RangeError('level.starConditions must contain exactly three entries');
  }
  const result = source.map((entry, index): StarCondition => {
    if (typeof entry !== 'object' || entry === null) {
      throw new RangeError(`starConditions[${index}] must be an object`);
    }
    const star = entry as Record<string, unknown>;
    const type = star['type'];
    switch (type) {
      case 'complete':
        return Object.freeze({ type });
      case 'max_warnings':
      case 'max_time_seconds':
      case 'min_cargo':
      case 'max_wrong_dock_attempts':
      case 'min_multi_cargo_ships': {
        const value = star['value'];
        assertNonNegativeInteger(value, `${type}.value`);
        return Object.freeze({ type, value });
      }
      case 'min_ship_exits': {
        const shipId = star['shipId'];
        const value = star['value'];
        if (typeof shipId !== 'string' || shipId.length === 0) {
          throw new RangeError('min_ship_exits.shipId must not be empty');
        }
        assertPositiveInteger(value, 'min_ship_exits.value');
        return Object.freeze({ type, shipId, value });
      }
      case 'min_ship_group_exits': {
        const shipIds = star['shipIds'];
        const value = star['value'];
        if (
          !Array.isArray(shipIds) ||
          shipIds.length === 0 ||
          shipIds.some((shipId) => typeof shipId !== 'string' || shipId.length === 0)
        ) {
          throw new RangeError('min_ship_group_exits.shipIds must contain ship type ids');
        }
        assertPositiveInteger(value, 'min_ship_group_exits.value');
        return Object.freeze({
          type,
          shipIds: Object.freeze([...shipIds] as string[]),
          value,
        });
      }
      case 'service_ships_under_time': {
        const shipTarget = star['shipTarget'];
        const maxSeconds = star['maxSeconds'];
        assertPositiveInteger(shipTarget, 'service_ships_under_time.shipTarget');
        assertPositiveInteger(maxSeconds, 'service_ships_under_time.maxSeconds');
        return Object.freeze({ type, shipTarget, maxSeconds });
      }
      case 'max_hazard_hits_by_ship': {
        const hazardType = star['hazardType'];
        const shipId = star['shipId'];
        const value = star['value'];
        if (hazardType !== 'storm') {
          throw new RangeError('max_hazard_hits_by_ship.hazardType must be storm');
        }
        if (typeof shipId !== 'string' || shipId.length === 0) {
          throw new RangeError('max_hazard_hits_by_ship.shipId must not be empty');
        }
        assertNonNegativeInteger(value, 'max_hazard_hits_by_ship.value');
        return Object.freeze({ type, hazardType, shipId, value });
      }
      default:
        throw new RangeError(`Unknown star condition type: ${String(type)}`);
    }
  });
  return Object.freeze(result);
}

function metricValue(
  snapshot: SessionMetricsSnapshot,
  recordName: 'exitsByShipType' | 'stormHitsByShipType',
  key: string,
): number {
  return snapshot[recordName][key] ?? 0;
}

export class StarEvaluator {
  readonly #conditions: readonly StarCondition[];

  public constructor(conditions: readonly StarCondition[]) {
    if (conditions.length !== 3) {
      throw new RangeError('StarEvaluator requires exactly three conditions');
    }
    this.#conditions = Object.freeze(conditions.map(copyCondition));
  }

  public get conditions(): readonly StarCondition[] {
    return this.#conditions;
  }

  public evaluate(options: {
    readonly objectiveCompleted: boolean;
    readonly completionTimeSeconds: number;
    readonly metrics: SessionMetrics;
  }): readonly StarResult[] {
    if (!Number.isFinite(options.completionTimeSeconds) || options.completionTimeSeconds < 0) {
      throw new RangeError('completionTimeSeconds must be non-negative and finite');
    }
    const metrics = options.metrics.toSnapshot();
    const results = this.#conditions.map((condition): StarResult => {
      let earned: boolean;
      switch (condition.type) {
        case 'complete':
          earned = options.objectiveCompleted;
          break;
        case 'max_warnings':
          earned = metrics.warningCount <= condition.value;
          break;
        case 'max_time_seconds':
          earned = options.completionTimeSeconds <= condition.value;
          break;
        case 'min_cargo':
          earned = metrics.cargoUnloadedTotal >= condition.value;
          break;
        case 'max_wrong_dock_attempts':
          earned = metrics.wrongDockAttemptCount <= condition.value;
          break;
        case 'min_multi_cargo_ships':
          earned = metrics.multiCargoShipExits >= condition.value;
          break;
        case 'min_ship_exits':
          earned =
            metricValue(metrics, 'exitsByShipType', condition.shipId) >=
            condition.value;
          break;
        case 'min_ship_group_exits': {
          let count = 0;
          for (const shipId of condition.shipIds) {
            count += metricValue(metrics, 'exitsByShipType', shipId);
          }
          earned = count >= condition.value;
          break;
        }
        case 'service_ships_under_time': {
          let count = 0;
          for (const exit of metrics.exitTimeline) {
            if (exit.exitTimeSeconds <= condition.maxSeconds) {
              count += 1;
            }
          }
          earned = count >= condition.shipTarget;
          break;
        }
        case 'max_hazard_hits_by_ship':
          earned =
            metricValue(metrics, 'stormHitsByShipType', condition.shipId) <=
            condition.value;
          break;
      }
      return Object.freeze({
        condition: copyCondition(condition),
        earned,
      });
    });
    return Object.freeze(results);
  }
}
