# Customers: Implementation Plan

**Spec:** `docs/superpowers/specs/2026-09-01-customers-crm-design.md` (Revision 6)
**Review:** `docs/superpowers/reviews/2026-09-01-customers-crm-design-review.md`
**Branch:** `feat/customers-crm`
**Date started:** 2026-09-01

---

## How this is sequenced

Five phases. Each ends with `npm run lint && npm test && npm run build` passing and a commit. Migrations are written as files and validated, but **not pushed to the live database** and **not pushed to git**, because on this project a push to `main` is a production deploy. Those two actions are the user's.

Within a phase, work is ordered so the repository is never broken between commits.

**Legend:** `[ ]` not started, `[x]` done, `[!]` blocked or deferred with a note.

---

## Phase 0: Foundations

No user-visible change. Everything after this assumes a real transaction boundary and a closed PostgREST door.

- [x] **0.1** Migration: drop the permissive `USING (true)` policies on `projects` and `tasks`
- [x] **0.2** Remove the collection-level `PATCH` and `DELETE` from `src/app/api/projects/route.js`
- [x] **0.3** Add `src/lib/rpc.js`, the single helper every lifecycle RPC call goes through
- [x] **0.4** Migration: `fn_planner_rpc_guard` conventions, plus a worked example RPC and its `REVOKE`
- [x] **0.5** Correct the stale test count in `CLAUDE.md`, document the new invariants
- [x] **0.6** Tests for 0.2 and 0.3
- [x] **0.7** Verify and commit

## Phase 1: Customers, linkage and capture

- [x] **1.1** Shared `QuickTaskInput`, merging `AddTaskInput` and `QuickTaskList`. Fixes the `new Date()` timezone bug
- [x] **1.2** Migration: `customers`, `projects.customer_id`, `tasks.customer_id`, both triggers, same-owner constraints
- [x] **1.3** `src/lib/customerConstants.js` and validators
- [x] **1.4** `src/services/customerService.js`
- [x] **1.5** `/api/customers` routes: collection, `[id]`, `overview`, `impact`
- [x] **1.6** `apiClient` methods
- [x] **1.7** `/customers` page: `CustomersView`, `CustomerSidebar`, `CustomerWorkspace`, `CustomerDashboard`
- [x] **1.8** Customer picker on `CreateProjectModal` and `ProjectWorkspace`
- [x] **1.9** Sidebar nav entry, `/api/areas` extension
- [x] **1.10** `parseQuickTask` with customer resolution and the token grammar
- [x] **1.11** `create_task_with_customer` RPC and the `customer_name` path on `POST /api/tasks`
- [x] **1.12** Office 365 `buildListDisplayName` with ambiguity-safe adoption
- [x] **1.13** Stakeholder triage (Customer and Skip halves) and bulk project assignment. The Person half needs `contacts`, so it lands in Phase 2 on the same screen
- [x] **1.14** Tests
- [x] **1.15** Verify and commit

## Phase 2: The record, and nothing lost

- [ ] **2.1** Migration: notes columns with the `occurred_at` backfill, `customer_facts`, `contacts`, `project_contacts`, task lifecycle provenance and its backfill, `notes.project_id` to `SET NULL`
- [ ] **2.2** Migration: the lifecycle RPCs
- [ ] **2.3** `projectLifecycleService` rewritten to call the RPCs
- [ ] **2.4** Notes API: `PATCH`/`DELETE`, new fields, unfiled
- [ ] **2.5** Facts and contacts APIs
- [ ] **2.6** Timeline endpoint
- [ ] **2.7** `ProjectNotes` widened query, textarea, edit and delete
- [ ] **2.8** Close-out step in `ProjectStatusChangeModal`
- [ ] **2.9** Rewritten `ProjectDeleteModal` and impact
- [ ] **2.10** Customer workspace: facts, contacts, timeline, unfiled panel
- [ ] **2.11** Tests
- [ ] **2.12** Verify and commit

## Phase 3: Attachments

- [ ] **3.1** Spike: signed upload round trip against the live project
- [ ] **3.2** Migration: `attachments` with lifecycle states
- [ ] **3.3** `src/services/attachmentService.js`
- [ ] **3.4** Attachment routes
- [ ] **3.5** Extend the lifecycle RPCs to cover files
- [ ] **3.6** Upload and file list UI
- [ ] **3.7** Reconciliation cron
- [ ] **3.8** Tests, verify and commit

## Phase 4: Find, report, tidy up

- [ ] **4.1** Migration: search indexes, completion attribution columns
- [ ] **4.2** `/api/search` and the search box
- [ ] **4.3** Completed report grouped by customer
- [ ] **4.4** Migration: archive and drop `stakeholders`
- [ ] **4.5** Tests, verify and commit

---

## Invariants to hold throughout

1. `tasks.customer_id` is app-writable only when `project_id IS NULL`. The trigger owns it otherwise.
2. `completed_at`, `cancelled_at`, `entered_state_at`, `completed_customer_id` and `completed_customer_name` are trigger-owned. Never written by app code.
3. `lifecycle_move_id` is cleared by any user edit. Only the RPCs set it.
4. Every new route: NextAuth session, then an explicit `user_id` ownership check.
5. New tables get per-user RLS only. Never `USING (true)`.
6. Every lifecycle RPC: `SECURITY DEFINER`, `SET search_path = public`, internal `user_id` check, `REVOKE EXECUTE` from `public`, `anon`, `authenticated`.
7. No raw `new Date()` for user-facing dates. `getLondonDateKey()` and `dateUtils`.
8. No em dashes anywhere.

## Progress log

**Phase 0 complete** (`db28380`). Permissive RLS policies dropped, duplicate
project mutation routes removed, `src/lib/rpc.js` and `fn_assert_project_owner`
established the RPC pattern, stale test count in `CLAUDE.md` corrected.

**Phase 1 complete.** Five commits:

| Commit | What |
|---|---|
| `4d95436` | One shared `QuickTaskInput`. Project page gains natural-language due dates, and a live machine-local `new Date()` timezone bug is fixed |
| `d52a116` | `customers`, `projects.customer_id`, `tasks.customer_id`, both triggers, composite same-owner keys, `/customers` page, pickers, nav |
| `b6649cc` | `@Name` and `for Name` capture, `create_task_with_customer` RPC |
| `0cc5fa1` | Office 365 "Customer: Project" naming with ambiguity-safe adoption |
| `c0822e7` | Stakeholder triage and bulk project assignment |

Verification at the end of Phase 1: lint clean, **567 tests passing** (up from
432 at the start), production build succeeds.

**Validated against the live database** inside a rolled-back transaction, before
any of it was relied on: the composite foreign key nulls `customer_id` while
leaving `user_id` intact, `fn_task_customer_sync` makes a project's task inherit
the project's customer and leaves a project-less task's own customer alone,
`fn_project_customer_cascade` repoints on reassignment, a task survives its
project being deleted with its customer intact, the case-insensitive name index
rejects "acme" against "Acme", and `create_task_with_customer` creates once then
reuses on the race path. Confirmed afterwards that 148 projects and 593 tasks
were unchanged and nothing was left behind.

**Live data sizing:** 209 stakeholder entries, 74 distinct names, 0 blanks, 0
entries with embedded commas, 0 email-like entries, 22 open projects.

### Not yet applied

Migrations are written but **not pushed**, and nothing is pushed to git. On this
project a push to `main` is a production deploy, so both are the user's call:

- `20260901000001_phase0_foundations.sql`
- `20260901000002_phase1_customers.sql`
- `20260901000003_phase1_task_customer_rpc.sql`
