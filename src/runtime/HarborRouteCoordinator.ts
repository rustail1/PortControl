import { CommandQueue } from '../core/CommandQueue.ts';
import type { DepartureCoordinator } from '../docks/DepartureCoordinator.ts';
import type {
  RouteCommitResult,
  RouteCommitService,
} from '../routes/RouteCommitService.ts';
import type { RawRouteDraft } from '../routes/RouteInputController.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import { ShipState } from '../ships/ShipState.ts';
import type { Point } from '../shared/geometry/Point.ts';

export interface HarborRouteCoordinatorOptions {
  readonly routes: RouteCommitService;
  readonly departure: DepartureCoordinator;
  readonly resolveShip: (shipId: string) => ShipModel | undefined;
  readonly routeStartFor: (ship: ShipModel) => Point;
  readonly isCommitDeferred: (ship: ShipModel) => boolean;
  readonly onCommitResult?: (shipId: string, result: RouteCommitResult) => void;
}


interface QueuedRouteCommand {
  readonly draft: RawRouteDraft;
  readonly rebaseOnRelease: boolean;
}

function rebaseDraftToStart(draft: RawRouteDraft, routeStart: Point): RawRouteDraft {
  const start = draft.start;
  if (start === undefined) return draft;
  const deltaX = routeStart.x - start.x;
  const deltaY = routeStart.y - start.y;
  if (Math.hypot(deltaX, deltaY) <= 1e-9) return draft;
  return Object.freeze({
    shipId: draft.shipId,
    start: Object.freeze({ ...routeStart }),
    ...(draft.tip === undefined
      ? {}
      : { tip: Object.freeze({ x: draft.tip.x + deltaX, y: draft.tip.y + deltaY }) }),
    points: Object.freeze(
      draft.points.map((point) => Object.freeze({
        x: point.x + deltaX,
        y: point.y + deltaY,
      })),
    ),
  });
}

function cloneDraft(draft: RawRouteDraft): RawRouteDraft {
  return Object.freeze({
    shipId: draft.shipId,
    ...(draft.start === undefined
      ? {}
      : { start: Object.freeze({ ...draft.start }) }),
    ...(draft.tip === undefined
      ? {}
      : { tip: Object.freeze({ ...draft.tip }) }),
    points: Object.freeze(
      draft.points.map((point) => Object.freeze({ ...point })),
    ),
  });
}

/** Owns deterministic route-command queuing and route-commit transactions. */
export class HarborRouteCoordinator {
  readonly #routes: RouteCommitService;
  readonly #departure: DepartureCoordinator;
  readonly #resolveShip: HarborRouteCoordinatorOptions['resolveShip'];
  readonly #routeStartFor: HarborRouteCoordinatorOptions['routeStartFor'];
  readonly #isCommitDeferred: HarborRouteCoordinatorOptions['isCommitDeferred'];
  readonly #onCommitResult: NonNullable<HarborRouteCoordinatorOptions['onCommitResult']> | null;
  readonly #commands = new CommandQueue<QueuedRouteCommand>();
  #liveDraft: RawRouteDraft | null = null;
  #lastCommitResult: RouteCommitResult | null = null;

  public constructor(options: HarborRouteCoordinatorOptions) {
    this.#routes = options.routes;
    this.#departure = options.departure;
    this.#resolveShip = options.resolveShip;
    this.#routeStartFor = options.routeStartFor;
    this.#isCommitDeferred = options.isCommitDeferred;
    this.#onCommitResult = options.onCommitResult ?? null;
  }

  public get queuedCount(): number {
    return this.#commands.size;
  }

  public get hasLiveDraft(): boolean {
    return this.#liveDraft !== null;
  }

  public get lastCommitResult(): RouteCommitResult | null {
    return this.#lastCommitResult;
  }

  public enqueue(draft: RawRouteDraft): void {
    this.#commands.enqueue(Object.freeze({
      draft: cloneDraft(draft),
      rebaseOnRelease: false,
    }));
  }

  public setLiveDraft(draft: RawRouteDraft | null): void {
    this.#liveDraft = draft === null ? null : cloneDraft(draft);
  }

  public clear(): void {
    this.#commands.clear();
    this.#liveDraft = null;
    this.#lastCommitResult = null;
  }

  public forgetShip(shipId: string): void {
    this.#commands.removeWhere((command) => command.draft.shipId === shipId);
    if (this.#liveDraft?.shipId === shipId) {
      this.#liveDraft = null;
    }
  }

  public applyPending(): void {
    this.#applyQueued();
    this.#applyLive();
  }

  #applyQueued(): void {
    if (this.#commands.size === 0) return;
    const commands = this.#commands.drain();
    const deferred: QueuedRouteCommand[] = [];
    for (const command of commands) {
      const ship = this.#resolveShip(command.draft.shipId);
      if (ship === undefined) continue;
      if (this.#isCommitDeferred(ship)) {
        deferred.push(Object.freeze({
          draft: command.draft,
          rebaseOnRelease: true,
        }));
        continue;
      }
      const draft = command.rebaseOnRelease
        ? rebaseDraftToStart(command.draft, this.#routeStartFor(ship))
        : command.draft;
      this.#commit(ship, draft, true);
    }
    this.#commands.prepend(deferred);
  }

  #applyLive(): void {
    const draft = this.#liveDraft;
    if (draft === null) return;
    const ship = this.#resolveShip(draft.shipId);
    if (ship === undefined) {
      this.#liveDraft = null;
      return;
    }
    if (this.#isCommitDeferred(ship)) return;
    // A docked ship must not begin assisted departure from an intermediate live
    // draft. Keep the gesture presentation-only until pointer-up seals the
    // final authored route, then commit that route atomically.
    if (ship.state === ShipState.ReadyToLeave) return;
    this.#liveDraft = null;
    this.#commit(ship, draft, false);
  }

  #commit(ship: ShipModel, draft: RawRouteDraft, surfaceResult: boolean): void {
    const readyToLeave = ship.state === ShipState.ReadyToLeave;
    const routeStart = this.#routeStartFor(ship);
    const prepared = this.#routes.prepare({ ship, draft, routeStart });
    if (!('route' in prepared)) {
      this.#recordCommitResult(ship.id, prepared, surfaceResult);
      return;
    }
    if (readyToLeave) {
      this.#recordCommitResult(ship.id, this.#departure.commit(ship, prepared), surfaceResult);
      return;
    }
    this.#routes.applyPrepared(ship, prepared);
    this.#recordCommitResult(ship.id, { kind: prepared.kind }, surfaceResult);
  }

  #recordCommitResult(shipId: string, result: RouteCommitResult, surfaceResult: boolean): void {
    this.#lastCommitResult = result;
    if (surfaceResult) this.#onCommitResult?.(shipId, result);
  }
}
