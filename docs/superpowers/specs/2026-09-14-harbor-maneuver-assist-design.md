# Harbor Maneuver Assist Design

Status: OWNER APPROVED in chat on 2026-09-14.

## Goal
Replace fixed-duration docking/departure snap animation with deterministic ship-specific harbor maneuver physics, fix route-line consumption so no line remains behind a moving vessel, and make a post-swipe non-moving ship visibly distinguish committed/pivot/rejected outcomes.

## Authority
- Existing Architecture Repair v1.6 remains authoritative for exact authored route geometry.
- Frozen Baseline v1.5 remains unchanged.
- Owner-approved v2 feel change overrides the legacy semantic 350ms snap behavior for docking/departure only. `baseSnapDurationMs` remains a legacy config field and is no longer movement authority.

## Harbor maneuver contract
1. Normal navigation owns the ship until it enters a compatible free dock's approach zone.
2. Dock reservation transitions `Navigating -> ApproachingDock` and starts automatic assist.
3. A deterministic `HarborManeuverMotor` moves along a lane derived from `approachPoint -> alignmentPoint -> berthPoint`.
4. Position follows lane geometry exactly. Hull heading is turn-rate limited and may lag lane tangent.
5. Speed is ship-specific and acceleration-limited. Harbor target speeds are fractions of ship cruise speed: approach <= 60%, alignment <= 40%, final creep <= 15%.
6. Arrival lock is allowed only inside tiny position/heading/speed tolerances; final numerical snap is invisible and only corrects floating-point residue.
7. Departure is the mirrored assisted maneuver `berth -> alignment -> release`, starts from zero, accelerates according to the ship, and hands its current speed to normal route motion at release.
8. No fixed-time tween, Bezier-time animation, or instantaneous cruise-speed handoff remains in production docking/departure movement.
9. Snapshot/restore includes enough maneuver state for deterministic continuation.

## Route rendering contract
- Static tail: authored future points from the current segment endpoint onward. Redraw only on route revision, route cursor, or selection changes.
- Dynamic head: one presentation segment from the vessel's current rendered position to the current segment endpoint. Update every render frame.
- No authored route segment may remain visibly behind a vessel inside the current segment.

## Swipe outcome contract
A released gesture must surface one of three distinguishable outcomes:
- `committed`: route remains and motion begins/continues.
- `pivot`: route remains while the hull visibly rotates before translation.
- `rejected_*`: invalid/short/locked route is surfaced to presentation as a rejection pulse; it must not look like a silent stall.

## Non-goals
- No route smoothing.
- No manual berth parking.
- No Frozen Baseline geometry changes.
- No hazard/current/storm work.
- No new economy/meta/UI systems.
