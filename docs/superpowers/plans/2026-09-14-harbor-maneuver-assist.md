# Harbor Maneuver Assist Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace fixed snap docking/departure with deterministic ship-specific assist physics, fix live route consumption, and expose rejected route outcomes.

**Architecture:** Introduce a focused `HarborManeuverMotor` owned by `DockingController`; retain DockingController reservation/transaction authority but replace elapsed/duration interpolation with lane-distance/speed state. Split route rendering into static tail plus dynamic head without touching authored route physics. Project route commit result into presentation rejection feedback.

**Tech Stack:** Phaser 4.2.1, strict TypeScript, fixed 60 Hz simulation, node:test/Playwright project tests.

**Spec:** `docs/superpowers/specs/2026-09-14-harbor-maneuver-assist-design.md`

**Implementation status:** COMPLETE in v1.8; later bugfixes preserve this architecture and repair only verified regressions.

## Global Constraints
- Frozen Baseline v1.5 unchanged.
- Exact authored polyline remains navigation authority.
- Fixed simulation 60 Hz; render owns no gameplay state.
- No Phaser tween owns ship movement.
- No `Math.random()` in simulation.

---

### Task 1: Harbor maneuver physics
**Files:** Create `src/docks/HarborManeuverMotor.ts`; Modify `src/docks/DockingController.ts`, `src/docks/index.ts`; Test `test/cor05-docking.test.mjs`, create `test/cor13-harbor-maneuver.test.mjs`.

- [x] Add RED tests proving freighter/speedboat docking duration differs by characteristics, speed is continuous, and no fixed 350ms completion occurs.
- [x] Add RED test proving departure hands non-zero sub-cruise route speed into ShipMotor.
- [x] Implement lane-distance, acceleration/deceleration, heading-limited motor and transaction snapshot state.
- [x] Remove fixed duration interpolation from production docking/departure path.
- [x] Run focused harbor tests to GREEN.

### Task 2: Route line consumption
**Files:** Modify `src/presentation/RouteRenderState.ts`, `src/runtime/HarborRuntime.ts`, `src/scenes/HarborScene.ts`; Test `test/architecture-finalization-v17.test.mjs`, create `test/cor13-route-render.test.mjs`.

- [x] Add RED test proving static tail key stays stable inside segment while dynamic head origin follows current position.
- [x] Add a second Graphics object for dynamic head and keep static tail dirty-rendered.
- [x] Ensure incoming/departure/despawn cleanup clears both route graphics.
- [x] Run focused rendering contract tests to GREEN.

### Task 3: Silent stall feedback
**Files:** Modify `src/runtime/HarborRouteCoordinator.ts`, `src/runtime/HarborRuntime.ts`, `src/presentation/PresentationPulseStore.ts`, `src/scenes/HarborScene.ts`; Test create `test/cor13-route-feedback.test.mjs`.

- [x] Add RED tests that rejected route commit creates presentation rejection state and committed/pivot are not mislabeled rejected.
- [x] Project last rejected commit to a short deterministic presentation pulse without mutating simulation.
- [x] Render rejection pulse on the selected ship/route preview.
- [x] Run focused feedback tests to GREEN.

### Task 4: Regression and delivery
**Files:** Only files touched above plus docs.

- [x] Run strict focused TypeScript check for changed non-Phaser core modules.
- [x] Run all available focused regression harnesses for route/docking/movement.
- [x] Scan conflict markers and `git diff --check` equivalent whitespace checks.
- [x] Verify Frozen Baseline byte-for-byte unchanged.
- [x] Package clean source ZIP without `node_modules` or stale `dist`.
- [x] Report limitations: full npm/browser gate remains Owner-PC gate if dependencies/browser are unavailable here.
