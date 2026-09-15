# Port Control Harbor Maneuver Assist Decisions v1.8

Status: OWNER APPROVED 2026-09-14. Frozen Baseline v1.5 remains unchanged.

## Authority delta
This document supersedes only the legacy fixed-duration dock/departure snap feel. All Architecture Repair v1.6 route, grounding, state ownership, scheduler, and Frozen Baseline decisions remain in force.

## Docking/departure
- `balance.json.docking.baseSnapDurationMs` is retained as a Frozen legacy field but is not runtime movement authority.
- Compatible free dock capture occurs at the derived water-side approach zone.
- After capture, automatic harbor assist owns movement until berth lock.
- Harbor assist uses ship `speed` and `turnRateDeg`; heavy ships must take materially longer than light ships.
- Position follows deterministic lane geometry; hull rotation is turn-rate limited.
- Dock completion requires near-zero maneuver speed and final dock heading; final exact pose correction is numerical only.
- Departure begins at zero maneuver speed, accelerates along berth/alignment/release lane, and hands current non-zero sub-cruise speed to normal ShipMotor.
- Fixed 350ms tween, Bezier-time snap, linear fixed-duration departure, and instant full-cruise handoff are forbidden.

## Route presentation
- Static future route tail may be dirty-rendered by route revision/cursor.
- Dynamic route head must be redrawn from rendered vessel position to current authored waypoint every frame so no route remains visible behind the ship.

## Swipe outcome feedback
- Released rejected route commands must produce short presentation-only feedback.
- Reverse/large-angle committed routes retain their route and visibly report TURN while ShipMotor pivots.
- Presentation feedback must not mutate authoritative simulation.
