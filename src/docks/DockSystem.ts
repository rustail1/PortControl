import type { ShipModel } from '../ships/ShipModel.ts';
import {
  occupyReservedDock,
  releaseDockOccupancy,
  releaseDockReservation,
  reserveDock,
  type DockModel,
} from './DockModel.ts';

export type DockCompatibilityStatus = 'eligible' | 'busy' | 'incompatible';

export interface DockCompatibility {
  readonly status: DockCompatibilityStatus;
}

export class DockSystem {
  public classify(dock: DockModel, ship: Pick<ShipModel, 'cargo'>): DockCompatibility {
    const compatible = dock.definition.acceptedCargoTypes.some(
      (cargoType) => (ship.cargo[cargoType] ?? 0) > 0,
    );
    if (!compatible) return { status: 'incompatible' };
    if (dock.reservedBy !== null || dock.occupiedBy !== null) return { status: 'busy' };
    return { status: 'eligible' };
  }

  public reserve(dock: DockModel, ship: Pick<ShipModel, 'id' | 'cargo'>): DockCompatibility {
    const result = this.classify(dock, ship);
    if (result.status !== 'eligible') return result;
    return reserveDock(dock, ship.id) ? result : { status: 'busy' };
  }

  public releaseReservation(dock: DockModel, shipId: string): boolean {
    return releaseDockReservation(dock, shipId);
  }

  public occupyReserved(dock: DockModel, shipId: string): boolean {
    return occupyReservedDock(dock, shipId);
  }
  public releaseOccupancy(dock: DockModel, shipId: string): boolean { return releaseDockOccupancy(dock, shipId); }
}
