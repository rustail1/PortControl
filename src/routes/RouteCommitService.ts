import type { RawRouteDraft } from './RouteInputController.ts';
import { isRouteInputState, materializeRouteDraft } from './RouteInputController.ts';
import { ShipRoute } from '../ships/ShipRoute.ts';
import { ShipState } from '../ships/ShipState.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import type { RouteProcessingConfig } from './RouteProcessingConfig.ts';
import type { NavigationValidator } from './NavigationValidator.ts';
import { RoutePreparationService } from './RoutePreparationService.ts';

export type RouteCommitResult = {
  readonly kind:
    | 'committed'
    | 'partial_prefix_committed'
    | 'rejected_too_short'
    | 'rejected_invalid'
    | 'rejected_locked';
};

function routeLength(
  start: { readonly x: number; readonly y: number },
  points: readonly { readonly x: number; readonly y: number }[],
): number {
  let total = 0;
  let previous = start;
  for (const point of points) {
    total += Math.hypot(point.x - previous.x, point.y - previous.y);
    previous = point;
  }
  return total;
}

export class RouteCommitService {
  readonly #config: RouteProcessingConfig;
  readonly #preparation: RoutePreparationService;

  public constructor(options: {
    readonly navigation: Pick<NavigationValidator, 'validate'>;
    readonly config: RouteProcessingConfig;
    readonly preparation?: RoutePreparationService;
  }) {
    this.#config = options.config;
    this.#preparation = options.preparation ?? new RoutePreparationService({
      navigation: options.navigation,
      config: options.config,
    });
  }

  public commit(input: {
    readonly ship: ShipModel;
    readonly draft: RawRouteDraft;
    readonly routeStart?: { readonly x: number; readonly y: number } | null;
  }): RouteCommitResult {
    const { ship, draft } = input;
    if (draft.shipId !== ship.id || !isRouteInputState(ship.state)) {
      return { kind: 'rejected_locked' };
    }
    const routeStart = ship.state === ShipState.ReadyToLeave || ship.state === ShipState.Leaving
      ? input.routeStart ?? ship.position
      : draft.start ?? input.routeStart ?? ship.position;
    const drawnPoints = materializeRouteDraft(draft);
    const prepared = this.#preparation.prepare({
      ship,
      points: drawnPoints,
      start: routeStart,
    });
    if (prepared.validPoints.length === 0) {
      return { kind: 'rejected_invalid' };
    }
    if (
      routeLength(ship.position, prepared.validPoints) <
      this.#config.minValidRouteLength
    ) {
      return { kind: 'rejected_too_short' };
    }

    const route = new ShipRoute(prepared.validPoints, routeStart);
    const existingStart = ship.route?.toSnapshot().start;
    const continuesActiveGesture = draft.start !== undefined && existingStart !== undefined &&
      existingStart.x === draft.start.x && existingStart.y === draft.start.y;
    ship.replaceRoute(
      route,
      routeStart,
      continuesActiveGesture ? ship.routeProgress : 0,
    );
    if (ship.state === ShipState.Entering) {
      ship.setState(ShipState.Navigating);
    } else if (ship.state === ShipState.ReadyToLeave) {
      ship.setState(ShipState.Leaving);
    }

    return {
      kind:
        prepared.rejectedPoints.length === 0
          ? 'committed'
          : 'partial_prefix_committed',
    };
  }
}
