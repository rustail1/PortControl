# Explicit Route Turn Mode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the `routePivotProgress` inference heuristic with an explicit `RouteTurnMode` so player-route reorientation and authored reversal corners can never be confused.

**Architecture:** `ShipModel` owns the active turn reason together with the exact pivot progress and snapshots both values atomically. `ShipMotor` selects a turn mode only when a TURN is created, then executes the corresponding policy without inspecting progress relationships. Reorientation is stationary while heading error is `> 90°`; authored reversal remains anchored to the corner until the existing strict `60°` release threshold.

**Tech Stack:** Phaser 4.2.1, TypeScript 5.9 strict, Vite/ESM, Node test runner + tsx.

**Spec:** `docs/superpowers/specs/2026-09-15-explicit-route-turn-mode-design.md`

## Global Constraints

- Frozen Baseline `Port_Control_Baseline_Source_FINAL_v1.5/` must not change.
- Exact authored polyline remains movement authority; no smoothing/corner cutting.
- Fixed-step simulation remains 60 Hz; render does not decide movement.
- No ship balance changes (`speed`, `turnRateDeg`).
- Harbor maneuver/departure geometry and Level 1 selection remain unchanged.
- TDD: RED before every production behavior change; do not weaken valid tests merely to get GREEN.
- No branch/PR creation; no commit/push unless explicitly requested.

---

### Task 1: Make turn reason explicit in ShipModel and snapshots

**Files:**
- Modify: `src/ships/ShipModel.ts`
- Modify: `src/ships/index.ts`
- Create: `test/route-turn-mode.test.mjs`

**Interfaces:**
- Produces: `RouteTurnMode.Reorientation`, `RouteTurnMode.AuthoredReversal`, `ShipModel.routeTurnMode`, `ShipModel.beginRouteTurn(mode, progress)`, `ShipModel.finishRouteTurn()`.
- Snapshot invariant: `routePivotProgress` and `routeTurnMode` are both present or both absent.

- [x] **Step 1: Write RED model/snapshot tests**

Add tests that require:

```js
assert.equal(RouteTurnMode.Reorientation, 'reorientation');
assert.equal(RouteTurnMode.AuthoredReversal, 'authored_reversal');
ship.beginRouteTurn(RouteTurnMode.Reorientation, 30);
assert.equal(ship.routePivotProgress, 30);
assert.equal(ship.routeTurnMode, RouteTurnMode.Reorientation);
const restored = ShipModel.restore(ship.toSnapshot(), registry);
assert.equal(restored.routeTurnMode, RouteTurnMode.Reorientation);
assert.throws(() => ShipModel.restore({ ...snapshot, routePivotProgress: 10, routeTurnMode: undefined }, registry));
assert.throws(() => ShipModel.restore({ ...snapshot, routePivotProgress: undefined, routeTurnMode: 'reorientation' }, registry));
assert.throws(() => ShipModel.restore({ ...snapshot, routePivotProgress: 10, routeTurnMode: 'bad' }, registry));
```

- [x] **Step 2: Run focused RED**

Run:

```bash
node --import tsx --test test/route-turn-mode.test.mjs
```

Expected: FAIL because `RouteTurnMode`, `routeTurnMode`, and `beginRouteTurn` do not exist.

- [x] **Step 3: Implement the minimal explicit state model**

In `ShipModel.ts` add:

```ts
export const RouteTurnMode = {
  Reorientation: 'reorientation',
  AuthoredReversal: 'authored_reversal',
} as const;

export type RouteTurnMode = (typeof RouteTurnMode)[keyof typeof RouteTurnMode];
```

Add optional `routeTurnMode` to init/snapshot, private `#routeTurnMode`, getter, validation, snapshot serialization/restore, and clear it whenever route/pivot state is cleared. Replace ambiguous methods with:

```ts
public beginRouteTurn(mode: RouteTurnMode, progress: number): void
public finishRouteTurn(): void
```

Constructor validation must reject mode/pivot mismatch and unknown modes.

Export the constant/type from `src/ships/index.ts`.

- [x] **Step 4: Run focused GREEN**

Run the same focused test. Expected: PASS.

---

### Task 2: Remove the ShipMotor heuristic and implement the two physical policies

**Files:**
- Modify: `src/ships/ShipMotor.ts`
- Modify: `test/route-turn-mode.test.mjs`
- Modify: `test/video-fix-v8-regression.test.mjs`
- Modify: `test/cor12-route-physics.test.mjs`
- Modify: `test/cor12-authored-route-motion.test.mjs`

**Interfaces:**
- Consumes: `ShipModel.routeTurnMode`, `beginRouteTurn`, `finishRouteTurn` from Task 1.
- Produces: no new public API; movement policy is explicit and mode-driven.

- [x] **Step 1: Add RED movement tests**

Require all of these:

```js
// Reorientation at progress 0.
// First tick: mode=reorientation, speed=0, progress unchanged while error >90°.
// After enough ticks to reach <=90°: mode clears; later tick advances exact polyline.

// Reorientation at progress 30.
// It remains reorientation and progress stays exactly 30 while error >90°.
// It never converts to authored_reversal because progress relationships change.

// Authored 180° corner.
// mode=authored_reversal; progress and position stay exactly on corner until <=60°.

// Existing 90° corner never receives authored_reversal mode.
```

Update the stale v8 regression that previously required backward/sideways TURN creep. Its new expected behavior is stationary turn-in-place while the tangent is behind the forward half-plane.

- [x] **Step 2: Run focused RED**

Run:

```bash
node --import tsx --test \
  test/route-turn-mode.test.mjs \
  test/video-fix-v8-regression.test.mjs \
  test/cor12-route-physics.test.mjs \
  test/cor12-authored-route-motion.test.mjs
```

Expected: FAIL because current `ShipMotor` infers mode from progress and reorientation creeps along the route.

- [x] **Step 3: Implement explicit mode handling**

In `ShipMotor.ts`:

1. Delete `ROUTE_REORIENTATION_MIN_SPEED_SCALE` and the creeping implementation.
2. For active `RouteTurnMode.Reorientation`:
   - rotate toward current route tangent at real `turnRateDeg`;
   - set `routeSpeed = 0`;
   - do not change position/progress while error remains `> 90°`;
   - call `finishRouteTurn()` once error is `<= 90°` and return.
3. For active `RouteTurnMode.AuthoredReversal`:
   - rotate toward outgoing tangent;
   - set position to `pointAtDistance(routePivotProgress)`;
   - speed `0`;
   - release only at existing `REVERSAL_PIVOT_RELEASE_ERROR_DEG`.
4. Initial/current-tangent mismatch `> 90°` creates `beginRouteTurn(RouteTurnMode.Reorientation, ship.routeProgress)`.
5. A qualifying authored corner creates `beginRouteTurn(RouteTurnMode.AuthoredReversal, upcomingCorner.progress)`.
6. Remove every progress-based inference of TURN reason.

- [x] **Step 4: Run focused GREEN**

Run the same four test files. Expected: PASS.

---

### Task 3: Verify exact-polyline, deterministic snapshot, and adjacent harbor/departure behavior

**Files:**
- Modify only if a genuine stale assertion conflicts with the approved spec: relevant route/snapshot tests.
- No production changes unless a failing test proves a new root cause.

**Interfaces:**
- Validates Tasks 1–2; produces no new API.

- [x] **Step 1: Run adjacent route/turn regression suite**

```bash
node --import tsx --test \
  test/route-turn-mode.test.mjs \
  test/cor12-authored-route-motion.test.mjs \
  test/cor12-route-physics.test.mjs \
  test/cor12-live-follow.test.mjs \
  test/cor12-reference-steering.test.mjs \
  test/cor12-stable-feel.test.mjs \
  test/video-fix-v6-regression.test.mjs \
  test/video-fix-v7-regression.test.mjs \
  test/video-fix-v8-regression.test.mjs
```

Expected: all PASS. Any assertion failure requires root-cause analysis before changing code/test.

- [x] **Step 2: Run harbor/departure focused regression**

```bash
node --import tsx --test \
  test/cor05-docking.test.mjs \
  test/cor07-exit.test.mjs \
  test/cor12-dock-departure-regression.test.mjs \
  test/cor12r-departure-flow.test.mjs \
  test/cor13-harbor-maneuver.test.mjs \
  test/cor13-route-feedback.test.mjs \
  test/cor13-route-render.test.mjs
```

Expected: all PASS.

- [x] **Step 3: Run strict typecheck**

```bash
npm run typecheck
```

Expected: PASS when dependencies are available. If the environment lacks npm packages, record the exact environment blocker and run the strongest dependency-free TypeScript/focused checks available without changing project files.

- [x] **Step 4: Validate Frozen Baseline**

```bash
python tools/validate_baseline.py .
python tools/validate_localization.py .
python tools/semantic_roundtrip.py .
python tools/validate_assets.py .
```

Expected: all PASS; baseline files byte-identical to the input package.

- [ ] **Step 5: Run final owner automatic gate if dependencies are available**

```bash
npm test
npm run typecheck
npm run build
npm run test:browser
```

Expected: all PASS. Human Feel remains separate and must not be claimed automatically.

**Environment note:** the delivery sandbox has no project `node_modules`; `npm ci --offline` is blocked by missing cached `vite-8.2.2`. The dependency-free final route suite is 57/57 GREEN, pure harbor/departure suite is 19/19 GREEN, targeted strict TypeScript is GREEN, package checksums are 104/104, Frozen Baseline checksums are 90/90, and all four Frozen Baseline validators pass. Running the entire Node test catalog without dependencies produces the same 542 environment/pre-existing failures as the input v8 package; the only failure-name delta is the intentionally updated reverse-turn contract. The full npm gate remains owner-machine verification.
