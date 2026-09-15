# Port Control Land Recovery Decisions v1.9

Status: OWNER APPROVED by direct instruction on 2026-09-15. Frozen Baseline v1.5 remains unchanged.

This authority supersedes **only** the `Architecture Repair Decisions v1.6 / AR-00 Grounding` rule that forbids automatic recovery. All other Architecture Repair, Harbor Maneuver Assist, route-geometry, scheduler, and Frozen Baseline decisions remain in force.

## LR-01 — Proactive recovery before land contact

When a ship is in free-water motion and its current/post-route continuation would carry it into forbidden land, that future contact is **not** an intended terminal gameplay event.

Before physical contact, runtime must predict whether the continuation will reach forbidden land and start an automatic recovery turn early enough to keep the hull clearance outside forbidden geometry. If a validated route ends so close to land that waiting for its endpoint would leave insufficient physical turn radius, recovery may take safety authority shortly before the endpoint.

## LR-02 — Exact authored geometry is never rewritten; safety takeover is explicit

Land recovery must not bend, smooth, offset, or generate a replacement for the player's authored polyline. `NavigationValidator` remains the authority for which authored points are valid.

Proactive land recovery may start when:
- ship state is `Entering`, `Navigating`, or `Leaving`;
- the ship is not under harbor maneuver authority;
- route motion is not held;
- boundary/exit recovery is not active;
- and either the route is absent/consumed, **or** the remaining route endpoint is inside the physical recovery look-ahead and its straight post-route continuation is predicted to hit land.

In that final case, LandRecovery performs an explicit **safety authority takeover**: it clears the remaining authored tail without modifying its geometry and preserves current physical speed. This exists specifically so a normal draw-toward-shore gesture can still produce a moving recovery arc instead of being forced into an emergency stationary pivot at the validated endpoint.

## LR-03 — Physics-driven U-turn

Land recovery is not a teleport, clamp, tween, position snap, or generated replacement route.

The ship keeps its current physical speed and turns at no more than its real `turnRateDeg`. The system predicts candidate recovery arcs using the ship's current speed, turn rate, collision radius, and configured navigation clearance.

Normal recovery preference:
1. choose a collision-free turn that sends the ship generally back toward the water it came from;
2. prefer the largest safe reversal angle (180°, then 150°, 120°, 90°);
3. for equal safe candidates use deterministic left-before-right tie-breaking;
4. if no moving arc is safe, use an emergency in-place pivot before contact rather than intentionally entering land.

Heavy ships therefore begin recovery earlier and take longer to complete it because their physical turn radius is larger/slower.

## LR-04 — Grounding remains terminal fallback

`GroundingSystem` continues to report terminal grounding if a ship's actual moved segment intersects forbidden land clearance.

This is a fallback for already-invalid states, restore anomalies, impossible geometry, or a failed recovery invariant. In normal free-water gameplay, proactive land recovery should prevent this terminal path from being reached.

Docking and unloading exemptions remain unchanged.

## LR-05 — Boundary recovery remains separate

Existing `ExitSystem` / `routeRecoveryHeadingDeg` behavior is not rewritten by this change.

Land recovery uses an explicit, separate ship state so boundary recovery and land recovery cannot be inferred from route progress or accidentally overwrite one another.

## LR-05A — Deferred route input is rebased after recovery

A player may finish drawing a route while land or boundary recovery temporarily owns movement. That released draft stays pending. Before it becomes authoritative, the entire authored draft is translated by the delta from its sealed gesture start to the ship's current authoritative route start, preserving every authored segment/turn, then it is canonicalized and land-validated again. This prevents a deferred route from pulling or teleporting the ship back to the pre-recovery position.

## LR-05B — Arc mode requires real forward speed

`arc` is valid only when the ship has non-zero physical `routeSpeed`. A zero-speed hazard must use `pivot`; once the safe heading is reached and recovery releases authority, the existing autonomous no-route acceleration resumes from zero. Prediction must never label a zero-translation maneuver as a moving arc.

## LR-06 — Fixed-step ownership

`LandRecoverySystem` runs in the existing `SimulationScheduler.hazards()` phase, before ship movement.

It may decide/start/finish land recovery by calling semantic `ShipModel` methods. `ShipMotor` remains the sole movement authority and performs the actual turn/movement at fixed 60 Hz.

## LR-07 — Snapshot determinism

Any active land recovery state required to continue the same turn after capture/restore is serialized in `ShipModelSnapshot`.

No RNG is used for recovery direction or candidate choice.
