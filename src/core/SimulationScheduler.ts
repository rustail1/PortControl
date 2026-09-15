import type { SimulationStepResult } from './SimulationStepResult.ts';

export interface SimulationPorts<TCollision, TGrounding, TDocking, TCargo, TExit> {
  applyCommands(): void;
  spawn(deltaSeconds: number): void;
  hazards(deltaSeconds: number): void;
  move(deltaSeconds: number): void;
  collision(deltaSeconds: number): TCollision;
  grounding(): TGrounding;
  applyTerminal(collision: TCollision, grounding: TGrounding, deltaSeconds: number): boolean;
  docking(deltaSeconds: number): TDocking;
  cargo(deltaSeconds: number): TCargo;
  exit(): TExit;
  objective(collision: TCollision, docking: TDocking, cargo: TCargo, exit: TExit, deltaSeconds: number): void;
  capture(): void;
  flush(): void;
}

export class SimulationScheduler {
  public step<TCollision, TGrounding, TDocking, TCargo, TExit>(deltaSeconds: number, ports: SimulationPorts<TCollision,TGrounding,TDocking,TCargo,TExit>): SimulationStepResult<TCollision,TDocking,TCargo,TExit> {
    ports.applyCommands();
    ports.spawn(deltaSeconds);
    ports.hazards(deltaSeconds);
    ports.move(deltaSeconds);
    const collision = ports.collision(deltaSeconds);
    const grounding = ports.grounding();
    if (ports.applyTerminal(collision, grounding, deltaSeconds)) {
      ports.flush(); ports.capture();
      return Object.freeze({ collision, docking: null, cargo: null, exit: null, terminal: true });
    }
    const docking = ports.docking(deltaSeconds);
    const cargo = ports.cargo(deltaSeconds);
    const exit = ports.exit();
    ports.objective(collision, docking, cargo, exit, deltaSeconds);
    ports.flush(); ports.capture();
    return Object.freeze({ collision, docking, cargo, exit, terminal: false });
  }
}
