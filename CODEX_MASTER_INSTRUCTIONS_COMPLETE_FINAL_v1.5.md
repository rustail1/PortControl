# PORT CONTROL — CODEX MASTER INSTRUCTIONS v1.5

Status: **PRODUCTION CONTRACT COMPLETE / ITERATION v1**

## 1. Non-negotiable authority policy
1. Semantic behavior/state transitions: `Port_Control_COMPLETE_DESIGN_BIBLE_FINAL_v1.5.docx`.
2. Exact machine-backed simulation/economy/content balance values, IDs, geometry and payloads: `Port_Control_Baseline_Source_FINAL_v1.5/`. If an exact UX/flow timing is intentionally semantic and has no machine field, the Complete Design Bible controls it.
3. Visual language: `Port_Control_VISUAL_STYLE_FRAME_FINAL_v1.5.docx`; asset inventory/delivery: `Port_Control_ART_UI_ASSET_LIST_FINAL_v1.5.docx` + `assets.catalog.json`.
4. Implementation order/dependencies: `Port_Control_DEV_BACKLOG_FEATURE_LIST_FINAL_v1.5.docx`.
5. Release acceptance: `Port_Control_QA_RELEASE_CHECKLIST_FINAL_v1.5.docx`.
6. Release build/submission/rollback operations: `RELEASE_RUNBOOK_COMPLETE_FINAL_v1.5.md`.
7. Product/change methodology: `PRODUCT_DESIGN_AUDIT_RULES_FINAL_v1.5.md` is a review checklist only; it cannot override the Design Bible or machine baseline. Roblox-specific implementation references are non-authoritative.
8. **ANY TRUE CONFLICT BLOCKS THE TASK.** Do not choose a source, average values, invent a compromise or silently “fix” design. Report the exact conflict and stop that task.

## 2. Repository bootstrap
Copy Baseline Source v1.5 unchanged before FND-02. Do not regenerate the 40 levels. Run:
```bash
python tools/validate_baseline.py .
python tools/validate_localization.py .
python tools/semantic_roundtrip.py .
python tools/validate_assets.py .
```
All must PASS before gameplay feature work merges.

## 3. Architecture invariants
- Phaser 4.2.1 pinned, TypeScript strict, Vite/ESM.
- Fixed simulation 60 Hz; render FPS never changes gameplay outcome.
- Seeded RNG only; no `Math.random()` in simulation.
- No God Manager/global service locator/runtime-wide Find.
- No Yandex SDK imports in gameplay/domain/editor code.
- `IPlatformAdapter` owns init, ready, gameplay lifecycle, ads, profile I/O, analytics and typed pause/resume subscriptions.
- Machine-backed simulation/economy/content balance values stay in JSON; no duplicated magic numbers in TS. Semantic UX/flow timings that intentionally exist only in the Complete Design Bible are implemented from the cited Design Bible contract.
- Editor and Campaign instantiate the same `LevelDefinition` through the same runtime factories.
- Level-specific TypeScript layout code is forbidden.
- Active ship positions are simulation-owned; Phaser tweens may not own navigation.

## 4. Exact editor convention
`(0,0)=top-left`, +X right, +Y down, `0°=+X/right`, positive rotation clockwise, normalize `[0,360)`. Default grid=10, rotation snap=15°, coarse=90°. Polygon winding = visual clockwise. Polygon/path points are absolute. One drag = one undo transaction. Duplicate/Paste = fresh IDs.

## 5. Machine and semantic gates
- Strict JSON Schema is necessary but not sufficient. Semantic validators are mandatory.
- Director: startInterval >= minimumInterval; burstMax >= burstMin; breathMax >= breathMin.
- Unique block IDs; positive weights; valid rect extents; non-zero, non-self-intersecting visual-clockwise polygons.
- Exact RU/EN key parity.
- Mandatory access upgrades must be fixed-price/no port multiplier.
- 40 level hashes must match `levels.semantic_manifest.json` before intentional v2 changes.
- After Editor implementation: A→Editor→B must have canonical JSON equality and runtime snapshot equality.

## 6. Save/reward idempotency
Implement PlayerProfile exactly from `profile.schema.json`. `grantLedger` (max 64 stable claim IDs) makes rewarded/result grants idempotent across repeated callback, reconnect, reload and cloud conflict. Never sum currencies while resolving saves.

## 7. Asset delivery
`assets.catalog.json` v2 is the machine manifest. `planned`/`placeholder` is valid during development. RC requires every `requiredForRelease=true` item to be `production` and physically present. Do not satisfy release with placeholder art.

## 8. Deterministic edge-case rule
Input is single-owner for gameplay drawing. Simultaneous post-movement resolution follows `balance.simulation.postMovementPriority`. Collision/grounding terminal failures beat dock/cargo/exit/objective progression in the same fixed step. Dock reservation, cargo generation, run-seed policy, wrong-dock counting and spawn safety are implemented exactly from Complete Design Bible sections 22–23 + Baseline Source.

## 9. Baseline content rule
EDT/CNT tasks mean **import → validate → round-trip → Playtest → 50-seed QA**, not re-author. No balance/layout/visual redesign during Iteration v1 unless a blocking contradiction/bug is documented.

## 10. Required task template
Every task must contain: Task ID, Goal, Authority sections/files, Allowed files, Dependencies, Required behavior/state transitions, Analytics impact, Acceptance criteria, Tests, Non-goals, BLOCKED IF conditions. Completion report: files changed, tests executed, validation outputs, acceptance status, blockers, confirmation of no undocumented design change.

## 11. Evidence-driven Iteration v2
A failed runtime/commercial gate may create v2 only as: Signal → Problem → Hypothesis → Exact change → Primary metric → Guardrails → Test → Keep/Rollback. Passing gates mean do not tune by taste.

## 12. Release path
Foundation → Core → COR-12 Core Feel Gate → deterministic edge-case suite → Editor → 40-level semantic round-trip → UX/Meta/Save/Rewind → 50-seed campaign QA → production art/audio → analytics → Yandex/Ads/auth/cloud → device/regression QA → Endless → RC runbook → Yandex moderation.

This package maximizes implementation clarity; it does not guarantee a hit or revenue. Commercial validation gates in `COMMERCIAL_HIT_VALIDATION_PLAN_FINAL_v1.5.md` determine whether to scale polish/marketing or iterate.
