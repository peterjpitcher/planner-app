# Adversarial Review: Task Lifecycle Discovery Spec

**Date:** 2026-04-20
**Mode:** C (Spec Compliance)
**Scope:** [docs/superpowers/specs/2026-04-20-task-lifecycle-bugs-discovery.md](../../docs/superpowers/specs/2026-04-20-task-lifecycle-bugs-discovery.md)
**Pack:** [tasks/codex-qa-review/2026-04-20-task-lifecycle-bugs-discovery-review-pack.md](./2026-04-20-task-lifecycle-bugs-discovery-review-pack.md)
**Reviewers:** assumption-breaker, spec-trace-auditor, integration-architecture, workflow-failure-path, security-data-risk (all Codex, 5 passes, ~27 raw findings)

---

## Executive Summary

Codex reviewed the discovery spec with five specialist lenses. Many findings came back as "Needs verification" because the pack-builder's defaults excluded `docs/superpowers/**` and truncated the spec at line 200 of 368 — so reviewers saw only bugs #1-#3, not bug #4 or the diagnostics section. Claude (as orchestrator) then verified the high-impact claims against the real source.

**Outcome:** the spec's core diagnoses hold, but the review surfaced **three material spec defects**, **one real latent security finding**, and **five smaller editorial corrections**. The spec should be revised before it drives any fix work.

## What Appears Solid

- Factoring the four bugs into two architectural themes (cron-driven lifecycle vs. mutation→refresh signalling). All five reviewers agreed this is the right split and not an over-unification.
- State-driven (not `due_date`-driven) view membership as the architectural baseline.
- "No fixes proposed" discipline — matches the discovery scope; do not relax this in revisions.
- Framing Microsoft Graph silent-email-failures as an observability gap, not a bug in Graph itself.
- Verified factual claims (see Unproven Assumptions table below — ✓ rows).

---

## Critical Risks

### R-1. Bug #1 framing conflates cron failure with design mismatch

**Reviewers:** WF-001, SPEC-004.

The spec names "cron not firing" as Bug #1's highest-likelihood root cause, but the same spec elsewhere states that no view does morning rollover — even a healthy cron leaves stale `today` tasks visible until 19:55 UTC (≈ 20:55 BST). The user-visible consequence depends on when the observation was made:

- Observed before ~21:00 London → by design, not cron failure. Cron health is irrelevant.
- Observed after ~21:00 London → cron failure is plausible.

The spec does not condition its diagnosis on time-of-observation. A reader following the current text will jump to cron diagnostics even when the real cause is "the system does not do what the user expected it to do".

**Fix:** make this split explicit. Add one clarifying question to the top of the Bug #1 diagnostics: "At what London time did you observe the stale Today tasks?"

### R-2. Bug #1 diagnostic is incomplete

**Reviewer:** WF-002.

The recommended SQL only queries `cron_runs` for `demote_today`. That tells you whether the cron ran — not whether any task is currently stuck in `state='today'`. A cron with `status='success'` can still leave stale tasks if:

- The task was created after the 19:55 UTC window with `state='today'`.
- `updateTask` failed silently for a specific row (the cron aggregates `demotedTasks` only on `!result.error`, but `status` is still marked `success` when some rows fail).

**Fix:** add a companion query to Bug #1 diagnostics that selects `state='today'` rows with `due_date < today()`, and instructs the reader to compare their `updated_at` to the latest `demote_today` `run_date`.

### R-3. Cron auth wording is wrong — and a latent security finding is hidden in the current behaviour

**Reviewer:** SEC-001. **Orchestrator verification:** [src/lib/cronAuth.js:15-44](../../src/lib/cronAuth.js#L15).

The spec says cron auth expects "either Vercel's `x-vercel-cron: 1` header **or** a matching `CRON_SECRET` bearer token". Two corrections, one of them material:

1. **Wrong header.** The secret comes from the `x-cron-secret` header, not `Authorization: Bearer` style. (Editorial.)

2. **Auth is not "either/or".** Reading the real code:
   - If `CRON_SECRET` env var **is set** → request's `x-cron-secret` header **must match**. `x-vercel-cron` alone does not satisfy.
   - If `CRON_SECRET` is **unset**, production, and `x-vercel-cron: 1` header is present → authorised.
   - If `CRON_SECRET` is **unset**, production, no `x-vercel-cron` → 403.

   The second case is a latent security risk. If `CRON_SECRET` is not set in Vercel production, a third party who guesses the endpoint paths (`/api/cron/demote-today-tasks`, etc.) can set the header themselves on a `curl` and trigger:
   - Mass state demotion across the user's tasks
   - Uninvited digest email sends from the user's Microsoft account
   - `office365-sync` at will

   Vercel does not contractually guarantee stripping arbitrary `x-vercel-cron` headers from external traffic. The spec currently presents `CRON_SECRET` as an ops reliability knob; it is **also** a production security requirement.

**Fix:** (a) correct the header name; (b) restructure the auth description to reflect the real precedence; (c) add a security-flavoured hypothesis to Bug #2: "If `CRON_SECRET` is unset on Vercel, the crons are both unreliable AND vulnerable to external invocation."

---

## Spec Defects

### S-1. Daily-email idempotency guard is asserted but not explained

**Reviewer:** WF-004. **Orchestrator verification:** [src/lib/cronAuth.js:80](../../src/lib/cronAuth.js#L80).

The spec says two daily-email cron entries exist at 07:00 and 08:00 UTC "for idempotency + retry" without saying how the second run is prevented from sending a duplicate. The actual mechanism: `claimCronRun` performs an `INSERT` into `cron_runs(operation, run_date)`, catches Postgres error `23505` (unique constraint violation), and returns `reason='already_run'`. The caller exits early before re-sending.

**Fix:** add this two-sentence explanation under Bug #2.

### S-2. Recovery paths for stale `this_week` tasks not documented

**Reviewer:** WF-005.

Bug #3 says stale `this_week` tasks are invisible in the weekly planning modal. The spec does not say whether the user can still reach those tasks via another view (a dedicated This Week page, Backlog, search). If no such view exists, the invisibility is systemic; if one exists, the bug's blast radius is smaller.

**Fix:** either document the other views that still show `state='this_week'` tasks, or state explicitly that the planning modal is the only user-facing surface that exposes them.

### S-3. Cross-tab / focus / multi-device refresh is not covered

**Reviewer:** WF-007.

The spec's mutation→refresh section describes only in-tab event dispatch. It says nothing about:

- A second tab open before a mutation happened in tab A (the second tab shows stale data until a hard reload; no `storage` event, `visibilitychange`, or `focus` refetch exists in the verified listeners).
- Whether Peter uses multiple devices.

This is both an architectural gap AND a diagnostic confounder: if Peter reports stale UI, it may be a second-tab snapshot, not a refresh-signal bug.

**Fix:** add a "Cross-cutting caveats" subsection noting (a) the per-tab refresh model and (b) a pre-diagnostic step — "before escalating any stale-UI symptom, hard-reload every open tab".

### S-4. Verified fact vs. hypothesis is not flagged

**Reviewer:** AB-008.

The spec uses strong language — "highest likelihood", "load-bearing" — on items that are rank-ordered hypotheses, alongside items that are directly verified from code. A reader cannot tell them apart without re-verifying everything.

**Fix:** add a legend (e.g. ✓ = verified; ? = hypothesis pending diagnostic) and tag each bullet in the Root-cause hypotheses sections.

### S-5. `planning-complete` is named as "the contract" but is planning-specific

**Reviewers:** SPEC-007, ARCH-003.

The spec correctly reports that `planning-complete` is the only refetch event, but by labelling it "the mutation→refresh contract" it implicitly endorses the event name as a design choice. A future reader might extend that event from QuickCapture rather than consider whether the right abstraction is a general `task-changed` event, a shared store, or `router.refresh()`.

**Fix:** describe `planning-complete` as "the current mechanism" (not "the contract"). Move the naming / abstraction question into Open Questions.

---

## Architecture & Integration Defects

*(All four ARCH-0xx findings from the Integration & Architecture reviewer were "Needs verification" caused by pack limitations. Orchestrator verified three of them against current source and the claims hold; one — ARCH-004, CLAUDE.md drift — is genuine but about the CLAUDE.md, not this spec. See Minor Observations.)*

---

## Workflow & Failure-Path Defects

- **WF-003** — the spec's aside about "could short-circuit earlier" in the demote cron try/catch is excessively cautious. Orchestrator verified [demote-today-tasks/route.js:91-148](../../src/app/api/cron/demote-today-tasks/route.js#L91): the state update and the email send are in separate try blocks; email failure genuinely only sets `status='partial'`. The hedge should be removed.
- **WF-006** — QuickCapture double-submit was flagged. Orchestrator verified [QuickCapture.jsx:53-104](../../src/components/shared/QuickCapture.jsx#L53): a `submitting` boolean guards re-entry. Not a defect.
- **WF-008** — Bug #1 "no rows" diagnostic is ambiguous (could be auth rejection, routing failure, DB outage, or missing `cron_runs` table — `claimCronRun` silently returns `reason='no_tracking_table'` in that last case). Elevate the Vercel-invocation-log check from diagnostic step 4 to step 1.

---

## Security & Data Risks

- **R-3** (above) is the only material one.
- **SEC-002/SEC-003/SEC-004** all flagged tenant-scope / RLS / response-shape risks as "Needs verification". Orchestrator spot-checked: the demote crons call `.eq('user_id', userId)` with a user resolved from `DIGEST_USER_EMAIL` → single-user scope, so tenant-wide corruption is not a realistic threat for this deployment. `planning-candidates` authenticates via `getAuthContext` and scopes by `user_id`. None is a defect given the current single-user deployment model, but the spec could say so explicitly since the crons as written are not safe if the app ever goes multi-tenant.

---

## Unproven Assumptions

Reviewers flagged many claims as "Needs verification" (pack omission). Orchestrator verified the high-impact ones:

| Claim | Status | Evidence |
|---|---|---|
| `apiClient.createTask` does not call `clearCache`; `createProject` does | ✓ | [apiClient.js:58-67 vs. 134-167](../../src/lib/apiClient.js#L58) |
| `getTasks` does not use `dedupedFetch`; only `getProjects` does | ✓ | [apiClient.js:87-103](../../src/lib/apiClient.js#L87) |
| `planning-complete` is the only refetch event, dispatched only from `usePlanningPrompt.js:173` | ✓ | workspace grep returned exactly one dispatcher and three listeners |
| `/api/planning-candidates` weekly filter excludes `state='this_week'` from overdue bucket | ✓ | [planning-candidates/route.js:87-108](../../src/app/api/planning-candidates/route.js#L87) |
| `demote-today-tasks` flips `state` only, not `due_date` | ✓ | [demote-today-tasks/route.js:97](../../src/app/api/cron/demote-today-tasks/route.js#L97) |
| `demote-week-tasks` Sunday guard + `this_week`→`backlog` | ✓ | [demote-week-tasks/route.js:27, 104](../../src/app/api/cron/demote-week-tasks/route.js#L27) |
| Five cron entries in `vercel.json` | ✓ | [vercel.json](../../vercel.json) |
| Cron auth = "either Vercel header OR matching bearer token" | ✗ wrong | [cronAuth.js:15-44](../../src/lib/cronAuth.js#L15) — actual precedence described in R-3 |
| Microsoft Graph env vars are the critical transport dependency | unverified | not needed for current conclusions; confirm via `daily_task_email_runs.error` column |
| Diagnostic SQL column names (`operation`, `run_date`, `status`, `tasks_affected`, `error`) match actual schema | unverified | run `\d cron_runs` / `\d daily_task_email_runs` before diagnostics — low risk but zero cost to confirm |

---

## Recommended Fix Order

1. **R-3** — correct auth wording AND add the unset-`CRON_SECRET` security hypothesis. Highest-impact correction.
2. **R-1** — split Bug #1 by time-of-observation.
3. **R-2** — extend Bug #1 diagnostic with the task-stuck companion query.
4. **S-1** — document the `claimCronRun` uniqueness guard for daily emails.
5. **S-3** — add the cross-tab confounder and pre-diagnostic reload step.
6. **S-2** — document or rule out other views that surface stale `this_week` tasks.
7. **S-4** — fact-vs-hypothesis legend and per-bullet tagging.
8. **S-5** — reframe `planning-complete` as "current mechanism", not "contract".
9. **Minor** — remove the WF-003 "could short-circuit" hedge; elevate Vercel log check to diagnostic step 1.

---

## Minor Observations

- **Pack meta-defect.** `build-review-pack.sh` excluded `docs/superpowers/**` by default and truncated the spec at line 200 of 368. For future Mode C reviews on a spec in this workspace, either raise `FILE_LINE_CAP` or pass `--exclude ""` plus add an explicit `--spec` arg (already done) — but also consider editing the default-excludes list.
- **Project CLAUDE.md drift [ARCH-004].** The project `CLAUDE.md` says "Direct Supabase queries in components" and "No server actions". Current code routes writes through `/api/*` route handlers via `apiClient`. Spec is correct; CLAUDE.md is stale. This is a separate follow-up (not this spec).
- **`Authorization: Bearer` phrasing.** The real header is `x-cron-secret`.
- **Spec truncation note.** The reviewers' "Needs verification" label on bug #4-related claims reflects the pack truncation, not the spec's content. Orchestrator verified those claims directly — they hold.
