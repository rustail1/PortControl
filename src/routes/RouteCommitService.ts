import type { RawRouteDraft } from './RouteInputController.ts';
import { isRouteInputState } from './RouteInputController.ts';
import { ShipRoute } from '../ships/ShipRoute.ts';
import { ShipState } from '../ships/ShipState.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import { simplifyRoute } from './RouteSimplifier.ts';
import type { RouteProcessingConfig } from './RouteProcessingConfig.ts';
import { NavigationValidator } from './NavigationValidator.ts';

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
  readonly #navigation: NavigationValidator;
  readonly #config: RouteProcessingConfig;

  public constructor(options: {
    readonly navigation: NavigationValidator;
    readonly config: RouteProcessingConfig;
  }) {
    this.#navigation = options.navigation;
    this.#config = options.config;
  }

  public commit(input: {
    readonly ship: ShipModel;
    readonly draft: RawRouteDraft;
  }): RouteCommitResult {
    const { ship, draft } = input;
    if (draft.shipId !== ship.id || !isRouteInputState(ship.state)) {
      return { kind: 'rejected_locked' };
    }
    const simplified = simplifyRoute(draft.points, this.#config);
    const validated = this.#navigation.validate(ship, simplified, this.#config);
    if (validated.validPoints.length === 0) {
      return { kind: 'rejected_invalid' };
    }
    if (
      routeLength(ship.position, validated.validPoints) <
      this.#config.minValidRouteLength
    ) {
      return { kind: 'rejected_too_short' };
    }

    ship.replaceRoute(new ShipRoute(validated.validPoints));
    if (ship.state === ShipState.Entering) {
      ship.setState(ShipState.Navigating);
    } else if (ship.state === ShipState.ReadyToLeave) {
      ship.setState(ShipState.Leaving);
    }

    return {
      kind:
        validated.rejectedPoints.length === 0
          ? 'committed'
          : 'partial_prefix_committed',
    };
  }
}
