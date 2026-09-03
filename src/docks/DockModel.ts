import type { ShipPosition } from '../ships/ShipModel.ts';

export interface DockDefinition {
  readonly id: string;
  readonly position: ShipPosition;
  readonly rotationDeg: number;
  readonly dockAngle: number;
  readonly snapRadius: number;
  readonly acceptedCargoTypes: readonly string[];
  readonly helperFlag: boolean;
  readonly visualVariant: string;
}

export interface DockRuntimeSnapshot {
  readonly id: string;
  readonly reservedBy: string | null;
  readonly occupiedBy: string | null;
}

function freezeDefinition(definition: DockDefinition): DockDefinition {
  return Object.freeze({
    ...definition,
    position: Object.freeze({ ...definition.position }),
    acceptedCargoTypes: Object.freeze([...definition.acceptedCargoTypes]),
  });
}

interface DockRuntimeState {
  reservedBy: string | null;
  occupiedBy: string | null;
}

const runtimeByDock = new WeakMap<DockModel, DockRuntimeState>();

export class DockModel {
  public readonly definition: DockDefinition;

  public constructor(definition: DockDefinition, runtime: DockRuntimeSnapshot | null = null) {
    this.definition = freezeDefinition(definition);
    if (runtime !== null && runtime.id !== definition.id) {
      throw new RangeError('Dock runtime snapshot id does not match definition');
    }
    runtimeByDock.set(this, {
      reservedBy: runtime?.reservedBy ?? null,
      occupiedBy: runtime?.occupiedBy ?? null,
    });
  }

  public get id(): string { return this.definition.id; }
  public get reservedBy(): string | null { return runtimeByDock.get(this)?.reservedBy ?? null; }
  public get occupiedBy(): string | null { return runtimeByDock.get(this)?.occupiedBy ?? null; }

  public toRuntimeSnapshot(): DockRuntimeSnapshot {
    return { id: this.id, reservedBy: this.reservedBy, occupiedBy: this.occupiedBy };
  }

  public static restore(definition: DockDefinition, runtime: DockRuntimeSnapshot): DockModel {
    return new DockModel(definition, runtime);
  }
}

/** DockSystem-only runtime mutation boundary; deliberately omitted from the public barrel. */
export function reserveDock(dock: DockModel, shipId: string): boolean {
  const runtime = runtimeByDock.get(dock);
  if (runtime === undefined || runtime.reservedBy !== null || runtime.occupiedBy !== null) return false;
  runtime.reservedBy = shipId;
  return true;
}

/** DockSystem-only runtime mutation boundary; deliberately omitted from the public barrel. */
export function releaseDockReservation(dock: DockModel, shipId: string): boolean {
  const runtime = runtimeByDock.get(dock);
  if (runtime === undefined || runtime.occupiedBy !== null || runtime.reservedBy !== shipId) return false;
  runtime.reservedBy = null;
  return true;
}

/** DockSystem-only runtime mutation boundary; deliberately omitted from the public barrel. */
export function occupyReservedDock(dock: DockModel, shipId: string): boolean {
  const runtime = runtimeByDock.get(dock);
  if (runtime === undefined || runtime.occupiedBy !== null || runtime.reservedBy !== shipId) return false;
  runtime.occupiedBy = shipId;
  runtime.reservedBy = null;
  return true;
}

export function releaseDockOccupancy(dock: DockModel, shipId: string): boolean {
  const runtime = runtimeByDock.get(dock);
  if (runtime === undefined || runtime.occupiedBy !== shipId) return false;
  runtime.occupiedBy = null;
  return true;
}

export class DockCollection {
  readonly #byId: ReadonlyMap<string, DockModel>;

  public constructor(docks: readonly DockModel[]) {
    this.#byId = new Map(docks.map((dock) => [dock.id, dock]));
  }

  public get(id: string): DockModel | undefined { return this.#byId.get(id); }
  public require(id: string): DockModel {
    const dock = this.get(id);
    if (dock === undefined) throw new RangeError(`Unknown dock: ${id}`);
    return dock;
  }
  public values(): IterableIterator<DockModel> { return this.#byId.values(); }
}
