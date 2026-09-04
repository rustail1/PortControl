export const ShipState = Object.freeze({
  Entering: 'Entering',
  Navigating: 'Navigating',
  ApproachingDock: 'ApproachingDock',
  Docking: 'Docking',
  Unloading: 'Unloading',
  ReadyToLeave: 'ReadyToLeave',
  Leaving: 'Leaving',
  Destroyed: 'Destroyed',
} as const);

export type ShipState = (typeof ShipState)[keyof typeof ShipState];

export function participatesInSpawnTrafficPressure(state: ShipState): boolean {
  return (
    state === ShipState.Entering ||
    state === ShipState.Navigating ||
    state === ShipState.ApproachingDock ||
    state === ShipState.Docking ||
    state === ShipState.Leaving
  );
}
