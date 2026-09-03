import type {
  ShipCharacteristics,
  ShipCharacteristicsRegistry,
} from './ShipCharacteristics.ts';
import { ShipState, type ShipState as ShipStateValue } from './ShipState.ts';

export interface ShipPosition {
  readonly x: number;
  readonly y: number;
}

export interface ShipModelInit {
  readonly id: string;
  readonly characteristics: ShipCharacteristics;
  readonly position: ShipPosition;
  readonly rotationDeg: number;
  readonly state: ShipStateValue;
}

export interface ShipModelSnapshot {
  readonly id: string;
  readonly shipType: string;
  readonly position: ShipPosition;
  readonly rotationDeg: number;
  readonly state: ShipStateValue;
}

const shipStates = new Set<string>(Object.values(ShipState));

function assertFinite(value: number, label: string): void {
  if (!Number.isFinite(value)) {
    throw new RangeError(`${label} must be finite`);
  }
}

export function normalizeRotationDeg(rotationDeg: number): number {
  assertFinite(rotationDeg, 'rotationDeg');
  return ((rotationDeg % 360) + 360) % 360;
}

export class ShipModel {
  public readonly id: string;
  public readonly characteristics: ShipCharacteristics;
  #position: ShipPosition;
  #rotationDeg: number;
  #state: ShipStateValue;

  public constructor(init: ShipModelInit) {
    if (!init.id) {
      throw new RangeError('id must not be empty');
    }
    assertFinite(init.position.x, 'position.x');
    assertFinite(init.position.y, 'position.y');
    if (!shipStates.has(init.state)) {
      throw new RangeError(`Unknown ship state: ${init.state}`);
    }

    this.id = init.id;
    this.characteristics = init.characteristics;
    this.#position = { ...init.position };
    this.#rotationDeg = normalizeRotationDeg(init.rotationDeg);
    this.#state = init.state;
  }

  public get position(): ShipPosition {
    return { ...this.#position };
  }

  public get rotationDeg(): number {
    return this.#rotationDeg;
  }

  public get state(): ShipStateValue {
    return this.#state;
  }

  public setPosition(position: ShipPosition): void {
    assertFinite(position.x, 'position.x');
    assertFinite(position.y, 'position.y');
    this.#position = { ...position };
  }

  public setRotationDeg(rotationDeg: number): void {
    this.#rotationDeg = normalizeRotationDeg(rotationDeg);
  }

  public setState(state: ShipStateValue): void {
    if (!shipStates.has(state)) {
      throw new RangeError(`Unknown ship state: ${state}`);
    }
    this.#state = state;
  }

  public toSnapshot(): ShipModelSnapshot {
    return {
      id: this.id,
      shipType: this.characteristics.type,
      position: this.position,
      rotationDeg: this.rotationDeg,
      state: this.state,
    };
  }

  public static restore(
    snapshot: ShipModelSnapshot,
    characteristics: ShipCharacteristicsRegistry,
  ): ShipModel {
    return new ShipModel({
      id: snapshot.id,
      characteristics: characteristics.require(snapshot.shipType),
      position: snapshot.position,
      rotationDeg: snapshot.rotationDeg,
      state: snapshot.state,
    });
  }
}
