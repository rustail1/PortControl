import type { DockingController } from './DockingController.ts';
import type { RouteCommitService, PreparedRouteCommit, RouteCommitResult } from '../routes/RouteCommitService.ts';
import type { ShipModel } from '../ships/ShipModel.ts';

export class DepartureCoordinator {
  readonly #routes: RouteCommitService;
  readonly #docking: DockingController;
  public constructor(options: { readonly routes: RouteCommitService; readonly docking: DockingController }) {
    this.#routes = options.routes; this.#docking = options.docking;
  }
  public commit(ship: ShipModel, prepared: PreparedRouteCommit): RouteCommitResult {
    if (prepared.progress !== 0) return { kind: 'rejected_locked' };
    const maneuver = this.#docking.prepareDeparture(ship, prepared.route);
    if (maneuver === null) return { kind: 'rejected_locked' };
    this.#routes.applyPreparedDeparture(ship, prepared);
    this.#docking.commitPreparedDeparture(ship, prepared.route, maneuver);
    return { kind: prepared.kind };
  }
}
