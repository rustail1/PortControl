# PORT CONTROL — RELEASE RUNBOOK v1.5

Status: **AUTHORITATIVE RELEASE OPERATIONS CONTRACT**. This runbook governs the path from a code-complete repository to a Yandex Games Release Candidate. It does not override gameplay rules in the Complete Design Bible or machine values in Baseline Source.

## 1. Version identities
- Design package: `v1.5`.
- First public game release: `1.0.0`.
- Save schema: `schemaVersion=1` until a migration is intentionally introduced.
- Every production build exposes `buildVersion` and git commit/hash to analytics/debug diagnostics.

## 2. Required package.json scripts
Codex must provide these stable scripts before RC:
- `npm run dev` — local Vite development with LocalPlatformAdapter.
- `npm run dev:editor` — dev/editor build only; Level Editor and write bridge enabled.
- `npm run build` — production Yandex build; editor/writer/debug authoring routes stripped.
- `npm run preview` — serve the built `dist/` locally.
- `npm run lint` — ESLint.
- `npm run test` — Vitest/unit+deterministic simulation tests.
- `npm run test:e2e` — Playwright browser smoke.
- `npm run validate:all` — JSON schema + semantic + localization + asset preflight + 40-level manifest/round-trip checks available at the current phase.

## 3. Production build flags
Production build uses the semantic equivalent of:
- `VITE_PLATFORM=yandex`
- `VITE_BUILD_MODE=production`
- `VITE_EDITOR=0`
- source maps OFF in the distributable production artifact unless temporarily required for a controlled diagnostic build.

No secret, API key, local filesystem path or dev writer endpoint may be embedded in `dist/`.

## 4. RC build command order
From a clean checkout:
1. `npm ci`
2. copy/verify `Port_Control_Baseline_Source_FINAL_v1.5` into the repository-defined config source paths exactly once; do not regenerate the 40 levels.
3. `npm run validate:all`
4. `npm run lint`
5. `npm run test`
6. `npm run test:e2e`
7. `npm run build`
8. serve `dist/` and run the production smoke matrix.
9. verify the build contains no editor route, dev save bridge, authoring UI, placeholder required assets, uncaught console errors or missing localization keys.

## 5. Production feature flags — Release 1.0.0
`platform.json` is authoritative:
- Campaign 40 levels: ON.
- Endless: ON after Level 40.
- Daily/Weekly player-facing surface: OFF at first public release; framework may exist behind the flag.
- Leaderboards: OFF at first public release; `leaderboardKey` is reserved only.
- IAP: OFF.
- Sticky banner: OFF.
- Auth CTA: ON only after `calm_03`, only in Port Meta and Settings, never automatic.
- Guest play: always allowed.
- Local save: always enabled.
- Authorized cloud save: best-effort; cloud failure never blocks gameplay.

A limited validation/soft-launch build may expose only the first 30 campaign levels, but that build is **not** called Release 1.0.0. Final public 1.0.0 requires all 40 campaign levels enabled and validated.

## 6. Yandex lifecycle release smoke
Verify in a production-like build:
- SDK loads before initialization.
- Game Ready is sent only when interactive.
- Gameplay start/stop is paired correctly for level start/end, pause, focus loss and ads.
- platform pause immediately freezes simulation and audio; resume cannot bypass a manual pause menu.
- rewarded reward is granted only on the confirmed rewarded callback.
- interstitial is requested only at a logical level break and never while traffic interaction is active.
- unavailable/cancelled/error ad paths return to a usable game state with no reward and no soft-lock.
- guest launch works with no auth prompt.

## 7. Save/reward release smoke
- Validate local and cloud payloads against `profile.schema.json` before use.
- Invalid/corrupt source is ignored and logged; if no valid source exists, use the default profile.
- Conflict: higher revision wins; equal revision → newer `updatedAt`; never sum Coins.
- A critical mutation writes local state first, then attempts cloud best-effort.
- `grantLedger` blocks duplicate result/rewarded grants after repeated callback, reconnect, reload and cloud conflict.
- Cloud/auth/network failure must not erase the valid local profile.

## 8. Content/art/audio gates
Before RC:
- 40/40 levels pass schema + semantic validation + Editor canonical round-trip + 50-seed runtime fairness.
- `validate_assets.py --release` passes for all required visual **and audio** assets.
- all `requiredForRelease=true` visual/audio entries are `production` and physically exist.
- final UI font is self-hosted/licensed by the project or the documented fallback stack is deliberately accepted; do not rely on an uncontrolled third-party font request at runtime.
- RU/EN exact localization parity passes.

## 9. Device/performance RC gate
Run the QA matrix on desktop Chrome/Edge/Yandex Browser, small+large Android, and supported iOS Safari/WebView in both required orientations. Sustained gameplay target: 60 FPS, release floor ≥45 FPS on the selected mid-range mobile class. Validate ad return, resize, orientation, background/foreground, network loss and reload.

## 10. Commercial gates before scale
The build can become an RC only after technical QA, but expensive polish/marketing scale follows `COMMERCIAL_HIT_VALIDATION_PLAN_FINAL_v1.5.md`: 10-player Core Feel test, 50-seed fairness, mandatory economy test, store creative comprehension test, then a 20–50 user soft launch. Failed gates create targeted v2 hypotheses; they do not authorize silent redesign by Codex.

## 11. Store submission
The commercial name, icon and thumbnail winner are selected through the commercial validation gate. `Port Control` remains a working title until naming/trademark/store clearance. Code must use localization/config for the display title so a cleared name change does not require gameplay rewrites.

Submission package includes the production `dist/`, required store creatives, RU/EN descriptions, age/content declarations and the current Yandex moderation checklist. Re-run the smoke test on the uploaded build, not only the local ZIP.

## 12. Rollback / hotfix
Retain the previous accepted production artifact and its build/hash. A hotfix may change code/config only with the relevant regression tests. Any change to game rules/balance/layout after the frozen baseline is recorded as an explicit v2 change with hypothesis and rollback criterion. Save-schema changes require a deterministic idempotent migration before release.

## FINAL RELEASE RULE
A build may be labeled `1.0.0 RC` only when QA sign-off has zero Blocker/Critical/Major release defects, all required production assets/audio exist, 40 levels pass the full content gate, editor tooling is absent from production, save/reward/ad lifecycle tests pass, and Yandex production smoke passes.
