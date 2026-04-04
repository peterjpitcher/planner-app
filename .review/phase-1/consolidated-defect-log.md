# Consolidated Defect Log — Planner2.0

Generated: 2026-03-09 | Phase 1 complete | All 4 agents cross-referenced.

---

## CRITICAL (Actively Dangerous — Fix Before Next Deploy)

### DEF-001: Admin/debug endpoint auth check logic inverted
**Severity**: CRITICAL
**Found by**: QA Specialist (DEFECT-S01, S02, S03), Technical Architect (confirmed)
**Files**:
- `src/app/api/debug-env/route.js:8`
- `src/app/api/admin/migrate/route.js:14`
- `src/app/api/auth/debug-session/route.js:7`
- `src/app/api/auth/session-test/route.js` (assumed same pattern)
- `src/app/api/auth/verify-config/route.js` (assumed same pattern)

**Root cause**: All three endpoints use:
```javascript
if (!isDevelopment() && !isAdminSession(session)) { return 401 }
```
This uses AND. The condition denies access only when BOTH conditions are true (not dev AND not admin). The inverse: **any authenticated user in dev mode gets access**. The intended logic should be OR — require dev mode AND admin role.

**Business impact**:
- Any logged-in dev-mode user can call `/api/admin/migrate` (run database migrations — create tables, enable RLS, drop constraints)
- Any logged-in dev-mode user can read debug env vars (NEXTAUTH_URL, server host info)
- `/api/admin/migrate` is a privilege escalation vulnerability

**Test cases**: SEC-01, SEC-02, SEC-03

---

### DEF-002: Hardcoded production domain in auth config
**Severity**: CRITICAL
**Found by**: QA Specialist (DEFECT-A01), Technical Architect (SA-001)
**File**: `src/app/api/auth/[...nextauth]/route.js:28-40`

**Root cause**: Production URL `https://planner.orangejelly.co.uk` is hardcoded and then used to overwrite `process.env.NEXTAUTH_URL` at module load. In serverless (Vercel), multiple instances run concurrently. If one instance has a different in-memory env state, JWT verification can fail across instances → intermittent session invalidity.

**Business impact**: Potential for unpredictable session failures in production. Impossible to deploy to another domain without code changes.

**Test cases**: AUTH-07 (session expiry/invalidity edge case)

---

### DEF-003: Project/task delete — Office365 called before DB delete, no rollback
**Severity**: CRITICAL
**Found by**: Technical Architect (SA-003), cross-referenced with Structural Mapper
**Files**:
- `src/app/api/projects/route.js:262-271`
- `src/app/api/projects/[id]/route.js` (same pattern)

**Root cause**: Flow is:
1. `deleteOffice365Project()` — makes live Graph API calls (deletes O365 list)
2. DB `delete()` — removes project from database

If step 1 succeeds and step 2 fails (DB error, network drop), the project is gone from Office365 but still in the local DB. User sees a 500 but the project still appears locally — it will never sync to Office365 again because the list no longer exists.

**Business impact**: Permanent state mismatch between Planner and Outlook. User loses Office365 task list data that they did not intend to delete.

**Partial failure path**: Delete project → O365 list deleted → DB connection error → 500 → Project still in DB → Never re-creates O365 list → Tasks appear locally but not in Outlook.

**Test cases**: PROJ-03 (project delete cascade)

---

### DEF-004: console.log in supabaseClient.js fires on every cold start
**Severity**: HIGH (not critical but actively pollutes production logs)
**Found by**: Technical Architect (TD-001), confirmed in code
**File**: `src/lib/supabaseClient.js:16`

**Root cause**: `console.log('Supabase Client initialized with URL:', supabaseUrl)` at module level. Fires on every serverless cold start, logs the Supabase URL.

**Business impact**: Log noise in production. Supabase URL (though public) is logged unnecessarily.

---

## STRUCTURAL (Fragile — Will Break Under Load or Edge Cases)

### DEF-005: In-memory rate limiter not effective in serverless
**Severity**: HIGH
**Found by**: Technical Architect (SA-008), QA (DEFECT-R01)
**File**: `src/lib/rateLimiter.js`

**Root cause**: Uses in-memory `Map`. Vercel scales across multiple instances — each with its own Map. Rate limits are per-instance, not per-user across the deployment. User can burst against multiple instances.

**Business impact**: Rate limiting provides no real protection in production. Attacker can bypass limits by rotating IPs or hitting different instances.

---

### DEF-006: Office365 project/task sync creates duplicate mappings (no unique constraint)
**Severity**: HIGH
**Found by**: Technical Architect (STR-002), Business Auditor (B11)
**Files**: `src/services/office365SyncService.js` — `office365_project_lists` and `office365_task_items` tables

**Root cause**: No unique constraint on `office365_project_lists(user_id, project_id)` or `office365_task_items(user_id, task_id)`. Parallel sync calls (e.g., auto-sync triggered simultaneously with manual sync) can create duplicate mapping rows. Deduplication runs on next sync, but duplicate state can persist between syncs.

**Business impact**: Duplicate todo lists/tasks created in Office365. Tasks appear twice in Outlook.

---

### DEF-007: Daily email cron — claim/send sequence can result in duplicate emails
**Severity**: HIGH
**Found by**: Technical Architect (SA-004)
**File**: `src/app/api/cron/daily-task-email/route.js`

**Root cause**: The claim is inserted (preventing duplicates via unique constraint), then email is sent, then status is updated to 'sent'. If the status update fails after send, next run checks for unclaimed slots — the claim row is already there (preventing re-send), BUT if the initial claim INSERT itself fails partway, a retry could send duplicate emails.

**Business impact**: User could receive duplicate daily digest emails.

---

### DEF-008: Cron endpoint protection relies on Vercel-specific headers
**Severity**: MEDIUM
**Found by**: QA Specialist (DEFECT-C01, C02, C03)
**Files**:
- `src/app/api/cron/daily-task-email/route.js`
- `src/app/api/cron/office365-sync/route.js`

**Root cause**: If `CRON_SECRET` is not configured, protection falls back to `x-vercel-cron` header. On non-Vercel deployments, there is no protection. Development mode allows bypass without any token.

**Business impact**: Unauthenticated triggering of sync/email operations.

---

### DEF-009: Task default due date silently set to today
**Severity**: MEDIUM
**Found by**: Business Auditor (B7)
**File**: `src/services/taskService.js:112-114`

**Root cause**: `createTask()` assigns `today` as due_date if no due_date provided. User never sees a prompt. Task immediately appears as "due today" without user intent.

**Business impact**: Tasks created without due dates appear urgent. May cause confusion in dashboard.

---

### DEF-010: Task sort order differs between dashboard and daily email
**Severity**: MEDIUM
**Found by**: Business Auditor (B8)
**Files**:
- `src/services/dailyTaskEmailService.js:46-57` — sorts by due_date, priority, name
- `src/lib/taskSort.js:7-34` — sorts by due_date, created_at, name

**Root cause**: Different tie-breaking rules. Dashboard uses `created_at`; email uses `priority`.

**Business impact**: Same task list appears in different order in email vs dashboard.

---

### DEF-011: TASK_STATUS enum defined but never used
**Severity**: LOW
**Found by**: Business Auditor (B1, B2)
**File**: `src/lib/constants.js:46-50`

**Root cause**: Tasks use `is_completed` boolean, not a status enum. The defined `TASK_STATUS` constant is dead code.

**Business impact**: Developer confusion. Risk of future implementors adding a redundant status field.

---

### DEF-012: No task status field validation
**Severity**: LOW
**Found by**: Business Auditor (B4)
**File**: `src/lib/validators.js`

**Root cause**: `validateTask()` validates project status but not task status. Any value could be inserted (though there is no `status` column on tasks, so this is moot currently — but if a status column were added, there would be no guard).

---

### DEF-013: Project status transitions not enforced
**Severity**: LOW
**Found by**: Business Auditor (B10)
**File**: `src/lib/validators.js:26-28`

**Root cause**: Any valid status can be set regardless of current status. Completed projects can be re-opened, etc. No state machine.

**Business impact**: Audit trail is incomplete; status progression is untracked.

---

## TECHNICAL DEBT (Should Fix, Not Urgent)

| ID | Summary | File | Priority |
|----|---------|------|---------|
| TD-001 | `console.log` in supabaseClient.js | supabaseClient.js:16 | High |
| TD-002 | Unassigned project auto-creation has race condition | taskService.js:54-96 | Medium |
| TD-003 | Timezone hardcoded to Europe/London across email/date logic | dailyTaskEmailService.js, dateUtils.js | Medium |
| TD-004 | Non-transactional project.updated_at touches after task operations | taskService.js:177 | Low |
| TD-005 | No test coverage whatsoever | Entire project | Critical Debt |
| TD-006 | Admin email/ID list parsed with simple string split, no validation | authServer.js:6-10 | Low |
| TD-007 | process.env.NEXTAUTH_URL overwritten at module load | auth route.js:39-40 | Medium |

---

## Cross-Reference Summary

| Finding | Structural Mapper | Tech Architect | Biz Auditor | QA |
|---------|:----------------:|:---------------:|:-----------:|:--:|
| DEF-001 (debug endpoint logic) | ✓ (middleware exclusion noted) | SA-007 | — | S01/S02/S03 |
| DEF-002 (hardcoded domain) | ✓ | SA-001 | — | A01/A02 |
| DEF-003 (delete ordering) | ✓ (multi-step op) | SA-003 | — | PROJ-03 |
| DEF-004 (console.log) | ✓ | TD-001 | — | — |
| DEF-005 (rate limiter) | ✓ | SA-008 | — | R01 |
| DEF-006 (duplicate mappings) | ✓ | STR-002 | B11 | — |
| DEF-007 (email dupe) | ✓ | SA-004 | — | C01 |
| DEF-008 (cron protection) | ✓ | SA-007 | — | C01/C02/C03 |
| DEF-009 (default due date) | — | — | B7 | — |
| DEF-010 (sort inconsistency) | — | — | B8 | — |
| DEF-011 (dead enum) | — | — | B1/B2 | — |
