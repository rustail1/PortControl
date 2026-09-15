# Predictive Land Recovery Design

**Status:** Implemented design for owner-approved behavior from 2026-09-15.

**Authority:** `docs/architecture/LAND_RECOVERY_DECISIONS_v1.9.md` supersedes only the old AR-00 prohibition on automatic grounding recovery. Frozen Baseline v1.5 is unchanged.

## Goal

A ship whose current or imminent post-route continuation reaches an island/shore must not lose the run merely because it reaches forbidden land. It must detect the hazard early enough for a physical turn away and continue sailing in open water, analogous in intent to world-boundary recovery. When a validated route ends too close to shore for a moving turn, safety recovery may take authority shortly before that endpoint rather than wait for an emergency pivot.

## Non-goals

- Do not bend or rewrite the player's authored route.
- Do not auto-route around an island and then return to the old course.
- Do not modify Frozen Baseline geometry, ship balance, or level data.
- Do not change harbor docking/departure authority.
- Do not remove terminal grounding as a safety fallback.

## Activation contract

`LandRecoverySystem` is proactive only for autonomous free-water motion. A ship is eligible when all are true:

- state is `Entering`, `Navigating`, or `Leaving`;
- not in a harbor maneuver;
- `routeMotionHeld === false`;
- `routeRecoveryHeadingDeg === null` (boundary/exit recovery is not active);
- land recovery is not already active, unless the system is checking whether the active recovery can finish;
- route is absent/consumed, **or** its endpoint is within the physical recovery look-ahead and the straight continuation from that endpoint is predicted to hit land.

`NavigationValidator` still owns authored-point validity. Land recovery never bends or replaces the polyline. For the endpoint-hazard case it may explicitly cancel the small remaining tail early enough to preserve a moving physical turn; current speed is preserved.

## Components

### `LandRecoverySystem`

Create `src/grounding/LandRecoverySystem.ts` next to terminal `GroundingSystem`.

It is stateless. Each fixed step in the existing `hazards()` phase it receives active ship candidates and the authoritative `LandClearanceGeometry`.

For an eligible ship not already recovering:

1. Compute hull clearance:
   `collisionRadius + navigationClearanceExtra`.
2. Compute the physical turn radius from current autonomous speed and `turnRateDeg`:
   `radius = speed / (turnRateDeg * PI / 180)`.
3. Probe the forward corridor far enough to cover one turn radius, hull clearance, one fixed-step travel distance, and a small deterministic numeric margin.
4. If the corridor is clear, do nothing.
5. If land is ahead, simulate candidate turns at fixed 60 Hz using the **same current speed** and maximum physical turn rate. Test each predicted segment with `LandClearanceGeometry.blocksSegment(...)` and the same hull clearance.
6. Candidate order is deterministic: reversal magnitudes `180, 150, 120, 90` degrees; for each magnitude test left then right. The first fully clear physical arc whose final forward safety probe is also clear wins.
7. If no moving candidate is clear, start an emergency stationary pivot toward the first reverse-water candidate. This is a safety fallback, not normal feel.

The system returns started/finished ship IDs for tests/diagnostics but owns no presentation state.

### `ShipModel`

Add explicit snapshot-backed land recovery state:

- `landRecoveryHeadingDeg: number | null`
- `landRecoveryTurnSign: -1 | 1 | null`
- `landRecoveryMotion: 'arc' | 'pivot' | null`

Add semantic methods:

- `beginLandRecovery(headingDeg, turnSign, motion)`
- `finishLandRecovery()`

Starting recovery removes an already-consumed route without losing the current physical `routeSpeed`. A dedicated route-hazard semantic method may also clear an unfinished final tail when the endpoint's continuation is known to lead into land and waiting would remove the physical turn margin. It does **not** reuse `beginRouteRecovery`, because that is boundary/exit recovery and currently has different semantics.

Replacing a route explicitly cancels land recovery. Route input commits are deferred while land recovery is active, matching existing boundary-recovery behavior.

### `ShipMotor`

When land recovery is active and no authored route owns movement:

- rotate by at most `turnRateDeg * dt` in the stored turn direction;
- in normal `arc` mode, move forward by the current `routeSpeed * dt`;
- in emergency `pivot` mode, hold position and speed at zero until the target heading is reached;
- never teleport or snap rotation;
- never exceed ship cruise speed.

For normal arc recovery the current speed is preserved, so no `0 -> cruise` discontinuity is introduced. After recovery finishes, the existing no-route autonomous continuation continues on the new heading.

### `HarborSimulationPorts` / `HarborRuntime`

Use the existing scheduler `hazards()` phase rather than changing scheduler order.

`HarborRuntime` owns one `LandRecoverySystem` configured with the same authoritative land geometry and `navigationClearanceExtra` used by `NavigationValidator` and `GroundingSystem`.

`HarborSimulationPorts.hazards()` calls the recovery step before `move()`.

The existing post-movement `GroundingSystem` remains unchanged as terminal fallback.

## Recovery completion

An active arc/pivot recovery completes when:

- hull heading has reached the stored target heading within fixed-step epsilon; and
- a forward safety probe from the current position at the new heading is clear.

Completion is decided in the next pre-movement `hazards()` phase. The ship then continues autonomous forward motion on that new heading.

### Deferred route input during recovery

A route released while land/boundary recovery owns movement remains queued. At the fixed step where recovery releases authority, preserve the authored shape by translating the whole draft from its sealed `start` to the ship's current authoritative route start, then run the normal canonicalize -> validate -> commit pipeline again. Do not commit the stale absolute start and do not mutate individual corners independently.

A moving `arc` may only be selected when the ship has real non-zero `routeSpeed`. At zero speed, select `pivot`; after the safe heading is reached, normal autonomous acceleration moves the ship away from land.

## Snapshot / rewind

`ShipModelSnapshot` must include all active land recovery fields. Capture/restore during a recovery must reproduce the same next fixed-step pose and recovery completion timing.

No new system snapshot is needed because `LandRecoverySystem` itself is stateless.

## Grounding semantics

`GroundingSystem` remains terminal when the **actual moved segment** enters forbidden clearance. Existing collision-vs-grounding terminal arbitration stays unchanged.

The new proactive system prevents that path during normal autonomous free-water motion; it does not weaken terminal safety assertions for already-contacting ships.

## Testing

RED tests before production changes must cover:

1. post-route autonomous ship approaching a flat shore starts land recovery before contact and does not produce terminal grounding;
2. speedboat and tanker both recover, with tanker triggering from farther away / taking longer due to its physical turn rate;
3. a safe unfinished authored route is untouched, while a straight route ending too close to land is taken over early enough for an `arc` rather than emergency `pivot`;
4. recovery arc never intersects land clearance for all four ship types;
5. snapshot/restore halfway through recovery produces identical continuation;
6. route input commit is deferred during land recovery;
7. if a ship is already forced through forbidden geometry, `GroundingSystem` still returns terminal grounding;
8. harbor maneuver states remain unaffected;
9. boundary `routeRecoveryHeadingDeg` behavior remains unchanged.

Focused suite should include existing `cor07-exit`, COR-12 route/grounding, route-end continuation, harbor maneuver/departure, and new land-recovery tests.

## Human Feel acceptance

On `calm_07` island regression:

1. draw a route toward the island so validation ends the line before forbidden clearance;
2. the ship must begin a **moving** recovery turn early enough to avoid touching the island, even if that requires safety takeover shortly before the route endpoint;
3. no fail/game-over should occur;
4. no teleport or heading snap;
5. speedboat turns more quickly; freighter/tanker turn more slowly and visibly begin avoiding earlier;
6. after the turn the ship continues sailing away on its new heading.
