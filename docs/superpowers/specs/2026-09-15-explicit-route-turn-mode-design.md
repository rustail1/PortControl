# Port Control — Explicit Route Turn Mode Design

Date: 2026-09-15
Status: implemented / automatic verification complete where environment permits
Base package: PortControl_v1.8_ROUTE_TURN_LEVEL1_FIX_v8_2026-09-15

## 1. Goal

Remove the `routePivotProgress` heuristic that currently guesses whether a TURN is:

1. a player-route reorientation after a newly committed/live-updated route, or
2. an authored reversal corner already present inside the exact polyline.

The runtime must represent that distinction explicitly so the two behaviors cannot be confused when TURN begins at non-zero `routeProgress`.

## 2. Product contract

### Route reorientation

When the current authored tangent is more than 90 degrees away from the hull heading:

- the ship enters visible `TURN`/reorientation state;
- the ship rotates at its real `turnRateDeg`;
- while the route tangent remains behind the hull's forward half-plane, the ship does **not** advance route progress;
- when heading error reaches 90 degrees or less, the same TURN can release and normal route movement resumes;
- movement after release remains exactly on the authored polyline;
- the ship must never move backward along its hull-forward axis merely to avoid a stationary TURN.

This is the selected physical model (option A): honest turn-in-place before forward route motion.

### Authored reversal corner

When the ship reaches an authored route corner whose turn angle qualifies as a reversal:

- the ship stops exactly on the authored corner marker;
- the hull turns at `turnRateDeg`;
- route progress remains fixed at the corner until the stricter reversal release threshold is met;
- after release, movement continues on the same exact authored polyline.

This behavior remains distinct from input reorientation.

## 3. State model

Add an explicit runtime discriminator owned by `ShipModel`:

```ts
export const RouteTurnMode = {
  Reorientation: 'reorientation',
  AuthoredReversal: 'authored_reversal',
} as const;

export type RouteTurnMode = (typeof RouteTurnMode)[keyof typeof RouteTurnMode];
```

`ShipModel` owns:

- `routePivotProgress: number | null` — exact authored progress where TURN began / is anchored;
- `routeTurnMode: RouteTurnMode | null` — why TURN exists.

Invariant: `routePivotProgress` and `routeTurnMode` are either both present or both absent.

API becomes explicit:

```ts
beginRouteTurn(mode: RouteTurnMode, progress: number): void
finishRouteTurn(): void
```

The old `beginRoutePivot(progress)` / `finishRoutePivot()` API is removed rather than retained as an ambiguous wrapper.

## 4. ShipMotor behavior

`ShipMotor` must never infer TURN meaning from progress relationships.

### If `routeTurnMode === 'reorientation'`

1. Rotate hull toward the current route tangent by at most `turnRateDeg * dt`.
2. Keep `routeSpeed = 0` and `routeProgress` unchanged while heading error is `> 90°`.
3. Once heading error is `<= 90°`, finish the explicit reorientation TURN.
4. Normal route-speed acceleration can resume on the following/remaining step without changing route geometry.

### If `routeTurnMode === 'authored_reversal'`

1. Rotate hull toward the outgoing tangent by at most `turnRateDeg * dt`.
2. Keep position exactly at `route.pointAtDistance(routePivotProgress)`.
3. Keep `routeSpeed = 0`.
4. Release only at the existing strict reversal threshold (`REVERSAL_PIVOT_RELEASE_ERROR_DEG`).

### Creating TURN

- Initial/new-route heading mismatch `> 90°` creates `Reorientation`.
- Reaching a qualifying authored reversal corner creates `AuthoredReversal`.
- No condition may derive mode from whether `routeProgress` is equal to / greater than `routePivotProgress`.

## 5. Snapshot and restore contract

`ShipModelSnapshot` adds optional `routeTurnMode`.

When a TURN is active, snapshots contain both:

```ts
{
  routePivotProgress: number,
  routeTurnMode: 'reorientation' | 'authored_reversal'
}
```

Constructor/restore validation rejects inconsistent snapshots:

- mode without pivot progress;
- pivot progress without mode;
- unknown mode.

Port Control runtime snapshots are internal deterministic state, not long-term player-profile save data, so v8 snapshots with an ambiguous pivot but no mode are not silently guessed. Failing fast is safer than reintroducing the same heuristic as a migration path.

## 6. Presentation contract

Presentation may continue to display `TURN` whenever a route turn is active. It does not need to know the turn mode to move gameplay.

If useful for debug/Human Feel labels, `routeTurnMode` may be exposed in the presentation snapshot, but presentation must not decide release conditions or movement.

## 7. Unchanged boundaries

This change does **not** modify:

- Frozen Baseline data;
- exact authored route points or route simplification policy;
- harbor maneuver geometry;
- departure assist geometry;
- collision rules;
- ship `speed` or `turnRateDeg` balance;
- Level 1 default selection already fixed in v8;
- route rendering contracts unless a regression test proves a direct dependency.

## 8. Tests (TDD)

Before production code, add RED tests proving the current heuristic is wrong and the explicit state is required.

Required cases:

1. New reverse route at `routeProgress = 0` enters `reorientation`, remains stationary while error >90°, then resumes exact-polyline movement.
2. Live-route reorientation beginning at non-zero progress remains `reorientation`; it must never convert into an authored reversal because progress changes.
3. Authored 180° corner enters `authored_reversal`, stays exactly on corner progress, and uses the strict reversal release threshold.
4. Snapshot round-trip preserves both turn modes exactly.
5. Invalid snapshot combinations are rejected.
6. Existing 90° corner does not become a stationary reversal.
7. Exact authored polyline invariant remains true for speedboat/cargo/freighter/tanker.
8. Existing departure/harbor focused regressions remain green.

## 9. Acceptance criteria

The change is accepted only when:

- no `isRouteReorientation = progress...` heuristic remains in production code;
- mode selection happens only at the event that creates the TURN;
- reverse player route visibly turns in place rather than creeping backward;
- once heading error is <=90°, forward exact-polyline movement resumes;
- authored 180° corners retain their stricter stationary pivot behavior;
- snapshot restore is deterministic and explicit;
- focused route + harbor/departure regression suite is green;
- Frozen Baseline checksums remain unchanged;
- Owner Human Feel still remains a separate manual gate.
