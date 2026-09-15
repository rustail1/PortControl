# Predictive Land Recovery Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [x]`) syntax for tracking.

**Goal:** Prevent ships from grounding on land by predicting unsafe post-route continuation, taking safety authority early enough for a physical recovery turn, and continuing in open water.

**Architecture:** Add a stateless `LandRecoverySystem` in the existing `hazards()` phase. It selects a deterministic physically-clear turn using authoritative land geometry, while `ShipModel` owns snapshot-backed recovery state and `ShipMotor` remains the sole movement authority. Safe unfinished authored routes, harbor maneuvers, boundary recovery, and terminal `GroundingSystem` semantics remain unchanged; a final route tail may be cancelled only when waiting for its endpoint would make the predicted land recovery physically too late.

**Tech Stack:** Phaser 4.2.1 project, strict TypeScript, ESM, fixed 60 Hz simulation, Node test runner.

**Spec:** `docs/superpowers/specs/2026-09-15-land-recovery-design.md`

## Global Constraints

- Frozen Baseline `Port_Control_Baseline_Source_FINAL_v1.5/` must not change.
- Exact authored route geometry is never bent/replaced; safety takeover may cancel only a final tail whose endpoint continuation is predicted to hit land inside the physical recovery window.
- Land recovery normally starts after route exhaustion, but may start shortly before a hazardous endpoint to preserve a moving turn radius.
- `ShipMotor` remains sole movement authority; `LandRecoverySystem` only decides recovery state.
- Existing `ExitSystem` boundary recovery remains separate and unchanged.
- Existing post-movement `GroundingSystem` remains terminal fallback.
- No RNG, tween, teleport, rotation snap, or generated replacement route.
- Candidate selection is deterministic: 180, 150, 120, 90 degrees; left before right.
- Fixed step is 60 Hz.

---

### Task 1: Snapshot-backed land recovery state

**Files:**
- Modify: `src/ships/ShipModel.ts`
- Modify: `src/ships/index.ts`
- Test: `test/land-recovery.test.mjs`

**Interfaces:**
- Produces: `LandRecoveryMotion = 'arc' | 'pivot'`, getters `landRecoveryHeadingDeg`, `landRecoveryTurnSign`, `landRecoveryMotion`, methods `beginLandRecovery(headingDeg, turnSign, motion)` and `finishLandRecovery()`.
- Snapshot fields: optional `landRecoveryHeadingDeg`, `landRecoveryTurnSign`, `landRecoveryMotion`, always restored atomically.

- [x] **Step 1: Write RED model/snapshot tests**

Add tests that assert recovery fields are initially null, `beginLandRecovery(180, 1, 'arc')` stores normalized heading/sign/motion without changing physical speed, snapshot/restore preserves them, malformed partial snapshots throw, `finishLandRecovery()` clears them, and `replaceRoute()` cancels them.

- [x] **Step 2: Run focused RED**

Run: `node --experimental-strip-types --test test/land-recovery.test.mjs`
Expected: FAIL because land recovery model API does not exist.

- [x] **Step 3: Implement minimal `ShipModel` state**

Add atomic validation and snapshot serialization/restoration. Starting ordinary land recovery clears only an already-consumed route and preserves `routeSpeed`; a separate route-hazard semantic entry point clears an unfinished final tail only for the predictor's explicit safety takeover. `replaceRoute`, `clearRoute`, destruction, and boundary recovery must clear land recovery state.

- [x] **Step 4: Run focused GREEN**

Run the same test and require zero failures.

---

### Task 2: Physical motor execution for arc and pivot recovery

**Files:**
- Modify: `src/ships/ShipMotor.ts`
- Test: `test/land-recovery.test.mjs`

**Interfaces:**
- Consumes the `ShipModel` land recovery fields from Task 1.
- Arc mode rotates only in stored sign at `turnRateDeg * dt` and moves forward at current `routeSpeed`.
- Pivot mode rotates only in stored sign, holds position, and holds speed at zero.

- [x] **Step 1: Add RED motor tests**

Assert arc recovery preserves nonzero speed, never rotates faster than `turnRateDeg`, follows the stored turn sign, translates forward without teleport, and pivot recovery does not translate.

- [x] **Step 2: Verify RED**

Run: `node --experimental-strip-types --test test/land-recovery.test.mjs`
Expected: motor assertions fail because `ShipMotor` ignores land recovery.

- [x] **Step 3: Implement minimal motor branch**

Handle land recovery before generic no-route autonomous continuation, but after route-motion ownership checks. Use directed angular movement rather than shortest-path ambiguity so stored left/right turn sign is authoritative.

- [x] **Step 4: Verify GREEN**

Run focused tests and require zero failures.

---

### Task 3: Deterministic predictive `LandRecoverySystem`

**Files:**
- Create: `src/grounding/LandRecoverySystem.ts`
- Test: `test/land-recovery.test.mjs`

**Interfaces:**
- Constructor: `{ geometry: LandClearanceGeometry; navigationClearanceExtra: number }`.
- Method: `step(ships: readonly ShipModel[], deltaSeconds: number): LandRecoveryStepResult`.
- Result: frozen `{ startedShipIds: readonly string[]; finishedShipIds: readonly string[] }`.

- [x] **Step 1: Add RED system tests**

Use synthetic flat-shore polygons to assert: recovery starts before contact for route-exhausted autonomous ships; safe unfinished authored routes are untouched; a route ending too close to shore is taken over early enough for a moving arc; boundary recovery is untouched; Docking/Unloading/ReadyToLeave states are untouched; all four ship classes get collision-free arcs; tanker begins farther/turns longer than speedboat; completion requires target heading plus clear forward probe; and no RNG is used.

- [x] **Step 2: Verify RED**

Run focused test; expected module-not-found or missing behavior failure.

- [x] **Step 3: Implement deterministic predictor**

Compute clearance, physical turn radius, forward probe distance, simulate candidates at `1/60` with current speed and max turn rate, check every predicted segment with `blocksSegment`, then final forward probe. Select first safe candidate in `180L,180R,150L,150R,120L,120R,90L,90R`. If no moving arc is safe, choose first target whose final forward probe is clear and start pivot fallback.

- [x] **Step 4: Verify GREEN**

Run focused tests and require zero failures.

---

### Task 4: Runtime hazards integration and input deferral

**Files:**
- Modify: `src/runtime/HarborSimulationPorts.ts`
- Modify: `src/runtime/HarborRuntime.ts`
- Test: `test/land-recovery-runtime.test.mjs`

**Interfaces:**
- `HarborSimulationPortOptions` gains `landRecovery: LandRecoverySystem` and `landRecoveryShips(): readonly ShipModel[]`.
- `hazards(deltaSeconds)` calls recovery before movement.
- `HarborRuntime` constructs recovery from existing `#landGeometry` and `#routeConfig.navigationClearanceExtra`.
- Route commits and live draft application are deferred while `ship.landRecoveryHeadingDeg !== null`; active pointer draft rebases while recovery moves the ship.

- [x] **Step 1: Add RED runtime tests**

Assert hazards executes recovery before move, an autonomous ship approaching land turns before terminal grounding, route command stays queued during recovery then applies after finish, harbor-maneuver ships are excluded, and boundary recovery behavior remains unchanged.

- [x] **Step 2: Verify RED**

Run the runtime-focused test; expected failures because runtime does not own/call LandRecoverySystem.

- [x] **Step 3: Implement runtime wiring**

Wire the new system without changing `SimulationScheduler` order. Filter `landRecoveryShips` so active harbor maneuvers are not passed. Add land-recovery condition to route deferral and pointer draft rebasing.

- [x] **Step 4: Verify GREEN**

Run runtime-focused test and require zero failures.

---

### Task 5: Snapshot determinism, fallback grounding, and regression gate

**Files:**
- Test: `test/land-recovery.test.mjs`
- Test: `test/land-recovery-runtime.test.mjs`
- Modify if needed only for proven failures: snapshot/runtime files directly involved in restoration.

**Interfaces:**
- Capture/restore during recovery must produce identical next-step pose/state.
- Existing `GroundingSystem` must still terminate a ship already forced through forbidden geometry.

- [x] **Step 1: Add RED/acceptance assertions**

Capture a recovering ship snapshot, step original, restore a second ship, step it, and compare pose/speed/recovery state. Separately force an actual land-crossing segment and assert terminal grounding remains.

- [x] **Step 2: Run focused land-recovery suite**

Run: `node --experimental-strip-types --test test/land-recovery.test.mjs test/land-recovery-runtime.test.mjs`
Expected after implementation: PASS.

- [x] **Step 3: Run adjacent regressions**

Run existing `cor07-exit`, COR-12 route/grounding-related suites, `route-end-continuation-regression`, `route-turn-mode`, COR-13 harbor/departure tests using the available TS loader (`node --experimental-strip-types --test ...`) where no external package is required.

- [x] **Step 4: Run strict TypeScript for changed core**

Use a temporary focused tsconfig if full project typecheck is blocked by missing external dependencies; require changed production modules to typecheck with `strict: true` and `noEmit: true`.

- [x] **Step 5: Run package/Frozen validators**

Verify `PACKAGE_CHECKSUMS.sha256` after regenerating only package checksums for changed non-Frozen files if this package convention requires it. Run all Frozen Baseline checksum/geometry/semantic validators and byte-compare Frozen Baseline against source v10.

- [x] **Step 6: Attempt official owner gate**

Run `npm ci`, `npm test`, `npm run typecheck`, `npm run build`, `npm run test:browser`. If installation is blocked by the sandbox registry, record the exact environment blocker and do not claim full GREEN.

- [x] **Step 7: Package delivery ZIP and re-verify extracted bytes**

Create `PortControl_v1.9_LAND_RECOVERY_v11_2026-09-15.zip`, extract it into a fresh directory, rerun focused tests/checksums there, and ensure no `node_modules`, `dist`, `__pycache__`, or temporary test artifacts are included.
