# PORT CONTROL — START HERE COMPLETE FINAL v1.5

Status: **COMPLETE DESIGN + MACHINE CONTRACT + PRODUCTION HANDOFF**

For development, use only this complete package. Older project packs are superseded for handoff purposes.

## Read in this order
1. `PACKAGE_MANIFEST_COMPLETE_FINAL_v1.5.md`
2. `FINAL_AUDIT_REPORT_FINAL_v1.5.md` (audit evidence; not design authority)
3. `CODEX_MASTER_INSTRUCTIONS_COMPLETE_FINAL_v1.5.md`
4. `Port_Control_COMPLETE_DESIGN_BIBLE_FINAL_v1.5.docx`
5. `Port_Control_Baseline_Source_FINAL_v1.5/README_BASELINE.md`
6. `Port_Control_DEV_BACKLOG_FEATURE_LIST_FINAL_v1.5.docx`
7. `Port_Control_QA_RELEASE_CHECKLIST_FINAL_v1.5.docx`
8. `RELEASE_RUNBOOK_COMPLETE_FINAL_v1.5.md`
9. `Port_Control_BALANCE_CONTENT_TABLE_FINAL_v1.5.docx`, `Port_Control_VISUAL_STYLE_FRAME_FINAL_v1.5.docx` and `Port_Control_ART_UI_ASSET_LIST_FINAL_v1.5.docx` when the active task references them.
10. `PRODUCT_DESIGN_AUDIT_RULES_FINAL_v1.5.md` before approving any new feature or v2 design change.
11. `COMMERCIAL_HIT_VALIDATION_PLAN_FINAL_v1.5.md` at Core Feel, fairness/economy, store creative, soft-launch and monetization gates.

## Non-negotiable
- Complete Design Bible owns semantic WHAT/WHY and gameplay behavior.
- Baseline Source owns exact machine-backed simulation/economy/content values, IDs and geometry.
- Supporting documents do not create alternate game rules.
- A real authority conflict blocks the task; do not choose a winner silently.
- Do not regenerate/re-author the 40 campaign levels during Iteration v1.
- Roblox course materials are methodology only; Roblox-specific Lua/DataStore/Pass/Robux implementation is not used in Phaser/Yandex.
- Production art/audio and player evidence are implementation/evidence deliverables, not missing design.

## First command gate
Copy the frozen Baseline Source into the repo and run its validators before merging gameplay work. Then begin with `FND-01` from the DEV Backlog.
