# Claude Hand-Off Brief: Task Lifecycle Discovery Spec

**Generated:** 2026-04-20
**Review mode:** C (Spec Compliance)
**Overall risk:** Medium — spec is directionally sound; 3 material defects + 1 latent security finding + 5 editorial corrections
**Report:** [2026-04-20-task-lifecycle-bugs-discovery-adversarial-review.md](./2026-04-20-task-lifecycle-bugs-discovery-adversarial-review.md)

---

## DO NOT REWRITE

- The executive summary's two-themes factoring (cron lifecycle vs. mutation→refresh signalling). All reviewers agreed.
- The state-machine primer (states, decoupling from `due_date`).
- The diagnostic SQL for `cron_runs` / `daily_task_email_runs` (column names unverified but consistent with the spec's source migration reference).
- The verified claims in the Unproven Assumptions table (they are confirmed against code).
- The "no fixes proposed" discipline. Do not relax it during revision.

## SPEC REVISION REQUIRED

- [ ] **R-3a — fix auth wording.** Replace "matching `CRON_SECRET` bearer token" with "`x-cron-secret` header matching the `CRON_SECRET` env var".
- [ ] **R-3b — restructure auth precedence.** State explicitly: if `CRON_SECRET` is set, the header must match and `x-vercel-cron` alone is insufficient; if `CRON_SECRET` is unset in production, `x-vercel-cron: 1` alone authorises.
- [ ] **R-3c — add security hypothesis to Bug #2.** Add a bullet: "If `CRON_SECRET` is unset in Vercel production, the cron endpoints are reachable by anyone who sets `x-vercel-cron: 1` on a direct request — which is both unreliable AND a mass-mutation / uninvited-email vulnerability. Mitigation: set `CRON_SECRET` in Vercel production env."
- [ ] **R-1 — split Bug #1 by time-of-observation.** Re-structure the root-cause hypotheses so hypothesis 1 is "If observed after ~21:00 London" (cron failure plausible) and a new hypothesis 2 is "If observed before ~21:00 London" (design mismatch — there is no morning rollover; this is working as currently built). Add a preceding clarifying question: "At what London time were the stuck tasks observed?"
- [ ] **R-2 — extend Bug #1 diagnostic.** Append to Bug #1's diagnostic SQL block:
      ```sql
      -- Tasks currently stuck in 'today' with a past due_date
      SELECT id, name, state, due_date, created_at, updated_at
      FROM tasks
      WHERE user_id = '<peter-user-id>'
        AND state = 'today'
        AND due_date < (now() AT TIME ZONE 'Europe/London')::date
      ORDER BY updated_at DESC;
      ```
      Plus one sentence: "Compare each row's `updated_at` to the most recent `demote_today` `run_date` — if `updated_at` is earlier, the cron missed this row."
- [ ] **S-1 — document daily-email idempotency.** In Bug #2 description, after "two entries for idempotency + retry", add: "Duplicate-send between the 07:00 and 08:00 runs is prevented by a unique `(operation, run_date)` constraint on `cron_runs`. The second invocation's `claimCronRun` ([src/lib/cronAuth.js:80](src/lib/cronAuth.js#L80)) catches Postgres error 23505 and returns `reason='already_run'`, exiting before the email is built."
- [ ] **S-3 — cross-cutting caveats section.** Add a new section near the end of the spec titled "Cross-cutting caveats" with at least:
      - "Refresh is per-tab: a second tab open before a mutation in tab A shows stale data indefinitely; there is no `storage` event, no `visibilitychange` or `focus` refetch. Before escalating any stale-UI symptom, hard-reload every open tab."
      - "The same applies across devices — no server-push reconciliation exists."
- [ ] **S-2 — recovery paths for stale `this_week` tasks.** Verify whether there is a This Week page / Backlog page / search that still surfaces `state='this_week'` tasks regardless of the planning modal. If yes → list them. If no → state explicitly: "The weekly planning modal is the only user-facing view that should surface `this_week` tasks outside the Today view; when the filter excludes them, the user has no path to find them without direct DB access."
- [ ] **S-4 — fact-vs-hypothesis legend.** Add near the top (before Architecture primer): "In this document, bullets tagged ✓ are verified against the current code; bullets tagged ? are hypotheses pending the diagnostics in the final section." Tag every bullet in the Root-cause hypotheses sub-sections accordingly.
- [ ] **S-5 — `planning-complete` framing.** In the Mutation→view refresh section, rename "the de facto broadcast mechanism" to "the current broadcast mechanism" and move the question "should this remain planning-specific or be generalised?" into Open Questions.
- [ ] **Minor — remove hedge.** Delete the phrase "the cron body wraps everything in a single `try/catch` that could short-circuit earlier" from Bug #1. Orchestrator verified the real code uses two separate try blocks; the hedge is false.
- [ ] **Minor — diagnostic priority.** In the "Diagnostics to run before proposing fixes" section, promote step 4 (Vercel dashboard → Functions → Crons) to step 1. A "no recent invocations" dashboard reading distinguishes auth-rejection / routing-failure / missing-table / no-cron-configured cases that the DB-only diagnostic cannot.

## IMPLEMENTATION CHANGES REQUIRED

None. This is a discovery spec. Review findings do not include fix code; they include only spec edits and one security hypothesis that belongs in the spec.

## ASSUMPTIONS TO RESOLVE — ASK PETER

- [ ] **Time of day for the "Today stuck" observation** — morning or evening? Determines whether R-1 hypothesis (a) or (b) applies.
- [ ] **Is `state` independence from `due_date` intentional product semantics, or accidental implementation?** Affects whether a future fix should add an invariant or leave it as-is. (From SPEC-005.)
- [ ] **Does Peter use Planner across multiple tabs or devices regularly?** Affects how prominent the cross-tab caveat (S-3) should be in the spec.
- [ ] **Is `CRON_SECRET` set in Vercel production today?** Determines whether R-3c is a documented-but-dormant risk or an active vulnerability. (Peter can check with `vercel env ls production | grep CRON_SECRET`.)

## REPO CONVENTIONS TO PRESERVE

- Next.js 15 App Router + NextAuth.js v5 (not Supabase Auth).
- Writes go through `apiClient` → `/api/*` route handlers, not server actions. (Project `CLAUDE.md` is stale on this — see separate follow-up.)
- Microsoft Graph is the email transport, not Resend / SMTP.
- British English in all human-facing copy.
- Task-lifecycle is state-driven, not date-computed.

## SEPARATE FOLLOW-UP (not this spec)

- [ ] Update [`OJ-Planner2.0/CLAUDE.md`](../../CLAUDE.md): replace "Direct Supabase queries in components, not server actions" with the current pattern — "Client components call typed `apiClient` methods (in `src/lib/apiClient.js`) which POST to `/api/*` route handlers under `src/app/api/`". Low urgency, but it misleads every future review.

## RE-REVIEW REQUIRED AFTER FIXES

- [ ] Once spec revisions land, re-run `/codex-qa-review docs/superpowers/specs/2026-04-20-task-lifecycle-bugs-discovery.md`, but with an adjusted pack: override the default `docs/superpowers` exclusion and raise `FILE_LINE_CAP` so the full 368-line spec reaches the reviewers. Verify in particular that R-3, S-1, S-3 land cleanly.

## REVISION PROMPT (ready-to-use)

> Open [docs/superpowers/specs/2026-04-20-task-lifecycle-bugs-discovery.md](docs/superpowers/specs/2026-04-20-task-lifecycle-bugs-discovery.md) and [tasks/codex-qa-review/2026-04-20-task-lifecycle-bugs-discovery-adversarial-review.md](tasks/codex-qa-review/2026-04-20-task-lifecycle-bugs-discovery-adversarial-review.md). Apply every "SPEC REVISION REQUIRED" item from [tasks/codex-qa-review/2026-04-20-task-lifecycle-bugs-discovery-claude-handoff.md](tasks/codex-qa-review/2026-04-20-task-lifecycle-bugs-discovery-claude-handoff.md) in the priority order given (R-3a, R-3b, R-3c, R-1, R-2, S-1, S-3, S-2, S-4, S-5, then both Minor items). Do NOT propose fixes for the four bugs themselves — this remains a discovery spec. Before editing each section, re-read the verification already done so you don't re-research facts. After the edits, run the verification-pipeline (lint, typecheck, build) only if any non-markdown files were touched. Finally, propose re-running `/codex-qa-review` with wider pack scope for re-validation.
