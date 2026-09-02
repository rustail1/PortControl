# PORT CONTROL — COMMERCIAL HIT VALIDATION PLAN v1.5

Purpose: maximize the probability of a commercially successful Yandex/web release without pretending that design documentation can guarantee a hit. These are evidence gates; they do not authorize Codex to redesign the game silently.

## Gate 0 — before expensive polish
Use greybox/placeholder art. Test the frozen Harbor core with 10 fresh players on real mouse + touch devices. PASS only if at least 8/10 can draw the first route without explanation, 8/10 complete first dock within 30 seconds, and at least 6/10 voluntarily start a second run. Collect failure video and route/collision analytics. If this fails, fix Core Feel/FTUE before meta/art scale-up.

## Gate 1 — deterministic fairness
For every campaign level and any tested balance variant, run 50 deterministic seeds. PASS: 0 impossible seeds; no spawn begins in unavoidable collision; all required docks reachable with configured turn rates; objective/star conditions remain mechanically achievable.

## Gate 2 — mandatory economy access
Deep-Water Berth = 900 fixed; Oil Safety Dock = 1800 fixed. Test full progression with simulated first-clear rewards plus real human spending. PASS: 0 hard-blocked users and p90 requires no more than 2 ordinary replays for a mandatory access node. Optional upgrades may create choices but may not strand campaign progression.

## Gate 3 — visual/store comprehension
Create at least 3 original title/icon/thumbnail compositions and 2 gameplay screenshots. Blind test: player should understand “draw routes / manage a busy harbor” from the store creative without Harbor Master branding or explanation. Choose creative by comparative CTR/intent test, not by taste.

## Gate 4 — 20–50 user soft launch
Instrument the real Yandex-like build. Starting decision gates (internal hypotheses, not universal benchmarks): first route ≥90%, first dock ≥85%, Level 1 completion ≥70%, >3 minute conversion ≥60%, D1 ≥20%, D7 ≥7%, crash-free ≥99.5%. Diagnose by fail_reason, device, orientation, level, traffic pressure and route metrics before changing design.

## Gate 5 — monetization guardrails
Rewarded Rewind and x2 Coins remain opt-in. Interstitial only at logical level breaks with the configured cadence. Test offer acceptance and return-to-game integrity. Guardrails: no ad during active traffic; no duplicate reward; no meaningful rise in level abandon after ad; no forced ad required for campaign progress.

## Ten commercial pre-mortem risks
| Risk | Likelihood | Impact | Cheapest falsification test |
|---|---|---|---|
| Core feels like work, not satisfying traffic control | High | Critical | 10-player second-run test |
| Touch route drawing is frustrating/occluded | High | Critical | 5–10 real-phone sessions |
| Dense seeds feel unfair | Medium | Critical | 50-seed suite + replay video |
| Meta growth feels cosmetic/weak | Medium | High | Stage I→IV screenshot blind test + upgrade-choice interview |
| Mandatory economy feels grindy | Medium | High | full progression simulation + 20-user spend cohort |
| Visuals look derivative or unreadable | Medium | High | blind screenshot + 50%-scale/grayscale test |
| FTUE loses players before first success | High | High | first 60-second funnel |
| Ads interrupt flow and hurt retention | Medium | High | ad/no-ad cohort at logical breaks |
| Mobile performance causes input/focus failures | Medium | High | low/mid Android + iOS device matrix |
| Store creative does not communicate the promise | High | High | 3-way thumbnail/title preference/CTR test |

## Decision rule
Do not add features to “fix” a weak metric before identifying the failing step. Prefer the smallest reversible v2 change. If core comprehension/second-run intent fails after two focused feel iterations, stop or reposition before producing more ports/art/LiveOps. If gates pass, do not keep redesigning the game just because more ideas exist.
