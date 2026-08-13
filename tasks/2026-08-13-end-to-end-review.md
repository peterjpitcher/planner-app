# Planner 2.0 end-to-end review

Date: 2026-08-13
Scope: whole app (159 source files, 42 API routes, 28 migrations)
Baseline: `npm run lint` clean, `npm test` 273/273 pass, `npm run build` succeeds.

Nothing here is a broken build. Every finding is behaviour: things the app does that it should not, or does not do that it should.

## Status after the fix pass (same day)

| # | Finding | Status |
|---|---------|--------|
| 1 | No confirmation or task handling on close | **Fixed** |
| 2 | Cancelled-project tasks stay live everywhere | **Fixed** |
| 3 | Office 365 disagreement | **Fixed** (app now matches O365) |
| 4 | Project delete destroys notes silently | **Fixed** (warned, FK unchanged) |
| 5 | Silent mutation failures on /projects | **Partly fixed**: close and delete now surface errors, the other four handlers still revert silently |
| 6 | Inconsistent error surfaces | Open |
| 7 | Dead code | **Fixed** (16 files removed) |
| 8 | CLAUDE.md wrong | **Fixed** |
| 9 | Minor (double redirect, `next lint`, RLS policies) | Open |

Verification after changes: lint clean, 289/289 tests pass (16 new), build succeeds.

### What changed

- `20260813000001_task_cancelled_state.sql`: adds the `cancelled` task state, a `cancelled_at`
  column owned by `fn_task_state_cleanup`, and a `(project_id, state)` index.
- `CLOSED_STATES` / `closedStatesFilter()` in `src/lib/constants.js`: single source of truth for
  "finished work". Replaced 13 scattered denylists that would each have leaked the new state.
- `src/services/projectLifecycleService.js`: the close/reopen cascade and the delete-impact counts.
- `PATCH /api/projects/[id]`: runs the cascade server-side, and now fails loudly if the cascade
  fails rather than reporting success on a half-applied change.
- `GET /api/projects/[id]/impact`: backs the dialogs with the real task list and note count.
- `ProjectStatusChangeModal` and `ProjectDeleteModal` replace the dead modal and the `window.confirm`.

### Decisions taken

- Cancelling a project cancels its open tasks (not "unassign"), matching what Office 365 already did.
- Cancelled tasks get their own terminal state rather than reusing `done`, so the completed report and
  monthly numbers are not inflated by abandoned work.
- Reopening a cancelled project restores its tasks to **backlog**, not their original state. The
  original is not recorded, and backlog forces an explicit decision before anything reaches Today.
- Reopening a *completed* project leaves its tasks done, since that work genuinely finished.
- The `notes.project_id` FK is unchanged: the delete now warns about note loss rather than silently
  changing long-standing delete behaviour.

---

## P1: data and trust

### 1. Cancelling or completing a project asks nothing and does nothing to its tasks

**This is the issue you reported, and it is worse than "no prompt": the prompt exists but is unreachable.**

The only status control in the live app is a plain `<select>` in
[ProjectWorkspace.jsx:152](src/components/Projects/ProjectWorkspace.jsx:152):

```js
onChange={(e) => onUpdateProject(project.id, { status: e.target.value })}
```

Picking "Cancelled" or "Completed" fires straight to `PATCH /api/projects/[id]`. No confirmation, no task list, no task changes.

There *is* a `ProjectCompletionModal` that counts open tasks and offers "complete tasks and project". It is dead code. It is imported only by `ProjectItem.js`, and nothing imports `ProjectItem.js` (`/dashboard` is now a redirect to `/today`). Even when it was live it only ever fired on `Completed`, never on `Cancelled`, and it showed a count, never the task names.

The API does not compensate: [projects/[id]/route.js:88](src/app/api/projects/[id]/route.js:88) writes the new status and stops.

**Fix direction:** confirmation dialog on the live path for both `Completed` and `Cancelled`, listing the open tasks by name, with an explicit choice for what happens to them (complete / cancel / unassign / leave). Back it with a server-side cascade so the API is correct regardless of which client calls it.

### 2. Tasks from cancelled and completed projects stay live everywhere

No task query anywhere in the app filters by parent project status. Verified across `taskService`, `autopilotService`, `dailyTaskEmailService`, `projectRadarService`, `/api/tasks`, and `/api/planning-candidates`.

So after cancelling a project, its open tasks still appear in Today, the Plan board, backlog, planning candidates, the autopilot pool, and the daily digest email. Meanwhile [projects/route.js:73](src/app/api/projects/route.js:73) hides the project itself from the project list. The task shows a project name you can no longer navigate to.

This is the mechanism behind item 1. Even with a good prompt, the tasks need somewhere to go.

### 3. Office 365 already disagrees with the app

`office365SyncService` has the concept the rest of the app lacks:

```js
function isProjectActive(status) { ... 'open' || 'in progress' || 'on hold' }
```

At [office365SyncService.js:1392](src/services/office365SyncService.js:1392) and [:1464](src/services/office365SyncService.js:1464), a project that leaves active status has its remote list and mirrored tasks **deleted from Office 365**.

So cancelling a project today already removes those tasks from your Microsoft To Do, while leaving them in Planner. The two systems actively disagree, and O365 has the behaviour you actually want.

### 4. Deleting a project permanently destroys all its project notes

`tasks.project_id` was changed to `ON DELETE SET NULL` in `20260404000001_prioritisation_replacement.sql`, so tasks correctly survive as unassigned. `notes.project_id` was **not** changed and is still `ON DELETE CASCADE` from the initial schema.

Deleting a project silently and irreversibly deletes every note attached to it. Neither confirmation dialog mentions notes:

- [ProjectWorkspace.jsx:181](src/components/Projects/ProjectWorkspace.jsx:181) (live): "Delete this project? Tasks will become unassigned." Correct on tasks, silent on notes.
- [ProjectItem.js:189](src/components/Projects/ProjectItem.js:189) (dead): "delete project ... and all its tasks" is now false, tasks survive.

Both API comments ("cascade will handle related tasks and notes", [projects/route.js:263](src/app/api/projects/route.js:263), [projects/[id]/route.js:157](src/app/api/projects/[id]/route.js:157)) are stale for tasks and correct only for notes.

---

## P2: feedback and consistency

### 5. Every mutation on /projects fails silently

Six handlers in `ProjectsView.jsx` (lines 248, 258, 312, 336, 386, 403) follow the same shape:

```js
} catch {
  loadData({ silent: true }); // Revert on failure without a skeleton flash
}
```

A failed save produces no message. The edit optimistically applies, then quietly snaps back. From the user's side that is indistinguishable from the app ignoring the click, and it is the screen where renames, status changes and deletes happen.

### 6. Error surfaces are inconsistent across the app

Today and Calendar use blocking `window.alert()` for failures (15 sites). Projects is silent. Plan and Today treat some failures as "non-critical, ignore". There is no toast system despite `UI_CONSTANTS.TOAST_DURATION` existing in constants.

---

## P3: hygiene

### 7. ~3,100 lines of dead code across 16 files

Unreachable from any page, route or middleware:

`Auth/SessionDebug.js`, `Notes/AddNoteForm.js`, `Notes/ProjectNoteWorkspaceModal.js`, `Projects/AddProjectForm.js`, `Projects/AddProjectModal.js`, `Projects/ProjectCompletionModal.js`, `Projects/ProjectHeader.jsx`, `Projects/ProjectItem.js`, `Tasks/TaskItem.js`, `dashboard/MetricsBar.jsx`, `dashboard/SidebarFilters.jsx`, `ui/EmptyStates.js`, `lib/projectHelpers.js`, `lib/supabaseClient.js`, `lib/supabaseRequest.js`, `lib/supabaseServer.js`

This is what let finding 1 hide: the completion prompt looks implemented when you grep for it.

### 8. CLAUDE.md is substantially wrong

It describes "~50 files" (actually 159), "no test suite" (20 files, 273 tests), "direct Supabase queries in components, no server actions" (the app is API-route based), and lists `src/lib/supabaseClient.js` and `src/components/Projects/ProjectBoard.tsx` as key files. The first is dead code, the second does not exist. It also omits ideas, journal, calendar, planning, autopilot, Office 365 and the AI planner entirely.

### 9. Minor

- `/` redirects to `/dashboard`, which redirects to `/today`. One wasted hop on every login. Point `/` at `/today`.
- `next lint` is deprecated and breaks on Next.js 16.
- RLS policies on `projects` and `tasks` are `USING (true) WITH CHECK (true)`. Harmless today because every route uses the service-role client and checks ownership in code (verified across all 42 routes, no gaps found), but the policies offer no defence in depth if an anon-key client is ever reintroduced.

---

## What I checked and found clean

- Auth on all 42 API routes. No unguarded endpoints.
- Ownership checks on every user-scoped mutation, including the ones where it lives in the service layer rather than the route.
- `admin/migrate` and `debug-env` are correctly gated behind `isDevelopment() && isAdminSession()`.
- Pagination in `apiClient.getAllTasks` / `getAllProjects` correctly follows `hasMore`, no silent truncation at 200.
- `ProjectsView.loadData` is 2 parallel calls, no N+1.
- Cron routes are secret-guarded.
