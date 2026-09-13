import type { Point } from '../camera/SquareWorldViewport.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import type {
  NavigationValidationResult,
  NavigationValidator,
} from './NavigationValidator.ts';
import { RouteCanonicalizer } from './RouteCanonicalizer.ts';
import type { RouteProcessingConfig } from './RouteProcessingConfig.ts';

export interface PreparedRouteGeometry extends NavigationValidationResult {
  readonly canonicalPoints: readonly Point[];
}

/**
 * Single geometry-preparation boundary for route preview and route commit.
 * It owns the ordering canonicalize -> validate so callers cannot accidentally
 * validate raw points or canonicalize the same route twice.
 */
export class RoutePreparationService {
  readonly #canonicalizer: RouteCanonicalizer;
  readonly #navigation: Pick<NavigationValidator, 'validate'>;
  readonly #config: RouteProcessingConfig;

  public constructor(options: {
    readonly navigation: Pick<NavigationValidator, 'validate'>;
    readonly config: RouteProcessingConfig;
  }) {
    this.#navigation = options.navigation;
    this.#config = options.config;
    this.#canonicalizer = new RouteCanonicalizer(options.config);
  }

  public prepare(input: {
    readonly ship: ShipModel;
    readonly points: readonly Point[];
    readonly start: Point;
  }): PreparedRouteGeometry {
    const canonicalPoints = this.#canonicalizer.canonicalize(input.start, input.points);
    const validation = this.#navigation.validate(
      input.ship,
      canonicalPoints,
      this.#config,
      input.start,
    );
    return Object.freeze({
      canonicalPoints,
      validPoints: validation.validPoints,
      rejectedPoints: validation.rejectedPoints,
    });
  }
}
