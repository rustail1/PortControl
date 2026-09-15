# Port Control Architecture Repair Decisions v1.6

Status: OWNER APPROVED for architecture repair. Frozen Baseline v1.5 remains unchanged.

## AR-00 authority decisions

### Route semantics
- Authoritative gameplay navigation follows the exact authored polyline.
- Physics may change speed/time and hull rotation, but must not rewrite route geometry or cut authored corners.
- Runtime must not apply RDP/spline smoothing or waypoint-based corner cutting.
- `simplifyEpsilon`, `maxSimplifiedPoints`, and `waypointTolerance` remain frozen legacy config keys until a separate baseline migration, but are not authoritative runtime behavior.

### Grounding
- Grounding forbidden land/channel is a terminal gameplay failure.
- Clamp/turn-away/automatic recovery is not authoritative grounding behavior.

### Test tooling
- Repository test runner is `node:test` executed through `tsx`, with Playwright for browser gates.
- Vitest is not part of the current runtime/test contract.

## Architecture ownership
- `ShipModel` owns ship state and exposes semantic lifecycle transitions.
- `GameSession` owns session state/result.
- Fixed-step ordering belongs to `SimulationScheduler`.
- Systems return authoritative facts/results; presentation events are projections after acceptance.
- Platform adapters own browser/platform lifecycle signals.
- `HarborRuntime` is composition/input/presentation facade, not a game-rules owner.
