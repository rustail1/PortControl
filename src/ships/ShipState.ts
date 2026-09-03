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
