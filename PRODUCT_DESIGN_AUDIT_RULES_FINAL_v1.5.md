# PORT CONTROL — PRODUCT DESIGN AUDIT RULES FINAL v1.5

Status: **METHODOLOGY / CHANGE GOVERNANCE**

This file adapts the user's L1–L5 game-design course materials and their Idea / Monetization / LiveOps / Final Critic sheets to Port Control. It is a review checklist, not a second Design Bible. It may not override the Complete Design Bible or machine baseline.

## 1. Operating chain
Every product decision must remain causally connected:

`AUDIENCE → PROMISE → CORE → SESSION → META → PERSIST → MONETIZATION → ANALYTICS → LIVEOPS`

Port Control mapping:
- Audience/Promise: player immediately understands “draw routes and manage a busy harbor”.
- Core: select/draw/reroute → compatible dock → unload → manual exit under traffic pressure.
- Session: short level → result → port/meta decision → next level or exit.
- Meta: upgrades visibly change the port and meaningfully alter future core decisions without automating play.
- Persist: Coins, Stars, port stages/unlocks and records make return sessions feel different.
- Monetization: opt-in contextual state change only after value is understood.
- Analytics/LiveOps: diagnose the earliest failing step, then test the smallest reversible hypothesis.

## 2. Two gates before a new feature
Before documenting or coding any new feature:
1. **WHY gate** — what player problem, behavior or KPI is expected to change?
2. **FEATURE PLAN gate** — is it already in approved scope/backlog?

If either answer is missing, the feature is not implementation-ready. A new idea is a scope decision, not a “small polish task”.

## 3. Depth > Complexity
Prefer deeper decisions inside the existing verbs before adding a new verb, currency, mode or mini-game.

Good surfaces: route geometry, traffic priority, ship speed/turn trade-offs, dock occupancy, cargo matching, hazard interaction, spawn pressure, temporary/permanent port choices.

A new standalone activity requires a separate product case and is outside frozen Release 1.0 until approved.

## 4. Causal-loop audit
A healthy change preserves all links:
- Core result creates a reason to visit Meta.
- Meta changes the value/options of the next Core run.
- Persist makes progress visible across sessions.
- FTUE teaches the real game, not menus or future promises.
- Long-term content expands existing systems without rebuilding the engine.

If two good features merely sit next to each other without one creating a reason for the next, the chain is incomplete.

## 5. WHAT / WHY vs HOW
- Human/Product authority owns **WHAT** and **WHY**.
- Codex/programmer owns **HOW** inside architecture invariants.
- AI may propose implementation alternatives only when they preserve the frozen behavior and acceptance criteria.
- AI may not resolve a missing game rule by guessing. Mark the task `BLOCKED`.

## 6. AI context discipline
Do not feed the agent every reference by default. For each task provide only:
- Task ID and goal.
- Relevant Complete Design Bible section(s).
- Relevant machine config/schema IDs.
- Related source files.
- Acceptance criteria/tests.
- Explicit non-goals.
- Latest decision/session note only when needed.

Workflow: `expected result → minimal change → tests/playtest → acceptance → next step`.

## 7. Monetization audit
Use the causal chain:
`player desire → understood value → need/friction → contextual offer → state change → post-offer proof → measurement`

Release 1.0 guardrails:
- Rewarded only by explicit player choice.
- No ad during active traffic.
- No mandatory ad for progression.
- No duplicate reward.
- Paid/IAP systems remain OFF unless a future evidence-backed product case explicitly versions the scope.

## 8. LiveOps / iteration audit
A signal is not automatically a problem, and a problem is not automatically a solution.

Every v2 change must be recorded as:
`Signal → Problem → Hypothesis → Exact Change → Primary Metric → Guardrails → Test → Keep/Rollback`

Prefer reusing existing configurable surfaces (levels, modifiers, objectives, spawn director, perks, rewards) before adding architecture.

## 9. Commercial evidence rule
Documents can close implementation ambiguity; they cannot guarantee a hit or revenue.

Before scaling expensive polish/marketing, use the Commercial Hit Validation Plan:
- fresh-player core comprehension;
- deterministic 50-seed fairness;
- mandatory economy gate;
- store creative comprehension;
- 20–50 player soft launch;
- retention/ad/technical diagnostics.

Passing gates means “do not tune by taste”. Failing gates authorize only targeted evidence-driven v2 work.

## 10. Reference boundary
Applicable as methodology:
- Kovtun game-design L1–L5 materials.
- Idea / Monetization / LiveOps sheets and critic prompts.
- Final Course Sheet / Final Critic.

Not technical authority for this project:
- Roblox Lua / Studio / DataStore / Parts / RemoteEvents implementation examples.
- Roblox-specific Passes, Robux, Developer Products, multiplayer or platform rules.

Port Control remains Phaser + TypeScript + Yandex Games. Technical authority is the Complete Design Bible, Baseline Source, QA and Release Runbook.
