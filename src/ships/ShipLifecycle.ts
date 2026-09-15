import { ShipState, type ShipState as ShipStateValue } from './ShipState.ts';

export type ShipTransitionReason =
  | 'route_committed'
  | 'dock_reserved'
  | 'harbor_assist_started'
  | 'berth_lock_completed'
  | 'cargo_partial_complete'
  | 'cargo_fully_complete'
  | 'departure_started'
  | 'exit_rejected_cargo'
  | 'terminal_collision'
  | 'terminal_grounding';

const allowed = new Set<string>([
  `${ShipState.Entering}|${ShipState.Navigating}|route_committed`,
  `${ShipState.Navigating}|${ShipState.ApproachingDock}|dock_reserved`,
  `${ShipState.ApproachingDock}|${ShipState.Docking}|harbor_assist_started`,
  `${ShipState.Docking}|${ShipState.Unloading}|berth_lock_completed`,
  `${ShipState.Unloading}|${ShipState.Navigating}|cargo_partial_complete`,
  `${ShipState.Unloading}|${ShipState.ReadyToLeave}|cargo_fully_complete`,
  `${ShipState.ReadyToLeave}|${ShipState.Leaving}|departure_started`,
  `${ShipState.Leaving}|${ShipState.Navigating}|exit_rejected_cargo`,
]);

export function canTransitionShip(from: ShipStateValue, to: ShipStateValue, reason: ShipTransitionReason): boolean {
  if (from === to) return true;
  if ((reason === 'terminal_collision' || reason === 'terminal_grounding') && from !== ShipState.Destroyed && to === ShipState.Destroyed) return true;
  if (from === ShipState.Destroyed) return false;
  return allowed.has(`${from}|${to}|${reason}`);
}
