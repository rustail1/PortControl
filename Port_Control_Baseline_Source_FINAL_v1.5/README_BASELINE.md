# Port Control — Baseline Source v1.5

Status: **PRODUCTION CONTRACT COMPLETE / ITERATION v1**
Date: 2026-09-03

This package is the hardened machine source produced after the final deep-research red-team audit. It does not promise market success; it removes implementation ambiguity before production.

## Included
- 40 frozen campaign level JSON files.
- Strict core configs for ships, balance, ports, upgrades, perks, challenges, modes, meta layouts, editor registry, assets, audio, platform release flags, screen flow, analytics and RU/EN localization.
- **20 JSON Schemas** including strict balance/profile/effect contracts, localization-key and semantic-manifest contracts.
- `profile.default.json` as the exact save-profile fixture.
- `levels.semantic_manifest.json` as the canonical 40-level semantic hash baseline.
- Validation tools for schema/cross-reference/geometry/i18n/semantic round-trip/asset release checks.

## Frozen hardening decisions
1. Any source conflict **BLOCKS implementation** until the package is corrected. No document may tell Codex to choose a winner silently.
2. World convention: `(0,0)` top-left; +X right; +Y down; `0°=+X`; positive rotation clockwise; normalize `[0,360)`; polygon winding visual-clockwise.
3. Editor default snap: 10 logical units; rotation 15°; coarse rotation 90°. One drag = one undo transaction.
4. Mandatory access gates never use port cost multipliers: Deep-Water Berth = 900; Oil Safety Dock = 1800.
5. RU/EN key sets are exact and schema-enforced.
6. Asset catalog is a target production manifest. `planned` is allowed before art delivery; Release Candidate requires `production` status and physical files.
7. Events are explicitly OFF in Release 1.0 (`events=[]`). New event payloads require a versioned post-launch contract.
8. Screen flow is machine-closed: first-launch action matches Menu→calm_01; Settings returns to its owner; Perk Choice returns to PortMeta after persistence; Campaign Complete has Endless/Port exits; Endless Result owns the one-per-run rewarded rewind return.

- Campaign fail/pause restart reuses the same attempt seed; completed-level replay and new Endless run use a new crypto seed.
- Post-movement terminal arbitration: ship collision → grounding → dock → cargo → exit → objective.
- Cargo generation, dock reservation, spawn retry, economy rounding and presentation timing are machine-backed in `balance.json`.
- Port visual stages use `afterLevel + minOwnedUpgrades + requiredUpgrades` from `ports.json`.
- Player-facing Daily/Weekly, leaderboard, IAP and sticky banner are OFF in first public Release 1.0; Auth CTA is explicit after calm_03 only.

## Mandatory validation
```bash
python tools/validate_baseline.py .
python tools/validate_localization.py .
python tools/semantic_roundtrip.py .
python tools/validate_assets.py .
```
After production art delivery:
```bash
python tools/validate_assets.py . --release
```
After Level Editor implementation, CI adds the runtime semantic comparator: imported/saved JSON and instantiated gameplay snapshot must match the frozen baseline.

## Evidence policy
Human Core Feel, 50-seed fairness, mobile touch usability, economy pacing, retention and ad acceptance are **runtime evidence gates**, not missing first-pass design. A failed gate creates a controlled Iteration v2 change; a passing gate leaves v1 unchanged.
