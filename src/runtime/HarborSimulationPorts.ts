import type { CollisionShipCandidate, CollisionStepResult, CollisionSystem } from '../collision/CollisionSystem.ts';
import type { GameSession } from '../core/GameSession.ts';
import type { SimulationPorts } from '../core/SimulationScheduler.ts';
import { chooseTerminalFailure } from '../core/TerminalFailureArbitrator.ts';
import type { CargoStepResult, CargoSystem, CargoUnloadCandidate } from '../docks/CargoSystem.ts';
import type { DockApproachCandidate, DockingController, DockingStepResult } from '../docks/DockingController.ts';
import type { ExitStepResult, ExitSystem } from '../exits/ExitSystem.ts';
import type { GroundingShipCandidate, GroundingStepResult, GroundingSystem } from '../grounding/GroundingSystem.ts';
import type { LandRecoverySystem } from '../grounding/LandRecoverySystem.ts';
import type { ShipModel } from '../ships/ShipModel.ts';

export type HarborSimulationPortSet = SimulationPorts<
  CollisionStepResult,
  GroundingStepResult,
  DockingStepResult,
  CargoStepResult,
  ExitStepResult
>;

export interface HarborSimulationPortOptions {
  readonly session: GameSession;
  readonly collision: CollisionSystem;
  readonly grounding: GroundingSystem;
  readonly landRecovery: LandRecoverySystem;
  readonly docking: DockingController;
  readonly cargo: CargoSystem;
  readonly exit: ExitSystem;
  readonly applyCommands: () => void;
  readonly spawn: (deltaSeconds: number) => void;
  readonly move: (deltaSeconds: number) => void;
  readonly collisionCandidates: () => readonly CollisionShipCandidate[];
  readonly groundingCandidates: () => readonly GroundingShipCandidate[];
  readonly landRecoveryShips: () => readonly ShipModel[];
  readonly dockingCandidates: () => readonly DockApproachCandidate[];
  readonly cargoCandidates: () => readonly CargoUnloadCandidate[];
  readonly exitShips: () => readonly ShipModel[];
  readonly resolveShip: (shipId: string) => ShipModel | undefined;
  readonly onExit: (result: ExitStepResult) => void;
  readonly projectFacts: (collision: CollisionStepResult, cargo: CargoStepResult, exit: ExitStepResult) => void;
  readonly capture: () => void;
  readonly flush: () => void;
}

/**
 * Adapter between the frozen scheduler contract and concrete harbor systems.
 * It owns phase decisions, while GameSession/SimulationScheduler own phase order.
 */
export class HarborSimulationPorts implements HarborSimulationPortSet {
  readonly #options: HarborSimulationPortOptions;

  public constructor(options: HarborSimulationPortOptions) {
    this.#options = options;
  }

  public applyCommands(): void {
    this.#options.applyCommands();
  }

  public spawn(deltaSeconds: number): void {
    this.#options.spawn(deltaSeconds);
  }

  public hazards(deltaSeconds: number): void {
    this.#options.landRecovery.step(this.#options.landRecoveryShips(), deltaSeconds);
  }

  public move(deltaSeconds: number): void {
    this.#options.move(deltaSeconds);
  }

  public collision(deltaSeconds: number): CollisionStepResult {
    return this.#options.collision.step(this.#options.collisionCandidates(), deltaSeconds);
  }

  public grounding(): GroundingStepResult {
    return this.#options.grounding.resolve(this.#options.groundingCandidates());
  }

  public applyTerminal(
    collision: CollisionStepResult,
    grounding: GroundingStepResult,
    deltaSeconds: number,
  ): boolean {
    const terminal = chooseTerminalFailure({
      collision: collision.terminalCollision,
      grounding: grounding.terminalGrounding,
    });
    if (terminal === null) return false;

    if (terminal.failReason === 'collision') {
      this.#options.resolveShip(terminal.shipAId)?.destroy('collision');
      this.#options.resolveShip(terminal.shipBId)?.destroy('collision');
    } else {
      this.#options.resolveShip(terminal.shipId)?.destroy('grounding');
    }

    this.#options.session.step({
      deltaSeconds,
      collisionTerminal: terminal.failReason === 'collision' ? terminal : null,
      groundingTerminal: terminal.failReason === 'grounding' ? terminal : null,
    });
    return true;
  }

  public docking(deltaSeconds: number): DockingStepResult {
    return this.#options.docking.step(this.#options.dockingCandidates(), deltaSeconds);
  }

  public cargo(deltaSeconds: number): CargoStepResult {
    return this.#options.cargo.step(this.#options.cargoCandidates(), deltaSeconds);
  }

  public exit(): ExitStepResult {
    return this.#options.exit.step(this.#options.exitShips());
  }

  public objective(
    collision: CollisionStepResult,
    docking: DockingStepResult,
    cargo: CargoStepResult,
    exit: ExitStepResult,
    deltaSeconds: number,
  ): void {
    this.#options.session.step({
      deltaSeconds,
      dangerWarningCount: collision.dangerWarningCount,
      cargoUnloadedFacts: cargo.unloadedFacts,
      exitedShipFacts: exit.exitedShipFacts,
      wrongDockAttemptFacts: docking.wrongDockAttemptFacts,
    });
    this.#options.projectFacts(collision, cargo, exit);
    // Despawn/cleanup only after SessionMetrics has consumed exit provenance.
    this.#options.onExit(exit);
  }

  public capture(): void {
    this.#options.capture();
  }

  public flush(): void {
    this.#options.flush();
  }
}
