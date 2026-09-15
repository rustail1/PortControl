# PORT CONTROL — CURRENT DOCUMENT CASCADE AUDIT v1.9

Status: **PASS WITH ONE EXPLICIT FUTURE DESIGN BLOCKER**
Date: 2026-09-15

## Scope
Compared current v19 runtime/tests against the legacy v1.5 semantic cascade. Frozen Baseline was not modified.

## Divergences corrected in current cascade
- Removed RDP/waypoint-tolerance route authority; exact authored sampled polyline is current.
- Documented 32 CSS px minimum ship-selection radius plus absolute pointer-authored WYSIWYG route input with a delayed first-sample guard for moving small ships.
- Documented explicit `reorientation` vs `authored_reversal` TURN modes and snapshot contract.
- Documented autonomous continuation after committed route end.
- Replaced fixed 350 ms dock/departure snap semantics with physics-driven Harbor Assist, final creep and sub-cruise release handoff.
- Documented static-tail + dynamic-head route rendering and correct harbor/departure visibility.
- Documented proactive LandRecovery before contact, zero-speed pivot fallback, deferred-route rebase and terminal grounding only on actual forbidden contact.
- Documented one-shot disappearing selection pulse and one double pulse on `Unloading -> ReadyToLeave`.
- Documented default dev level `calm_01` and `calm_07` as island regression.
- Updated scheduler order to include LandRecovery in hazards before movement.
- Updated backlog/QA gates to test the implemented Core rather than legacy snap/simplifier behavior.

## Historical docs retained
Root `*_FINAL_v1.5` files and older superpowers plans/specs remain intact for provenance and legacy package checksum. They are not the current semantic authority.

## Explicit unresolved future blocker
`Quick Mooring I–II` / `FAST_MOORING` still has legacy v1.5 wording based on reducing fixed dock snap duration. Current Core deliberately has no fixed-duration snap authority. **Do not implement this future upgrade/perk until the owner explicitly chooses how it maps to physics-driven Harbor Assist** (for example acceleration/speed/assist efficiency). Current docs mark this BLOCKED rather than inventing a mapping.

## Current next phase
After owner Core Human Feel sign-off, proceed to `EDT-01` Level Editor. Core should only reopen for evidence-backed defects.
