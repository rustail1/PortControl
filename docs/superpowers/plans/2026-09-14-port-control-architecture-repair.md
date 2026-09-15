# Port Control Architecture Repair Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Устранить архитектурные дыры текущего Port Control без переписывания игры: закрепить единственный Source of Truth, сделать переходы/terminal fail/выход из дока атомарными, вынести fixed-step orchestration из `HarborRuntime`, подготовить полный deterministic snapshot/rewind contract, запретить запуск неподдерживаемых уровней и убрать двойные источники lifecycle/events/state.

**Architecture:** `HarborRuntime` остаётся composition/presentation facade, но перестаёт быть владельцем всей симуляции. `GameSession` владеет session state и через отдельный `SimulationScheduler` — fixed-step порядком; системы возвращают typed results/facts и не вызывают `step()` друг друга. `ShipModel` остаётся authoritative owner состояния корабля, но generic mutation API заменяется проверяемыми семантическими переходами. Frozen Baseline v1.5 не меняется.

**Tech Stack:** Phaser 4.2.1, TypeScript strict, Vite/ESM, `node:test` + `tsx` в текущем repo, Playwright browser gate, AJV validation, fixed 60 Hz simulation.

**Spec:** текущий `Port_Control_COMPLETE_DESIGN_BIBLE_FINAL_v1.5.docx`, `AGENTS.md`, `PROJECT_MAP.md`, плюс owner-approved authority decisions из Task AR-00.

## Global Constraints

- Рабочая ветка при реализации: только `main`; никаких branch/PR.
- Перед каждым COR: fresh HEAD, `git status`, не терять unrelated local changes.
- `Port_Control_Baseline_Source_FINAL_v1.5/` не менять.
- Никакого `Math.random()` в simulation.
- Phaser/render не владеют authoritative gameplay state.
- Не внедрять ECS, DI-framework, SpatialHash, глобальный event bus или полный rewrite.
- Не реализовывать Current/Storm/Fog как часть архитектурного ремонта; до их реализации уровни, требующие их, должны быть capability-gated.
- Не менять Human Feel движения корабля в архитектурных COR, кроме поведения, прямо требуемого authority decision.
- Каждый COR: RED -> минимальный patch -> focused GREEN -> diff review -> полный gate один раз перед delivery.
- Полный gate: `npm.cmd test` -> `npm.cmd run typecheck` -> `npm.cmd run build` -> `npm.cmd run test:browser` -> frozen validators задачи.
- Human Feel не считается пройденным автоматикой.

---

## Target architecture after repair

```text
main.ts / GameBootstrap
        |
        v
HarborScene -------------------------- presentation/input only
        |
        v
HarborRuntime ------------------------ composition + facade, no game rules
        |
        v
GameSession
  | owns session state/result
  | owns fixed-step order via SimulationScheduler
  v
SimulationScheduler
  1 CommandQueue
  2 SpawnDirector / IncomingSpawnSystem
  3 Hazard port (empty until hazards implemented)
  4 ShipMotor
  5 CollisionSystem
  6 GroundingSystem
  7 TerminalFailureArbitrator
  8 DockingController
  9 CargoSystem
 10 ExitSystem
 11 Objective/metrics/score
 12 Rewind capture boundary
 13 EventFlush

Authoritative mutations:
ShipModel semantic API only
DockSystem reservation/occupancy only
Systems -> typed result/facts -> scheduler/session
Presentation -> read-only snapshots only
```

## What is intentionally removed from the architecture

- Public generic `ShipModel.setState(...)` as a normal production API.
- Direct state changes spread across `DockingController`, `CargoSystem`, `RouteCommitService`, `ExitSystem` without transition validation.
- `HarborRuntime` as de-facto GameManager.
- Non-atomic sequence “commit route / set Leaving / then try beginDeparture”.
- Authoritative duplication “system returns fact AND independently emits the same fact as event”.
- Direct `window/document` lifecycle ownership inside `HarborScene`.
- Silent launch of levels containing unsupported `current_zone`, `storm_path`, `fog_zone`.
- Raw `Record<string, unknown>` casting throughout runtime after validation boundary.
- Permanent growth of completed/known ID sets where lifecycle cleanup is possible.
- Gameplay use of RDP/waypoint tolerance if owner freezes exact-authored-polyline decision in AR-00.
- Grounding auto-recovery if owner confirms Design Bible terminal-grounding semantics in AR-00.

---

# AR-00 — Authority Lock Before Code

**Size:** S, documentation/contract only. **Risk:** Critical if skipped.

**Why:** Сейчас есть реальные authority conflicts. `AGENTS.md` прямо требует `BLOCKED`, если Design Bible и production contract расходятся. Нельзя чинить архитектуру поверх двух разных правил.

**Files:**
- Create: `docs/architecture/ARCHITECTURE_REPAIR_DECISIONS_v1.6.md`
- Modify: `AGENTS.md`
- Modify: `PROJECT_MAP.md`
- Modify later only after owner approval: canonical Design Bible/package authority references; Frozen Baseline untouched.

**Owner decisions to freeze:**

1. **Route semantics — recommended decision:** текущий accepted COR-12 contract становится каноном: gameplay navigation следует exact authored polyline; physics меняет время/скорость, но не геометрию. No RDP rewrite, no waypoint corner cutting. `simplifyEpsilon`, `maxSimplifiedPoints`, `waypointTolerance` остаются frozen legacy config keys до отдельной baseline migration, но runtime их не использует.
2. **Grounding — recommended decision:** следовать Design Bible: grounding forbidden land/channel = terminal failure. Current “clamp + turn away + recover” удаляется из authoritative gameplay.
3. **Test tooling:** зафиксировать текущий реально используемый `node:test + tsx` как repo test runner либо отдельно запланировать migration to Vitest. Не держать одновременно два заявленных toolchain contract.

**Acceptance:** до AR-01 нет ни одного неразрешённого authority conflict по route/grounding/toolchain.

---

# AR-01 — Ship Lifecycle and Mutation Boundary

**Size:** M. **Risk:** High. **Purpose:** невозможные state transitions должны стать технически невозможными.

**Files:**
- Create: `src/ships/ShipLifecycle.ts`
- Modify: `src/ships/ShipModel.ts`
- Modify callers: `src/docks/DockingController.ts`, `src/docks/CargoSystem.ts`, `src/routes/RouteCommitService.ts`, `src/exits/ExitSystem.ts`
- Test: `test/architecture-ship-lifecycle.test.mjs`
- Regression: `test/cor01-ship-domain.test.mjs`, `test/cor05-docking.test.mjs`, `test/cor06-cargo.test.mjs`, `test/cor07-exit.test.mjs`

**Target interface:**

```ts
export type ShipTransitionReason =
  | 'route_committed'
  | 'dock_reserved'
  | 'harbor_assist_started'
  | 'berth_lock_completed'
  | 'cargo_partial_complete'
  | 'cargo_fully_complete'
  | 'departure_started'
  | 'terminal_collision'
  | 'terminal_grounding';

export function canTransitionShip(
  from: ShipState,
  to: ShipState,
  reason: ShipTransitionReason,
): boolean;
```

`ShipModel` exposes semantic methods instead of free-form state writes:

```ts
ship.beginNavigationFromRoute();
ship.beginDockApproach();
ship.beginDocking();
ship.beginUnloading();
ship.finishCargoService({ cargoRemaining: boolean });
ship.beginLeaving();
ship.destroy(reason);
```

**RED tests:**
- `Unloading -> Leaving` without cargo completion/departure transaction throws/rejects.
- `ReadyToLeave -> ApproachingDock` impossible.
- `Destroyed -> any moving state` impossible.
- Valid frozen state-machine path remains accepted.

**Implementation rule:** do not create another owner of ship state. `ShipLifecycle.ts` defines rules; `ShipModel` owns the actual state.

**Expected visible behavior:** none. This is an invariant COR; the game should feel identical.

**Delete/deprecate:** generic production `setState`. Tests may use constructor/restore snapshots instead of bypassing lifecycle.

---

# AR-02 — Terminal Failure, Grounding, Destroyed State

**Size:** M. **Risk:** High. **Purpose:** terminal failure and state machine must agree in the same fixed step.

**Files:**
- Create: `src/core/TerminalFailureArbitrator.ts`
- Modify: `src/grounding/GroundingSystem.ts`
- Modify: `src/collision/CollisionSystem.ts` only if result shape needs normalized terminal candidate
- Modify: current fixed-step owner (`HarborRuntime.ts` before AR-04, later scheduler)
- Modify: `src/ships/ShipModel.ts`
- Test: `test/architecture-terminal-failure.test.mjs`
- Regression: `test/cor08-collision.test.mjs`, `test/cor11-session.test.mjs`

**Target result:**

```ts
type TerminalFailureCandidate =
  | { kind: 'collision'; shipIds: readonly [string, string]; distanceSquared: number }
  | { kind: 'grounding'; shipId: string; spawnSequence: number };

chooseTerminalFailure({ collision, grounding, priority }): TerminalFailureCandidate | null;
```

**RED tests:**
- Grounding candidate is terminal on forbidden land.
- Collision and grounding in same step: frozen priority chooses collision.
- Winning ship(s) become `Destroyed` in same authoritative step.
- Docking/cargo/exit/objective do not progress after terminal winner.
- No new warning/reward emitted after same-step terminal decision.

**Implementation:** `GroundingSystem` detects and returns candidate; it no longer moves/turns the ship away. The scheduler applies `ship.destroy(...)` only after arbitration selects the winner.

**Expected visible behavior:** grounding now ends the attempt consistently; collision victims visibly freeze as Destroyed rather than session failing while model still says Navigating.

**Remove:** shoreline recovery from `GroundingSystem`; keep route recovery only for non-terminal exit/cargo rejection behavior if still canonical.

---

# AR-03 — Atomic Route Commit / Dock Departure + Wrong-Dock Facts

**Size:** L. **Risk:** High. **Purpose:** убрать источник “Leaving without departure transaction” и подключить star condition `max_wrong_dock_attempts`.

**Files:**
- Create: `src/docks/DepartureCoordinator.ts`
- Modify: `src/routes/RouteCommitService.ts`
- Modify: `src/docks/DockingController.ts`
- Modify: `src/runtime/HarborRuntime.ts`
- Modify: `src/core/GameSession.ts` input wiring only
- Test: `test/architecture-departure-atomicity.test.mjs`
- Test: `test/architecture-wrong-dock.test.mjs`
- Regression: all `cor12-dock-departure-*`, `cor05`, `cor06`, `cor11`

**Target API:**

```ts
export type PreparedRouteCommit = {
  readonly route: ShipRoute;
  readonly routeStart: Point;
  readonly kind: 'committed' | 'partial_prefix_committed';
};

RouteCommitService.prepare(...): PreparedRouteCommit | RejectedRouteCommit;
DepartureCoordinator.commit(ship, prepared):
  | { ok: true }
  | { ok: false; reason: string };
```

For `ReadyToLeave`, successful transaction must be all-or-nothing:

```text
validate occupied dock
-> derive release
-> validate prepared route begins exactly at release
-> create departure transaction
-> install route
-> transition ReadyToLeave -> Leaving
-> hold route motion
COMMIT
```

If any step fails: ship remains `ReadyToLeave`, existing dock occupancy remains, route/state unchanged.

**Wrong dock contract:** `DockingController.step()` returns exact outside->inside incompatible approach-radius facts:

```ts
readonly wrongDockAttemptFacts: readonly {
  shipId: string;
  dockId: string;
}[];
```

Busy-compatible dock does not count. Staying inside does not count repeatedly. Leave+re-enter may count again. Ship cleanup forgets tracking state.

**RED tests:** atomic failure at every precondition; no half-mutated state. `river_11` wrong-dock star counter changes only on valid crossing semantics.

**Expected visible behavior:** no vessel can be in `Leaving` while still docked without an active departure transaction; wrong-dock mastery becomes truthful.

---

# AR-04 — Real CommandQueue + SimulationScheduler; Shrink HarborRuntime

**Size:** XL but decomposed into 3 commits. **Risk:** Highest. **Purpose:** убрать God Manager without rewrite.

**Files:**
- Create: `src/core/CommandQueue.ts`
- Create: `src/core/SimulationScheduler.ts`
- Create: `src/core/SimulationStepResult.ts`
- Modify: `src/core/GameSession.ts`
- Modify: `src/runtime/HarborRuntime.ts`
- Modify: `PROJECT_MAP.md`
- Test: `test/architecture-fixed-step-order.test.mjs`
- Test: `test/architecture-terminal-suppression.test.mjs`
- Regression: deterministic/core + all COR suites.

**Responsibility split:**

`HarborRuntime` keeps only composition, viewport/input facade, presentation snapshot, browser smoke adapter and render-clock entry.

`CommandQueue` owns queued route commands and deterministic drain order.

`SimulationScheduler` owns the frozen fixed-step sequence but owns no gameplay data. It accepts ports to systems and produces `SimulationStepResult`.

`GameSession` remains owner of session state/result and invokes scheduler only while Active.

**Frozen step sequence:**

```text
1  apply commands
2  spawn director / incoming
3  hazard port (no-op until implemented)
4  ship motor
5  danger/collision
6  grounding
7  terminal arbitration
   if failed -> skip 8-11
8  docking
9  cargo
10 exit
11 objective/score/session metrics
12 rewind capture boundary (later AR-05)
13 event flush
```

**Architecture tests:** record call order and assert no subsystem `.step()` calls another subsystem. Terminal step must suppress docking/cargo/exit/objective.

**Success target:** `HarborRuntime.ts` materially shrinks and has no detailed game-rule branching. Do not chase an arbitrary LOC number; reviewer must be able to describe its responsibility in one sentence.

**Do not do:** no ECS, no generic dependency container, no event-sourcing rewrite.

---

# AR-05 — Deterministic Complete Snapshot / Restore Boundary

**Size:** XL. **Risk:** High. **Purpose:** сделать архитектуру реально rewind-ready без внедрения rewarded rewind UI.

**Files:**
- Create: `src/rewind/SessionSnapshot.ts`
- Create: `src/rewind/SimulationSnapshotService.ts`
- Add snapshot/restore to: `DockingController`, `CargoSystem`, `ExitSystem`, `CollisionSystem`, `IncomingSpawnSystem`
- Reuse existing: `ShipModel`, `SpawnDirector`, `GameSession`, `SeededRng`
- Modify: scheduler/runtime capture boundary
- Test: `test/architecture-snapshot-roundtrip.test.mjs`
- Test: `test/deterministic-rewind-ready.test.mjs`

**Snapshot MUST contain authoritative transient state:**
- GameSession/objective/metrics/score/time/result.
- RNG state and next identity/spawn sequence.
- SpawnDirector state.
- Incoming spawn transactions + spawn-point ownership + queued ready/indicator commands if any at the defined boundary.
- Every active ship full snapshot + spawn metadata.
- Dock reserved/occupied state.
- Docking transactions.
- Cargo transactions and unload elapsed time.
- Exit pending/edge-crossing tracking needed for deterministic outcome.
- Collision danger-pair armed/rearm timers and terminal latch.

**Snapshot MUST NOT contain:** Phaser objects, Graphics, DOM, presentation pulses, selected mouse pointer, live route preview.

**Capture invariant:** snapshot only at end-of-fixed-step after commands and events are drained. Therefore authoritative command queue/event queue must be empty; assert this rather than serialize arbitrary half-frame UI input.

**Restore behavior:** cancel active pointer draft; clear presentation-only pulses; restore authoritative sim; rebuild derived candidate arrays; render derives fresh view.

**RED/GREEN proof:** run seed N seconds -> snapshot -> run M seconds -> checksum A -> restore -> run same M seconds -> checksum B; A === B including ships, docks, director, metrics and session result.

---

# AR-06 — Typed Runtime Config + LevelDefinition + Capability Gate

**Size:** L. **Risk:** Medium. **Purpose:** убрать raw casts и запретить silent partial levels.

**Files:**
- Create: `src/config/LevelDefinition.ts`
- Create: `src/config/RuntimeConfigRegistry.ts`
- Create: `src/config/RuntimeCapabilities.ts`
- Modify factories to consume typed definitions.
- Modify: `src/scenes/HarborLevelSelection.ts`, `src/runtime/HarborRuntime.ts`
- Test: `test/architecture-level-capabilities.test.mjs`
- Test: `test/architecture-runtime-config-types.test.mjs`

**Target:** AJV remains schema gate. Immediately after validated load, runtime converts validated records to typed readonly definitions. `HarborRuntime` must not cast `balance.json`/level with `as unknown as`.

**Capabilities derived from block types, never level IDs:**

```ts
type RuntimeCapability =
  | 'core-routing'
  | 'current-zone'
  | 'storm-path'
  | 'fog-zone'
  | 'rewind';
```

Current runtime advertises only implemented capabilities. A level with `current_zone`, `storm_path` or `fog_zone` must be rejected/disabled with explicit missing capability until its actual system exists.

**Expected behavior:** `calm_01` etc. launch normally. `river_16` cannot silently run without current system. `storm_21` cannot silently run without storm. `storm_24` cannot silently run without fog.

**Do not implement hazards here.** This COR makes absence explicit and safe.

---

# AR-07 — Platform Lifecycle Has One Owner

**Size:** M. **Risk:** Medium.

**Files:**
- Modify: `src/platform/LocalPlatformAdapter.ts`
- Modify: `src/main.ts`
- Modify: `src/scenes/HarborScene.ts`
- Optionally create: `src/app/GameBootstrap.ts`
- Test: `test/architecture-platform-lifecycle.test.mjs`
- Regression: `test/local-platform-adapter.test.mjs`, browser smoke.

**Target:** `HarborScene` never subscribes directly to `document.visibilitychange`, `window.blur`, `window.focus`. Platform adapter owns lifecycle source; game subscribes through `onPause/onResume`.

**Calls:**
- session enters playable Active -> `gameplayStart()` once.
- pause/focus/ad -> simulation paused via platform lifecycle.
- result/scene shutdown/ad boundary -> `gameplayStop()` exactly once per transition.

**Expected behavior:** local browser and future Yandex adapter produce the same gameplay lifecycle contract; no double-pause/double-resume.

---

# AR-08 — One Authoritative Facts Channel; Events Become Projection

**Size:** M/L. **Risk:** Medium.

**Files:**
- Modify: `CollisionSystem.ts`, `CargoSystem.ts`, `ExitSystem.ts`, `DockingController.ts`
- Create: `src/core/SimulationFacts.ts`
- Modify: scheduler/event flush
- Modify presentation subscriptions
- Test: `test/architecture-facts-events.test.mjs`

**Decision:** systems return authoritative facts/results. They do NOT also independently emit the same authoritative event. After state/session decisions, a single EventFlush converts accepted facts into presentation/analytics events.

Examples:

```ts
CollisionStepResult.dangerWarnings: DangerWarningFact[];
CargoStepResult.unloadedFacts: CargoUnloadFact[];
ExitStepResult.exitedShipFacts: ExitedShipFact[];
DockingStepResult.wrongDockAttemptFacts: WrongDockAttemptFact[];
```

**Why:** metric/objective logic and visual/analytics consumers can no longer disagree about whether an event happened.

**Expected behavior:** no visible difference; event order becomes deterministic and testable.

---

# AR-09 — Endless Memory Hygiene + Presentation Dirty Rendering

**Size:** M. **Risk:** Low/Medium.

**Files:**
- Modify: `src/exits/ExitSystem.ts`
- Modify: `src/spawning/IncomingSpawnSystem.ts`
- Modify cleanup in scheduler/runtime
- Modify: `src/scenes/HarborScene.ts`
- Possibly create: `src/presentation/RouteRenderState.ts`
- Test: `test/architecture-endless-memory.test.mjs`
- Test: `test/architecture-route-render-dirty.test.mjs`

**Memory:** every per-ship/per-transaction cache gets explicit `forgetShip`/release lifecycle. `IncomingSpawnSystem.#knownTransactionIds` cannot grow forever; uniqueness should be guaranteed by active IDs/monotonic allocator, not unbounded history. `ExitSystem.#done` and edge-tracking sets are cleared when a ship is permanently removed.

**Presentation:** route Graphics redraw only when route geometry/cursor/selection/draft changes, not every render frame. Cargo pips update only when cargo snapshot changes. Do not optimize collision O(n²); <=30 is accepted.

**Proof:** synthetic Endless run with thousands of spawn/exit cycles shows bounded collection sizes relative to active/pending entities. Rendering test shows identical unchanged frame does not issue route redraw.

---

# AR-10 — Type/Module Cleanup After Behavior Is Stable

**Size:** S/M. **Risk:** Low. **Must be last.**

**Files:**
- Create: `src/shared/geometry/Point.ts` (or equivalent existing shared location)
- Modify: `ShipModel.ts`, `ShipRoute.ts` to remove cyclic type ownership.
- Review unused: `BootstrapScene.ts`, `DebugOverlay.ts`, `MachineContractIdRegistry.ts`, barrels.
- Modify docs/project map.
- Test: existing full suite + import-boundary test.

**Rules:**
- Break `ShipModel <-> ShipRoute` type cycle by moving neutral `Point/ShipPosition` type below both.
- `BootstrapScene`: either wire it as the actual boot/viewport scene in the planned scene flow or delete it; do not keep duplicate resize ownership unused.
- `DebugOverlay`: keep only if wired behind DEV flag; otherwise remove production dead module.
- `MachineContractIdRegistry`: keep because it is a valid future boundary only if an actual analytics/audio consumer is scheduled next; otherwise mark staged explicitly rather than pretending it is runtime-active.
- Remove obsolete route simplifier exports/runtime params only after AR-00 authority decision and all dependent tests are migrated.

**No behavior change allowed in this COR.**

---

# Delivery order and gates

| Order | COR | Risk | Human Feel needed? | Main observable outcome |
|---:|---|---|---|---|
| 0 | AR-00 Authority | Critical | Owner decision | one rulebook |
| 1 | AR-01 Lifecycle | High | No | impossible states blocked |
| 2 | AR-02 Terminal | High | Yes: grounding/collision | Destroyed/fail coherent |
| 3 | AR-03 Departure/Wrong Dock | High | Yes | atomic departure, correct mastery |
| 4 | AR-04 Scheduler | Highest | Yes full core flow | HarborRuntime stops being GameManager |
| 5 | AR-05 Snapshot | High | No UI yet | deterministic restore |
| 6 | AR-06 Config/Capabilities | Medium | Level launch smoke | unsupported content blocked |
| 7 | AR-07 Platform | Medium | Pause/focus smoke | one lifecycle owner |
| 8 | AR-08 Facts/Events | Medium | No | one authoritative fact stream |
| 9 | AR-09 Perf/Memory | Low/Med | Long-run + visual | bounded endless + less redraw |
| 10 | AR-10 Cleanup | Low | No | clean module graph |

## Stop conditions

- Any RED test does not fail for the expected reason -> stop, diagnosis was wrong.
- Any COR needs Frozen Baseline edit -> `HUMAN_GATE`, do not change it silently.
- Any new system requires route Human Feel change -> separate approved task, not architecture repair.
- Three attempted fixes in one COR reveal new shared-state failures -> stop and re-evaluate that boundary rather than layering patch #4.

## Definition of repaired architecture

Architecture repair is complete only when all of the following are true:

1. No unresolved authority conflict for implemented behavior.
2. Invalid ShipState transitions cannot be produced through normal production API.
3. Terminal collision/grounding produces coherent `Destroyed` + Failed state in same step.
4. Departure commit is atomic.
5. Wrong-dock metrics are real, not permanently zero.
6. Fixed-step order is encoded/tested outside the giant runtime facade.
7. Snapshot roundtrip is deterministic across transient systems.
8. Unsupported hazard levels cannot silently launch.
9. Platform lifecycle has one owner.
10. Authoritative facts are not duplicated across result + event paths.
11. Endless bookkeeping is bounded.
12. Route presentation is dirty-driven rather than unconditional redraw.
13. No known circular/dead module ambiguity remains undocumented.
14. Full automatic gate is GREEN and owner manually accepts affected Human Feel scenarios.

## Explicitly out of scope

Current/Storm/Fog implementation, actual rewarded Rewind UI, YandexPlatformAdapter, cloud save, meta/economy UI, Level Editor implementation, audio system, analytics backend, new art, new levels, spatial hash, ECS, multiplayer, new route feel tuning.
