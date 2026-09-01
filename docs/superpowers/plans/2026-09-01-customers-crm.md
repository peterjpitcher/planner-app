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

- [x] **2.1** Migration: notes columns with the `occurred_at` backfill, `customer_facts`, `contacts`, `project_contacts`, task lifecycle provenance and its backfill, `notes.project_id` to `SET NULL`
- [x] **2.2** Migration: the lifecycle RPCs
- [x] **2.3** `projectLifecycleService` rewritten to call the RPCs
- [x] **2.4** Notes API: `PATCH`/`DELETE`, new fields, unfiled
- [x] **2.5** Facts and contacts APIs
- [x] **2.6** Timeline endpoint
- [x] **2.7** `ProjectNotes` widened query, textarea, edit and delete
- [x] **2.8** Close-out step in `ProjectStatusChangeModal`
- [x] **2.9** Rewritten `ProjectDeleteModal` and impact
- [x] **2.10** Customer workspace: facts, contacts, timeline, unfiled panel
- [x] **2.11** Tests
- [x] **2.12** Verify and commit

## Phase 3: Attachments

- [x] **3.1** Spike: signed upload round trip against the live project
- [x] **3.2** Migration: `attachments` with lifecycle states
- [x] **3.3** `src/services/attachmentService.js`
- [x] **3.4** Attachment routes
- [x] **3.5** Extend the lifecycle RPCs to cover files
- [x] **3.6** Upload and file list UI
- [x] **3.7** Reconciliation cron
- [x] **3.8** Tests, verify and commit

## Phase 4: Find, report, tidy up

- [x] **4.1** Migration: search indexes, completion attribution columns
- [x] **4.2** `/api/search` and the search box
- [x] **4.3** Completed report grouped by customer
- [x] **4.4** Migration: archive and drop `stakeholders`
- [x] **4.5** Tests, verify and commit

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

**All phases complete.** Lint clean, **653 tests passing** (from 432 at the
start), production build succeeds.

| Commit | Phase |
|---|---|
| `db28380` | 0, foundations |
| `4d95436` | 1, one task input |
| `d52a116` | 1, customers and linkage |
| `b6649cc` | 1, capture token |
| `0cc5fa1` | 1, Office 365 naming |
| `c0822e7` | 1, stakeholder triage |
| `f578d1e` | 2, database layer |
| `6dab306` | 2, the record |
| `3f3bdbe` | 3, attachments |
| `8d20783` | 4, search, attribution, drop |

**Phase 2 database layer.**

Verified against the live database inside a rolled-back transaction:

- The `occurred_at` backfill leaves all **273 notes** with `occurred_at =
  created_at`, and **no** historical note stamped with today's date. Without the
  backfill every one of them would have claimed to happen at deploy time,
  because the timeline sorts on that column.
- A note with two parents is rejected; a note with none is legal (unfiled).
- Deleting a project no longer destroys its notes: the note survives with
  `project_id` nulled.
- The reopen backfill stamps **28** already-cancelled tasks, so existing closed
  projects keep behaving exactly as they do now.
- `close_project` cascades only live tasks (1 of 2, correctly leaving a
  hand-cancelled one alone), moves both project notes onto the customer, writes
  the pinned close-out note, and is idempotent on a second call.
- `reopen_project` restores the cascaded task and **not** the hand-cancelled
  one. That is the pre-existing bug fixed and proven.
- A note deliberately re-filed while the project was closed is not yanked back,
  and the close-out note stays with the customer.

**Phase 4 verified** against the live database, rolled back: the generated
tsvector indexes all 271 notes; a task is not attributed while open, is
attributed on completion, and neither renaming the customer nor moving the task
afterwards rewrites that history. Confirmed afterwards that 148 projects, 593
tasks and 271 notes were unchanged and `stakeholders` was still intact.

### Not yet applied

Migrations are written but **not pushed**, and nothing is pushed to git. On this
project a push to `main` is a production deploy, so both are the user's call:

- `20260901000001_phase0_foundations.sql`
- `20260901000002_phase1_customers.sql`
- `20260901000003_phase1_task_customer_rpc.sql`
- `20260901000004_phase2_record.sql`
- `20260901000005_phase2_lifecycle_rpcs.sql`
- `20260901000006_phase3_attachments.sql`
- `20260901000007_phase3_lifecycle_files.sql`
- `20260901000008_phase4_search_and_reporting.sql`
- `20260901000009_phase4_drop_stakeholders.sql` **run this one last, and only
  after working through `/customers/setup`.** It refuses to run while any
  stakeholder name is untriaged, and archives the raw arrays before dropping
  the column.

One live check is still worth doing after deploy, because reading the client
cannot prove server configuration: upload a file, download it, delete it. That
confirms the bucket exists with the right size and MIME limits and that a signed
download URL comes back with the forced filename.
