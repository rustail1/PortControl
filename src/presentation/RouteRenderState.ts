import type { ShipPosition } from '../shared/geometry/Point.ts';
import type { ShipModel } from '../ships/ShipModel.ts';
import { ShipState } from '../ships/ShipState.ts';

export interface RouteRenderState {
  readonly key: string;
  readonly points: readonly ShipPosition[] | null;
}

/**
 * Presentation-only authored route state.
 *
 * `key` is stable while the ship remains inside the same authored segment so
 * the expensive static tail does not redraw every frame. `points[0]` is always
 * the current simulation position, allowing presentation to draw a tiny
 * dynamic head from the vessel to the current segment endpoint each frame.
 * During inbound harbor assist the obsolete navigation route is hidden. During
 * assisted departure, `maneuverPrefix` prepends the physical harbor lane to the
 * authored route without mutating simulation geometry.
 */
const POINT_EPSILON = 1e-9;

function samePoint(left: ShipPosition, right: ShipPosition): boolean {
  return Math.hypot(left.x - right.x, left.y - right.y) <= POINT_EPSILON;
}

export function composeRoutePresentationTail(
  prefix: readonly ShipPosition[],
  authoredTail: readonly ShipPosition[],
): readonly ShipPosition[] {
  const result: ShipPosition[] = [];
  for (const point of [...prefix, ...authoredTail]) {
    const previous = result.at(-1);
    if (previous !== undefined && samePoint(previous, point)) continue;
    result.push(Object.freeze({ ...point }));
  }
  return Object.freeze(result);
}

function prefixKey(prefix: readonly ShipPosition[]): string {
  return prefix.length === 0
    ? 'direct'
    : prefix.map((point) => `${point.x},${point.y}`).join(';');
}

export function createRouteRenderState(
  ship: Pick<ShipModel, 'route' | 'routeCursor' | 'routeRevision' | 'position' | 'state'>,
  maneuverPrefix: readonly ShipPosition[] = Object.freeze([]),
): RouteRenderState {
  if (
    ship.state === ShipState.ApproachingDock ||
    ship.state === ShipState.Docking ||
    ship.state === ShipState.Unloading
  ) {
    return Object.freeze({
      key: `harbor-assist:${ship.state}:${ship.routeRevision}`,
      points: null,
    });
  }

  const route = ship.route;
  if (route === null) {
    return Object.freeze({ key: `none:${ship.routeRevision}`, points: null });
  }
  const cursor = ship.routeCursor;
  const authoredTail: ShipPosition[] = [];
  const currentTarget = route.at(cursor);
  if (currentTarget !== null) {
    authoredTail.push(currentTarget);
    for (let index = cursor + 1; index < route.length; index += 1) {
      const point = route.at(index);
      if (point !== null) authoredTail.push(point);
    }
  }
  const tail = composeRoutePresentationTail(maneuverPrefix, authoredTail);
  return Object.freeze({
    key: `${ship.routeRevision}:${cursor}:${prefixKey(maneuverPrefix)}`,
    points: Object.freeze([
      Object.freeze({ ...ship.position }),
      ...tail,
    ]),
  });
}
