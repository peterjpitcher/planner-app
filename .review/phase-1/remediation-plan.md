# Remediation Plan — Planner2.0

## Priority Order

### BATCH 1 — Critical Security (Fix immediately, minimal risk)

**DEF-001: Fix inverted auth check on debug/admin endpoints**
Files: `debug-env/route.js`, `admin/migrate/route.js`, `auth/debug-session/route.js`
Change: `!isDevelopment() && !isAdminSession(session)` → `!isDevelopment() || !isAdminSession(session)`
Risk: None — makes endpoints MORE restrictive
Effort: Trivial (3 one-line changes)

**DEF-004: Remove console.log from supabaseClient.js**
File: `src/lib/supabaseClient.js:16`
Change: Delete the log line
Risk: None
Effort: Trivial

**DEF-002: Extract hardcoded domain to env var**
File: `src/app/api/auth/[...nextauth]/route.js:28`
Change: Replace hardcoded URL with `process.env.PRODUCTION_URL`; document in .env.example
Risk: Low (requires env var to be set on Vercel)
Effort: Small

---

### BATCH 2 — Structural Safety (Fix this week)

**DEF-003: Swap order of Office365 delete and DB delete**
Files: `projects/route.js`, `projects/[id]/route.js`
Change: Do DB delete first, then attempt O365 cleanup (best-effort). If DB delete fails, nothing has been touched in O365. If O365 cleanup fails after DB delete, log it and let next sync clean up.
Risk: Low — O365 cleanup can fail gracefully; orphaned O365 lists are recoverable
Effort: Small

**DEF-009: Remove silent default due date**
File: `src/services/taskService.js:112-114`
Change: Remove the `due_date = today` default. Let due_date be null unless explicitly provided.
Risk: Medium — must check all callers to ensure they handle null due dates in UI
Effort: Medium (verify UI handles null gracefully)

**DEF-010: Unify task sort order**
Files: `src/services/dailyTaskEmailService.js`, `src/lib/taskSort.js`
Change: Use same tie-breaking logic (pick one: priority or created_at) in both places
Risk: Low
Effort: Small

---

### BATCH 3 — Infrastructure (Plan and schedule)

**DEF-005: Replace in-memory rate limiter with persistent store**
Options: Upstash Redis (recommended for Vercel), or Supabase-backed rate limit table
Risk: Medium — requires new dependency/infrastructure
Effort: Medium

**DEF-006: Add unique constraints to Office365 mapping tables**
SQL migrations needed:
```sql
ALTER TABLE office365_project_lists ADD CONSTRAINT unique_user_project UNIQUE (user_id, project_id);
ALTER TABLE office365_task_items ADD CONSTRAINT unique_user_task UNIQUE (user_id, task_id);
```
Risk: Low if no existing duplicates; run dedup first
Effort: Small (migration + verify no existing violations)

**DEF-008: Enforce CRON_SECRET in production**
File: `src/app/api/cron/daily-task-email/route.js`, `office365-sync/route.js`
Change: If production and CRON_SECRET not set, log a startup warning. Add documentation.
Risk: None
Effort: Small

---

### BATCH 4 — Technical Debt (Background)

- TD-001: Done in BATCH 1 (console.log removal)
- TD-002: Document race condition in code comment; acceptable for single-user app
- TD-003: Defer — hardcoded timezone is acceptable for single-user UK-based app
- TD-004: Acceptable — non-transactional touch is low risk
- TD-005: Add Vitest; write tests for taskService and validators at minimum
- TD-006: Add trim + format validation to admin email list parsing
- TD-007: Done as part of DEF-002 fix

---

## Files Modified Per Batch

### BATCH 1 (4 files, ~10 lines total)
1. `src/app/api/debug-env/route.js`
2. `src/app/api/admin/migrate/route.js`
3. `src/app/api/auth/debug-session/route.js`
4. `src/lib/supabaseClient.js`
5. `src/app/api/auth/[...nextauth]/route.js`

### BATCH 2 (4 files, ~30 lines)
1. `src/app/api/projects/route.js`
2. `src/app/api/projects/[id]/route.js`
3. `src/services/taskService.js`
4. `src/services/dailyTaskEmailService.js` (or `src/lib/taskSort.js`)

### BATCH 3 (separate planning required)
- New dependency or infrastructure decision needed for rate limiter
- DB migrations for unique constraints
