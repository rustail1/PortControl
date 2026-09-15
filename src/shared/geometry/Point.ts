/** Neutral simulation-space point shared below camera, route, ship, and dock layers. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

export type ShipPosition = Point;
