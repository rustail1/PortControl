# PORT CONTROL — RELEASE / DELIVERY RUNBOOK CURRENT v1.9

Status: **CURRENT OPERATIONS CONTRACT**

## Development delivery gate
From the current project root on Windows:
1. `npm.cmd ci`
2. `npm.cmd test`
3. `npm.cmd run typecheck`
4. `npm.cmd run build`
5. `npm.cmd run test:browser`
6. `npm.cmd run verify:delivery`
7. Run the four Frozen Baseline validators from `Port_Control_Baseline_Source_FINAL_v1.5/`.
8. Owner Human Feel for the touched behavior.

Do not call a Core delivery complete if automatic gates are unavailable/blocked; report the environment blocker separately.

## Core Human Feel minimum
- `calm_01` is default launch.
- Straight/side drags on speedboat/cargo are easy to select and never create a false reverse first segment.
- Reverse route (>90 degrees) visibly TURNs in place then resumes exact authored line.
- Route end continues forward; ship does not freeze just because the line ended.
- Docking uses physical approach/alignment/final creep; departure starts from 0 and releases at non-zero sub-cruise speed without stop/full-speed snap.
- Route line is consumed behind the ship and departure preview does not cut the harbor lane.
- `calm_07`: autonomous ship approaches island and recovers before contact; no normal grounding fail.
- Selection pulse is smooth and disappears; `ReadyToLeave` emits one double-pulse sequence.

## Release 1.0 later-stage gates
Legacy v1.5 Yandex/save/ads/assets/40-level gates remain valid unless explicitly superseded by a later current document. Before RC, use the current QA checklist and ensure Editor + 40-level round-trip + platform/monetization gates are implemented.
