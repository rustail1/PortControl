# PORT CONTROL — CURRENT CORE RUNTIME CONTRACT v1.9

Status: **CURRENT IMPLEMENTED CORE AUTHORITY**
Date: 2026-09-15
Applies to: runtime Core implemented through delivery v19.

This document is the single current Core delta authority. It supersedes stale Core clauses in the legacy v1.5 handoff while leaving `Port_Control_Baseline_Source_FINAL_v1.5/` byte-for-byte frozen. Historical plans/specs remain evidence, not the current rule source.

## 1. Authority and frozen boundary

- Frozen Baseline v1.5 still owns exact ship values, level geometry, IDs, config payloads and campaign content.
- Current gameplay/runtime semantics are defined by this contract plus the current Design Bible v1.9.
- Exact authored route geometry is authoritative. No RDP rewrite, waypoint-tolerance corner cutting or smoothing may change movement geometry.
- Legacy config keys such as `simplifyEpsilon`, `maxSimplifiedPoints`, `waypointTolerance`, `baseSnapDurationMs`, `snapRadius` and `collisionEnabledUntilSnapComplete` may remain in frozen JSON, but runtime adapters must not reinterpret them as old movement authority.

## 2. Route input and selection

- Route input is single-pointer owned.
- Selectable states: `Entering`, `Navigating`, `ReadyToLeave`, `Leaving`; `Docking` and `Unloading` are input-locked.
- Minimum selection hit radius is **32 CSS px** (64 px diameter), independent from simulation collision radius; overlapping candidates choose nearest, then lower `spawnSequence`.
- Drag activation threshold is **12 CSS px**.
- Route points are absolute pointer-authored world coordinates: once a point is accepted, the preview/committed endpoint matches the cursor exactly. When a fast small ship moves before the 12 CSS px activation threshold, current ship position becomes route start and a first-sample guard temporarily suppresses only a forward sample that is still behind that start along the actual gesture direction. Intentional backward gestures remain valid and enter normal TURN behavior.
- Raw sampling uses configured `sampleDistance`/`maxRawPoints`; after release the route remains the exact authored sampled polyline.
- New route replaces the old route. Invalid land suffix is rejected; the safe prefix may commit. Short/invalid/locked releases produce explicit rejection presentation rather than silent stall.

## 3. Route movement / TURN

- `ShipMotor` is sole navigation movement authority; position is simulation-owned.
- TURN reason is explicit and snapshot-backed: `reorientation` or `authored_reversal`.
- `reorientation`: when the new/current route tangent is >90 degrees behind the bow, ship holds exact route progress and speed 0 while turning physically at `turnRateDeg`; at <=90 degrees it resumes exact-polyline movement.
- `authored_reversal`: a >=120 degree authored corner uses a stationary pivot exactly on the authored corner and releases at <=60 degrees heading error.
- Normal <=90 degree corners remain moving turns with physical slowdown; no corner cutting.
- After a committed route is fully consumed, `Entering`, `Navigating` and `Leaving` continue straight on the last physical heading and smoothly accelerate toward cruise. A temporary live-draft end may hold movement so the ship does not outrun the pointer.
- No teleport, heading snap or tween-owned gameplay movement.

## 4. Harbor maneuver assist

Canonical flow:
`NAVIGATION -> APPROACH -> AUTOMATIC HARBOR ASSIST -> ALIGN/DECELERATE -> FINAL CREEP -> BERTH -> UNLOAD -> READY TO LEAVE -> ASSISTED DEPARTURE -> RELEASE -> NORMAL SHIP MOTOR`.

- Dock capture uses the frozen approach/snap-radius data only as an input boundary; runtime terminology/behavior is harbor assist, not fixed snap.
- `HarborManeuverMotor` uses real `ship.speed` and `ship.turnRateDeg`.
- Inbound heading follows harbor-lane tangent while moving; final dock heading is reached at berth under turn-rate limit.
- Final approach uses slow creep; heavy ships dock/depart more slowly than light ships.
- Departure starts at maneuver speed 0, accelerates physically, follows `berth -> alignment -> release`, then hands a non-zero sub-cruise speed to `ShipMotor`; no stop and no 0->full-cruise snap at release.
- Route presentation hides stale navigation route during assist and shows the correct departure prefix before the authored route.

## 5. Route rendering / feedback

- Presentation is `STATIC FUTURE TAIL + DYNAMIC HEAD`.
- Dynamic head is redrawn every render frame from rendered ship position to current authored waypoint; line must not remain behind the ship.
- Selected route remains visually emphasized; ship selection ring itself is not persistent.
- Click selection pulse is one-shot: smooth fade/expand/contract/fade-out, then disappears. Re-click restarts from the current visual state without a jump.
- On the single `Unloading -> ReadyToLeave` transition, the ship emits **two** one-shot selection-style pulses with a short gap; it does not repeat forever.
- A scheduled incoming spawn may expose a **presentation-only entry-location warning** during the final `min(1.25 s, effective lead time)` before materialization. The inward-pointing edge arrow is positioned along the relevant edge at the vessel's future entry location using only a normalized along-edge presentation anchor, and plays two soft alpha/scale pulses. It exposes no ship type or future path and supports presentation-only deconfliction. **Once scheduling succeeds and the warning is exposed, that transaction is committed:** the exact spawn point/identity is reserved through the lead window and materializes there without a late geometry/pressure/maxAlive re-roll. Safety/gates are checked before commitment; if no safe placement exists, no warning is shown. The pre-spawn vessel body is not rendered. This commitment consumes no additional RNG and remains snapshot/restore deterministic. Frozen v1.5 levels currently use a `0.9 s` effective lead.
- Route outcomes after release must be distinguishable as committed, visible TURN, or rejected feedback.

## 6. Cargo / departure

- Each compatible cargo unit unloads exactly once.
- If cargo remains of another type, ship returns to `Navigating` and dock occupancy is released.
- If cargo becomes empty, state becomes `ReadyToLeave`; the double availability pulse is presentation only.
- `ReadyToLeave` departure route commit is atomic through the departure coordinator; live drawing does not start departure before pointer-up.
- Deferred/pending route shape must never teleport a ship back to an old start.

## 7. Land / boundary recovery / grounding

- Map-boundary recovery remains its own existing recovery mechanism.
- Normal free-water continuation must proactively avoid land before contact via `LandRecoverySystem`.
- Recovery may safety-take-over shortly before a hazardous route endpoint when waiting would remove the physical turning margin; authored route geometry is never bent or replaced.
- Non-zero-speed recovery uses a moving `arc` selected deterministically from physically clear candidates.
- Zero-speed recovery uses an honest stationary `pivot`; after safe heading is reached, normal autonomous acceleration moves the ship away.
- A route drawn while land/boundary recovery owns movement stays pending. Before commit, the whole gesture shape is translated to the ship's current authoritative position, then canonicalized/land-validated again.
- `GroundingSystem` remains **terminal fallback only for actual forbidden contact** (bug/restore/impossible geometry/failed recovery invariant). Normal autonomous land approach should be recovered before contact.

## 8. Fixed-step order / ownership

At 60 Hz:
1. apply commands
2. spawn
3. hazards (`LandRecoverySystem`)
4. move (`ShipMotor` / harbor owner as held)
5. collision
6. grounding detection
7. terminal arbitration
8. docking
9. cargo
10. exit
11. objective/session projection
12. flush
13. snapshot capture

Collision beats grounding in same-step terminal arbitration; any terminal winner suppresses docking/cargo/exit/objective progression for that step.

## 9. Development launch / human feel

- Default development level without query: `calm_01`.
- `calm_07` is the explicit island/LandRecovery regression level (`?level=calm_07`).
- Human Feel remains mandatory after automatic GREEN; automated tests do not approve feel.

## 10. Current Core acceptance

Core is technically consistent when:
- exact authored route invariant holds;
- no stale fixed-duration dock/departure movement authority exists;
- new reverse route shows honest TURN rather than backward creep;
- route-end autonomous continuation does not stop unexpectedly;
- land is avoided before contact in normal autonomous motion;
- small ships are easy to select; accepted preview endpoints match the cursor; delayed straight drags do not create false reverse first segments;
- selection/ready-to-leave pulses are presentation-only;
- Frozen Baseline checksums remain unchanged;
- full owner machine gate and Human Feel are green.
