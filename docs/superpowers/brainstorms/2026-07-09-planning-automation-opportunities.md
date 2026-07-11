# Planner 2.0 — Automation & Anti-Staleness Opportunities

**Date:** 2026-07-09
**Status:** Brainstorm output — nothing here is implemented or committed to.
**Goals:** (1) stop planning every day by hand, (2) stay focused on true priorities, (3) nothing goes stale or gets lost.
**Method:** 6 parallel ideation passes (auto-planning, prioritisation signal, anti-staleness, nudges, AI assist, friction removal) over a verified product map, followed by a completeness critique. 66 raw ideas consolidated into the feature list below.

---

## Why planning is manual today (root causes, not symptoms)

1. **Today is wiped nightly.** The 19:55 cron demotes every Today task to This Week, so the day must be rebuilt from scratch in the 20:05 planning modal — every single evening.
2. **The planning modal makes you decide everything.** Every candidate row needs a hand-placed decision (Must Do / Good to Do / Quick Wins / Defer / Skip). Nothing is pre-ranked or pre-assigned, and Skip is not persisted, so the same rows reappear night after night.
3. **Priority signal exists but is inert.** Chips (`high_impact`, `urgent`, `blocks_others`, `stress_relief`, `only_i_can`), `task_type`, project due dates and `entered_state_at` are all stored — and consumed by nothing. Ordering everywhere is due date + manual drag.
4. **Several guaranteed black holes.** Plain quick-captures and promoted ideas land as undated Backlog tasks that nothing ever resurfaces. Idea `review_date` is stored but never read. Staleness badges (this_week >14d, waiting >7d) drive no behaviour. There is no snooze. Outlook-imported tasks are written with `state:'todo'` — outside the valid enum — so they match no view at all.
5. **The morning email reports the plan instead of building it.** It lists only tasks already in Today with a due date ≤ today — blind to undated work, captures, chases and stale items. And all five crons fail silently.

The previous design intent was explicitly "simple, no auto-prioritisation". Most of what follows deliberately overrides that intent — flagged where it does.

---

## Foundations (build-once primitives everything else consumes)

### F1. Chip-tier comparator — ranking without numbers
A deterministic sort: overdue → due tomorrow → chip tier (`blocks_others` > `urgent` > `high_impact` > `only_i_can` > `stress_relief`) → parent-project deadline proximity → age in state. Applied server-side in planning candidates and shared with the email. No score is ever stored or shown — the only output is row order. **This is the primitive that pre-assignment, autopilot, seeded ordering and digest ranking all consume — build it first.** *(Effort S, Impact High. Overrides the "no auto-prioritisation" intent in spirit; deterministic and inspectable by design.)*

### F2. First-class snooze (`snoozed_until`)
Replace the non-persisted Skip with "Snooze until…" (tonight / 3 days / 1 week / date). Candidate queries exclude snoozed tasks until the date arrives — then they are *guaranteed* to come back. Visible snoozed badge on the Plan board so it never becomes a new hiding place; snooze counter escalates to a forced decision after ~3. Ends groundhog-day planning. *(S, High)*

### F3. Capture inbox — every capture gets exactly one guaranteed triage moment
Route quick-capture, idea promotion and Outlook-inbound tasks to a triage state that feeds that evening's planning modal automatically (simplest form: default captures to undated `this_week`, which is already a candidate source; or an `inbox` flag with its own candidate group). Includes: fixing the O365 inbound `state:'todo'` bug, a promote-with-destination picker for ideas (default This Week), and a "captured yesterday" line in the morning email as backstop. **Closes the app's biggest black hole.** *(S–M, High)*

### F4. Next-review invariant — no task or idea without a future surfacing moment
A `next_review_at` on tasks (and default review horizons for ideas: captured +30d, exploring +45d, ready_later uses its `review_date`) that is never null — defaulted from due date, follow-up date or state. Anything past its review date joins the planning candidates as a capped "needs a decision" group (3–5 rows/night, oldest first). This one mechanism subsumes backlog ageing, the escalation ladder, idea review-date wake-up and vault ageing. Top rung: auto-archive (never delete) after ~90 days/3 snoozes, with a monthly reversible "graveyard review". **Requires a one-off amnesty migration**: jitter review dates over 6–8 weeks so the existing backlog pile drains gradually instead of flooding night one. *(L, High)*

### F5. Automation trust ramp — how to override "keep it simple" safely
Every automated behaviour gets a per-feature setting: **off / suggest / auto**, shipping in *suggest*. Every robot mutation stamps provenance ("why is this here") on the task, visible on cards and modal rows. Cron runs become visible and undoable in-app ("Overnight: 7 tasks moved Today → This Week. Review | Undo"), and a cron heartbeat rides the daily email footer ("automation healthy" / red alert), with an external dead-man's-switch pinger for the email cron itself. **This is the umbrella that makes 40 automations feel like one simple app.** *(M, High)*

---

## Goal 1 — The day plans itself

### A1. Stop wiping Today: smart carry-forward
Change the 19:55 demote cron: unfinished Must Do tasks keep their section and order overnight (with a `carried_count`); the rest demote as now but **preserve `today_section`** so the modal can offer one-tap "Keep my plan". Tasks carried 3+ times surface as exceptions needing a real decision. Alone, this removes the nightly rebuild-from-scratch. *(S, High — the single best effort-to-value ratio in the list.)*

### A2. Pre-assigned planning modal
Candidates arrive pre-placed by F1's rules (overdue/due-tomorrow → Must Do capped at 5; quick `task_type` → Quick Wins capped at 8; rest → Good to Do or suggested defer date), each row showing its reason ("overdue 3d"). One **Accept all suggestions** button; the user drags exceptions instead of deciding from zero. Also seeds `sort_order` at commit so the day opens pre-ordered — no morning drag session. *(M, High)*

### A3. Morning autopilot (safety net)
05:00 cron: if no planning session exists for today, run the same rule engine server-side and build the day within caps, stamped `auto_planned`, with a "built for you — review?" banner. The evening ritual becomes optional rather than mandatory homework. *(M, High)*

### A4. One rebuilt morning digest (single spec, not seven emails)
Rebuild the 08:00 email once, with ordered sections: **today's (drafted) plan** → **needs a decision** (captures, chases due, ideas due for review, stale items — each capped at 3 + count) → **automation health footer**. Optionally add one-tap signed action links (confirm plan, defer to Friday) so the day can be confirmed from the phone inbox — links must be single-use, expiring, and safe against mail-scanner prefetch. *(M–L, High)*

### A5. LLM chief-of-staff layer (optional, on top of rules)
Nightly gpt-4o pass over the candidate set + staleness + completion history returns section assignments with a one-line rationale per task, capped 5/5/8; deterministic rules remain the always-available fallback. Ship only after A2 proves the plumbing; pay the cost/latency only if rule-drafts prove insufficient. *(L, High — the strongest break from the old intent; rationale + fallback non-negotiable.)*

### A6. One-step Sunday
Auto-execute the mechanical weekly step (demote then immediately re-promote tasks due within 7 days and chases due next week), and let the weekly Accept assign straight into Monday sections. Sunday becomes one session, not two. Demote-then-repromote must be transactional. *(M, Medium)*

### A7. Capacity-aware planning (later phase)
S/M/L effort estimates per task (LLM-suggested, user-corrected) → load bar against focus-hours in the modal; then Graph calendar integration to compute *real* free hours per day ("plan needs 5h, you have 2.5h"); then optional Focus-block export writing Must Do time into the Outlook calendar so priorities defend actual hours. Each step is separately shippable. *(M+M+M, High combined; calendar writes default off.)*

---

## Goal 2 — Focus on true priorities

### P1. Project altitude: stalled-project radar + deadline inheritance
(a) Undated tasks inherit urgency from the parent project's due date (labelled "project due Fri", no fake task dates written). (b) Nightly check flags active projects with no open next task, or a deadline within 14 days and nothing planned — surfaced as "project needs a next step" with inline add-task. The GTD next-action invariant: every live project always has a scheduled next move. *(S+M, High)*

### P2. Must Do overload guard + cap-aware overflow deferral
When Must Do exceeds 5, name the weakest occupant (no chips, not due, no near deadline) and offer one-tap demote; when planning overflows, propose batch defer dates chosen from the emptiest upcoming weekday. Advisory, never blocking. *(S+M, Medium)*

### P3. Chips ↔ Outlook importance round-trip
Outbound: `urgent`/`high_impact` → O365 `importance:high`. Inbound: `importance:high` → add `urgent` chip (add-only, never remove, to avoid sync flap). Priority signal stops dying at the app boundary. *(S, Medium)*

### P4. Recurring tasks engine
Lightweight recurrence rules; a nightly cron materialises the next instance with a section hint, flowing through planning candidates like any dated task. Removes the invisible re-capture burden of weekly/monthly chores. Must decide a recurrence master vs Outlook's own recurrence to avoid duplicates. *(M, High)*

---

## Goal 3 — Nothing goes stale or gets lost

### S1. Chase engine for Waiting (one engine, four ideas merged)
When `follow_up_date` arrives (or waiting >7d with no date — and make a follow-up date mandatory with a +5-working-days default), the task appears in the morning email ("Chase today") and as a planning-candidate group. One-tap "chased — push +N days" with a visible bump count. Optional: LLM-drafted chase message from `waiting_reason`, copy-paste ready; optional later: group chases by person ("Dave — 3 items, oldest 12d", one combined message). *(S core, Medium–High)*

### S2. Weekly review digest (Sunday ~17:00, before the demote cron)
Four capped sections: undated captures (oldest first), ideas due for review, stale this_week/waiting items (using the exact thresholds the badges already compute), follow-ups overdue — plus an LLM-written "what slipped this week and why" retrospective (bounced tasks, dates pushed twice, pattern of the week). Lands two hours before Sunday planning so triage feeds straight into it. *(S–M, High)*

### S3. Working days & away mode
Crons, nags and autopilot no-op on non-working days and during "away until"; defers skip to the next working day; first day back gets a re-entry digest with a one-tap rebuild-week. Suppressed items queue, never drop. *(S, Medium)*

### S4. Smarter capture (nice-to-have layer)
Natural-language capture parsing ("chase invoice with Dave on Friday" → name, date, project, chips as *editable pills* before commit, LLM never writes unseen); "break down" action proposing 2–5 subtasks on big vague tasks. Both send task text to OpenAI — a new data flow worth a conscious decision. *(M each, Medium)*

---

## Explicitly not recommended (considered and killed)

| Idea | Why killed |
|---|---|
| Focus-mode toggles on Today | Reorder toggles for a list capped at ~18 items; scanning is faster than toggling. |
| Momentum/streak footer | Gamification serves none of the three goals; guilt-noise in the one email that must stay signal. |
| Keyboard-first planning modal | Optimises the speed of a ritual every other idea is trying to eliminate. |
| Pre-demote sweep email (19:30) | A third evening touchpoint made pointless the moment carry-forward ships. |
| Journal-aware workload nudge | Therapy-adjacent data influencing planning = highest trust-damage-per-value in the list; a "lighter day" is one manual tap. |
| Duplicate catcher on every capture | Downgraded: an LLM call per create for a single-user app; the capture-inbox triage moment catches duplicates for free. |

---

## Dependencies & a sensible order (if any of this proceeds)

1. **Wave 0 (fixes + trust):** O365 `state:'todo'` bug, cron heartbeat, visible/undoable crons, trust-ramp settings skeleton.
2. **Wave 1 (foundations):** chip-tier comparator (F1), snooze (F2), capture inbox (F3), carry-forward (A1). *These four alone remove most of the nightly grind.*
3. **Wave 2 (the plan builds itself):** pre-assigned modal (A2), rebuilt digest (A4), one-step Sunday (A6), chase engine (S1), weekly review (S2).
4. **Wave 3 (invariants):** next-review invariant + amnesty migration (F4), stalled-project radar (P1), recurrence (P4), working days (S3).
5. **Wave 4 (intelligence, optional):** morning autopilot (A3), LLM draft layer (A5), capacity/calendar (A7), NL capture (S4).

Two design decisions gate everything: **rules-first with LLM as an optional layer** (not two competing brains for the same slot), and **suggest-before-auto** per feature via the trust ramp.

---

## Appendix — full raw idea list (66)

The complete unmerged output of the six ideation lenses and the critic, for reference. Duplicate concepts are marked with the consolidated feature they merged into.

| # | Idea | Lens | Merged into |
|---|---|---|---|
| 1 | Morning Proposal Digest | nudges | A4 |
| 2 | Actionable Evening Wrap-Up Email | nudges | A4 |
| 3 | Weekly Lost-and-Stale Review Digest | nudges | S2 |
| 4 | Cron Heartbeat Watchdog | nudges | F5 |
| 5 | Single Nudge Banner on Today | nudges | F5/A4 |
| 6 | Pre-Demote Sweep Prompt | nudges | killed |
| 7 | Quick-Capture Rescue Line | nudges | F3/A4 |
| 8 | Waiting-On Chaser Assistant | nudges | S1 |
| 9 | Momentum Footer | nudges | killed |
| 10 | Next-Review Invariant | anti-staleness | F4 |
| 11 | Capture Inbox | anti-staleness | F3 |
| 12 | Snooze Replaces Skip | anti-staleness | F2 |
| 13 | Idea Review-Date Wakeup | anti-staleness | F4 |
| 14 | Backlog Escalation Ladder | anti-staleness | F4 |
| 15 | Auto-Archive with Graveyard Review | anti-staleness | F4 |
| 16 | Draft Tomorrow, Don't Wipe Today | anti-staleness | A1/A2 |
| 17 | Waiting Chase Engine | anti-staleness | S1 |
| 18 | Decision Digest | anti-staleness | A4 |
| 19 | Smart Carry-Forward | auto-planning | A1 |
| 20 | Pre-Assigned Planning Modal | auto-planning | A2 |
| 21 | Persisted Skip and Snooze | auto-planning | F2 |
| 22 | Morning Autopilot | auto-planning | A3 |
| 23 | Plan-in-Your-Inbox Digest | auto-planning | A4 |
| 24 | LLM Chief-of-Staff Draft | auto-planning | A5 |
| 25 | Cap-Aware Overflow Deferral | auto-planning | P2 |
| 26 | Quick Wins Auto-Harvest | auto-planning | F3/F4 |
| 27 | One-Step Sunday | auto-planning | A6 |
| 28 | Chip-tier ordering (ranking without numbers) | prioritisation | F1 |
| 29 | Suggested-section pre-fill | prioritisation | A2 |
| 30 | Must Do overload guard | prioritisation | P2 |
| 31 | Age-boost surfacing | prioritisation | F4 |
| 32 | Project-deadline-inherited urgency | prioritisation | P1 |
| 33 | Focus modes on Today | prioritisation | killed |
| 34 | Chips ↔ O365 importance round-trip | prioritisation | P3 |
| 35 | Signal-ranked digest with Top 3 | prioritisation | A4 |
| 36 | Waiting-chase escalation into planning | prioritisation | S1 |
| 37 | Seeded day order | prioritisation | A2 |
| 38 | Natural-language quick capture | ai-assist | S4 |
| 39 | LLM-drafted evening plan | ai-assist | A5 |
| 40 | Smart morning briefing | ai-assist | A4/A5 |
| 41 | Break-it-down at planning time | ai-assist | S4 |
| 42 | Weekly slip report | ai-assist | S2 |
| 43 | Duplicate catcher on capture | ai-assist | downgraded |
| 44 | Realistic-day load check | ai-assist | A7 |
| 45 | Journal-aware workload nudge | ai-assist | killed |
| 46 | Backlog groomer | ai-assist | F4 (LLM option) |
| 47 | Roll My Day Forward | friction | A1 |
| 48 | Bulk Actions in the Planning Modal | friction | A2 |
| 49 | Persistent Skip (Snooze) | friction | F2 |
| 50 | Keyboard-First Planning | friction | killed |
| 51 | Capture Into the Ritual, Not the Void | friction | F3 |
| 52 | Visible, Undoable Demote Crons | friction | F5 |
| 53 | Single-Pass Sunday | friction | A6 |
| 54 | Chase List in the Planning Modal | friction | S1 |
| 55 | Ready Later Actually Returns | friction | F4 |
| 56 | Promote Ideas to a Destination | friction | F3 |
| 57 | Recurring Tasks Engine | critic-gap | P4 |
| 58 | Sync-Inbound Triage Routing | critic-gap | F3 (+ bug fix) |
| 59 | Stalled-Project Radar | critic-gap | P1 |
| 60 | Meeting-Aware Day Capacity | critic-gap | A7 |
| 61 | Automation Trust Ramp | critic-gap | F5 |
| 62 | Working-Days & Away Mode | critic-gap | S3 |
| 63 | Backlog Amnesty Sweep | critic-gap | F4 |
| 64 | Chase by Person | critic-gap | S1 |
| 65 | Focus-Block Calendar Export | critic-gap | A7 |
| 66 | Idea Vault Full-Lifecycle Ageing | critic-gap | F4 |
