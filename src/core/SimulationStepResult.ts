export interface SimulationStepResult<TCollision = unknown, TDocking = unknown, TCargo = unknown, TExit = unknown> {
  readonly collision: TCollision;
  readonly docking: TDocking | null;
  readonly cargo: TCargo | null;
  readonly exit: TExit | null;
  readonly terminal: boolean;
}
