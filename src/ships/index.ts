export {
  createShipCharacteristicsRegistry,
  ShipCharacteristicsRegistry,
  type ShipCharacteristics,
} from './ShipCharacteristics.ts';
export {
  normalizeRotationDeg,
  LandRecoveryMotion,
  RouteTurnMode,
  ShipModel,
  type LandRecoveryMotion as LandRecoveryMotionValue,
  type ShipModelInit,
  type ShipModelSnapshot,
  type ShipPosition,
  type CargoManifest,
} from './ShipModel.ts';
export { moveAngleTowardsDeg, ShipMotor, type SteeringTarget } from './ShipMotor.ts';
export {
  ShipRoute,
  type ShipRouteSnapshot,
} from './ShipRoute.ts';
export {
  participatesInSpawnTrafficPressure,
  ShipState,
  type ShipState as ShipStateValue,
} from './ShipState.ts';

export { canTransitionShip, type ShipTransitionReason } from './ShipLifecycle.ts';
