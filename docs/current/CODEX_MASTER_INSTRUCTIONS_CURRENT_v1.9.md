# PORT CONTROL — CODEX MASTER INSTRUCTIONS CURRENT v1.9

Status: **CURRENT DEVELOPMENT CONTRACT / CORE v1.9**

## 1. Authority order
1. Gameplay semantics and player-facing state transitions: `docs/current/Port_Control_COMPLETE_DESIGN_BIBLE_CURRENT_v1.9.docx`.
2. Exact implemented Core invariants and supersession of stale v1.5 Core clauses: `docs/current/CORE_RUNTIME_CONTRACT_CURRENT_v1.9.md`.
3. Exact machine-backed values, IDs, level geometry and payloads: `Port_Control_Baseline_Source_FINAL_v1.5/` (**FROZEN; never edit without owner permission**).
4. Current visual language: `docs/current/Port_Control_VISUAL_STYLE_FRAME_CURRENT_v1.9.docx` plus legacy asset inventory where unchanged.
5. Implementation order: `docs/current/Port_Control_DEV_BACKLOG_CURRENT_v1.9.docx`.
6. Acceptance/release QA: `docs/current/Port_Control_QA_RELEASE_CHECKLIST_CURRENT_v1.9.docx`.
7. Release operations: `docs/current/RELEASE_RUNBOOK_CURRENT_v1.9.md`.
8. Historical v1.5 docs and old superpowers plans/specs are evidence/history only when they conflict with current v1.9 docs.

A true conflict inside the current authority set means BLOCKED. Do not silently choose a compromise.

## 2. Architecture invariants
- Phaser 4.2.1, strict TypeScript, Vite/ESM.
- Fixed simulation 60 Hz; render never owns gameplay state.
- Seeded RNG only; no `Math.random()` in simulation.
- Exact authored route polyline; no RDP/waypoint-tolerance runtime rewrite.
- `ShipModel` owns ship state; `ShipMotor` owns normal route/free-water movement; `DockingController + HarborManeuverMotor` own held harbor maneuver; `SimulationScheduler` owns phase order.
- Predictive `LandRecoverySystem` runs before movement; `GroundingSystem` is terminal fallback on actual contact.
- No active-ship Phaser tween authority.
- No Yandex SDK import in gameplay/domain/editor code; use `IPlatformAdapter`.
- No level-specific TS layouts.

## 3. Current Core quick rules
Read `CORE_RUNTIME_CONTRACT_CURRENT_v1.9.md` before touching route/input/movement/dock/cargo/exit/collision/grounding/presentation Core.

Key non-negotiables:
- min ship input hit radius 32 CSS px;
- absolute pointer-authored route points with a first-sample guard for delayed fast/moving small ships;
- explicit `reorientation` vs `authored_reversal` TURN;
- route end continues forward for normal autonomous states;
- harbor assist is physics-driven, not fixed 350 ms snap;
- land is proactively avoided before contact; actual grounding remains terminal fallback;
- selection pulse disappears after animation; `ReadyToLeave` emits double one-shot pulse;
- default dev launch is `calm_01`.

## 4. Workflow
- Work only on `main`; no branches/PR unless owner says otherwise.
- For bugfix: FACT -> EVIDENCE -> ROOT CAUSE -> RED -> minimal patch -> focused GREEN -> full delivery gate.
- Never weaken a correct test to get GREEN; update a stale test only when current authority explicitly supersedes its old contract.
- Frozen Baseline remains byte-identical.
- During development use focused tests; before delivery run: `npm.cmd ci`, `npm.cmd test`, `npm.cmd run typecheck`, `npm.cmd run build`, `npm.cmd run test:browser`, plus validators/checksums.
- Human Feel is a separate owner gate.

## 5. Current phase
Foundation/Core implementation is substantially complete through v19 pointer-WYSIWYG stabilization. The next planned product phase is Level Editor (`EDT-01` onward) **only after owner accepts final Core Human Feel**.

## 6. Delivery integrity
- Legacy `PACKAGE_CHECKSUMS.sha256` protects the original v1.5 handoff/frozen package and must remain unchanged.
- `DELIVERY_CHECKSUMS.sha256` protects mutable current `src/test/docs/scripts` + root runtime files. Verify with `npm run verify:delivery`.

## 7. Known future design blocker
- `Quick Mooring I–II` / `FAST_MOORING` still has legacy fixed-snap-duration semantics in the frozen v1.5 data/design history. Do not implement it in META/PERK code until the owner explicitly maps it to physics-driven Harbor Assist.
