# Outlook ⇄ Planner Sync Operations Guide

This document explains how the Outlook (Microsoft To Do) integration is configured, how data flows between systems, and what steps to follow when diagnosing or maintaining the sync. It is written for engineers/consultants who do **not** have direct access to the source code.

---

## 1. High-Level Architecture

```
Planner Web App  ──► Next.js API routes (Vercel) ──► Microsoft Graph (To Do lists & tasks)
        ▲                     │
        │                     ▼
   Supabase DB ◄───────── Sync worker (Queue processor)
        ▲                     │
        │                     ▼
 GitHub Actions (cron) ───► /api/integrations/outlook/sync
```

1. Users connect their Outlook account through an OAuth flow (`/api/integrations/outlook/authorize` → Microsoft consent → `/api/integrations/outlook/callback`).
2. The callback exchanges the code for tokens, stores credentials in Supabase (refresh tokens in Supabase Vault, other metadata in regular tables), seeds/links Planner projects to To Do lists, and enqueues an initial `full_sync` job.
3. Sync jobs are stored in `task_sync_jobs`. The worker (`/api/integrations/outlook/sync`) processes up to N pending jobs each run, calling Microsoft Graph to create/update/delete tasks as required.
4. Microsoft change notifications hit `/api/integrations/outlook/webhook`, which de-duplicates by user and enqueues at most one `full_sync` job per user.
5. Subscriptions (webhook renewals) and worker execution are triggered every 2 minutes / 30 minutes respectively via a GitHub Actions workflow (`.github/workflows/outlook-sync.yml`).
6. Operational status is exposed via `/api/integrations/outlook/health`, which returns queue metrics, connection counts, and warnings.

---

## 2. Microsoft Azure App Requirements

| Setting | Value |
| --- | --- |
| Platform | Web |
| Redirect URI | `https://<production-domain>/api/integrations/outlook/callback` (and the equivalent localhost URI for development) |
| Permissions (delegated) | `Tasks.ReadWrite`, `offline_access`, `User.Read`, `email`, `openid`, `profile` |
| Webhook URL | `https://planner.orangejelly.co.uk/api/integrations/outlook/webhook` |

After changing scopes in Azure, the end user must re-consent so that the refresh token contains the new permissions.

---

## 3. Environment Variables

These must be populated in Vercel (production) and in `.env.local` for local work:

| Variable | Purpose |
| --- | --- |
| `NEXTAUTH_SECRET`, `NEXTAUTH_URL` | Required by NextAuth for session handling. |
| `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID` | Azure AD app credentials. `MICROSOFT_TENANT_ID` defaults to `common`. |
| `OUTLOOK_WEBHOOK_URL` | Absolute URL for incoming Microsoft webhook notifications. |
| `OUTLOOK_SYNC_JOB_SECRET` | Shared secret used by GitHub Actions and health checks. |
| `OUTLOOK_CLIENT_STATE` | Optional webhook guard; subscriptions include it when supported, but webhook also falls back to subscription ID checks if Microsoft omits the value. |
| `OUTLOOK_SUBSCRIPTION_DURATION_MIN`, `OUTLOOK_RENEW_BEFORE_MIN` | Controls webhook subscription lifetime/renewal cadence. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase anonymous credentials (browser). |
| `SUPABASE_SERVICE_KEY` | Supabase service-role key (server-side). |

---

## 4. Supabase Schema Overview

Key tables created by the `20250910`–`20251029` migrations:

| Table | Purpose | Notable columns |
| --- | --- | --- |
| `outlook_connections` | Stores per-user connection metadata. | `microsoft_account_id`, `planner_list_id`, `refresh_token_secret` (UUID pointing to Supabase Vault), `access_token`, `access_token_expires_at`, `delta_token`, `subscription_id`, `subscription_expiration`. |
| `project_outlook_lists` | Maps Planner projects to To Do lists. | `graph_list_id`, `graph_list_name`, `is_active`, `subscription_id`, `subscription_expires_at`, `delta_token`. Unique per project and per Graph list. |
| `task_sync_state` | Tracks mapping between local task IDs and Graph task IDs. | `graph_task_id`, `graph_list_id`, `graph_etag`, `last_sync_direction`. |
| `task_sync_jobs` | Queue backing the worker. | `action` (`create`, `update`, `delete`, `full_sync`), `status`, `attempts`, `last_error`, `scheduled_at`. Partial unique index ensures at most one active `full_sync` per user. |

Other relevant pieces:

* Supabase Vault functions (`public.vault_create_secret`, `public.vault_update_secret`, `public.vault_get_secret`) are used indirectly to store refresh tokens; the migrations enabling `pgsodium`/Vault must already be applied.
* Triggers keep `updated_at` current across all tables.
* RLS policies allow end users to operate on their own records, while the service-role key is used for worker/admin operations.

Partial unique index to ensure only one active full sync per user:

```sql
create unique index task_sync_jobs_unique_full_sync_active
  on task_sync_jobs (user_id)
  where action = 'full_sync' and status in ('pending', 'processing');
```

Note: `outlook_connections.delta_token` tracks list-level delta queries, while `project_outlook_lists.delta_token` stores the per-list tasks delta token.


---

## 5. Key API Routes

All routes reside under `src/app/api/integrations/outlook/`:

| Route | Description |
| --- | --- |
| `authorize` (`GET`) | Starts the OAuth flow (PKCE + per-request `state`) and redirects to Microsoft for consent. |
| `callback` (`GET`) | Handles Microsoft redirect, exchanges code for tokens, stores secrets, seeds project/list mappings, and enqueues an initial `full_sync`. |
| `disconnect` (`POST`) | Removes the Outlook connection and associated mappings. |
| `status` (`GET`) | Authenticated endpoint showing the current user’s connection status. |
| `sync` (POST) | **Worker entry point.** Requires `Authorization: Bearer <OUTLOOK_SYNC_JOB_SECRET>` or Vercel cron header. Processes up to `x-sync-limit` jobs (defaults to 25). |
| `subscriptions` (`GET`/`POST`) | Creates or renews Microsoft Graph change notification subscriptions and stores their IDs/expirations. |
| `webhook` (`GET`/`POST`) | GET echoes the `validationToken` handshake as plain text (Microsoft requirement); POST prefers `clientState` but falls back to subscription ID matching before enqueuing at most one `full_sync` per user. |
| `health` (`GET`) | Cron-protected health report (metrics + warnings). |

All window/cron/webhook routes export `runtime = 'nodejs'`, `dynamic = 'force-dynamic'`, `preferredRegion = 'fra1'`, and an explicit `maxDuration` so they always execute on the intended region within Vercel's time budget.

---

## 6. Queue & Worker Behaviour

1. Jobs are created via:
   * `enqueueTaskSyncJob` in `src/services/taskSyncQueue.js` (used by callbacks, task CRUD operations, webhook handler).
   * Admin scripts such as `scripts/backfill-task-sync.mjs`.
2. `enqueueTaskSyncJob` guards against duplicate `full_sync` jobs by checking for existing `pending`/`processing` rows and relies on a database-level partial unique index (`task_sync_jobs_unique_full_sync_active`).
3. Workers atomically claim jobs via the `claim_task_sync_jobs` PostgreSQL function, which uses `FOR UPDATE SKIP LOCKED`, stamps `worker_id`/`picked_at`, and increments attempts before returning rows.
4. The worker (`processTaskSyncJobs` in `src/services/outlookSyncService.js`) processes jobs in this order:
   * `create` → ensures a project list exists, then calls Microsoft Graph `POST /me/todo/lists/{listId}/tasks`.
   * `update` → handles project moves, refreshes lists on 404s, and reuses `create` when no mapping exists.
   * `delete` → deletes remote tasks and clears sync state.
   * `full_sync` → iterates each active list, calls `delta` endpoints, handles `410` (invalid delta) and `404` (list deleted) recoveries, and processes change payloads.
5. Closed projects: `ensureProjectList` checks the project status (`Completed`/`Cancelled`) and **skips** recreating Outlook lists for them; lists are archived, and incoming updates are ignored.
6. Task idempotency: Graph task IDs are stored in `task_sync_state`. When a remote notification arrives, tasks are upserted to avoid duplicates.
7. Retry logic: each claim increments `attempts`. Graph `429`/`503` responses respect `Retry-After` and reschedule the job with exponential backoff; other errors set `status = failed` and capture `last_error`. Operators can reset `status` to `pending` via SQL or by re-enqueueing.

---

## 7. Automation (Cron) Setup

**GitHub Actions Workflow:** `.github/workflows/outlook-sync.yml`

* Runs on schedules:
  * `*/2 * * * *` → Worker (`/api/integrations/outlook/sync`).
  * `*/30 * * * *` → Subscription renewal (`/api/integrations/outlook/subscriptions`).
* Each step issues a `curl` with header `Authorization: Bearer ${{ secrets.OUTLOOK_SYNC_JOB_SECRET }}`. The same secret value must exist in Vercel (as `OUTLOOK_SYNC_JOB_SECRET`).
* Workflow can also be run manually via `workflow_dispatch` for immediate processing.

**GitHub Repository Secrets Required:**

* `OUTLOOK_SYNC_JOB_SECRET` — matches the environment variable in Vercel so the API calls are authorised.

---

## 8. Operational Scripts

Located in `scripts/`:

| Script | Purpose |
| --- | --- |
| `node --env-file .env.local scripts/backfill-task-sync.mjs <userId>` | Enqueues `create` jobs for any of the user’s tasks missing sync state and adds a final `full_sync` job. |
| `node --env-file .env.local scripts/archive-closed-projects.mjs` | Deletes Microsoft lists and Supabase mappings for closed/cancelled projects, removes per-task sync state, and cleans dead queue entries. |

Both scripts load credentials from `.env.local` (ensure `SUPABASE_SERVICE_KEY`, Microsoft client credentials, and the Outook webhook URL are present).

---

## 9. Health & Monitoring

1. **Health endpoint:**  
   ```
   curl https://planner.orangejelly.co.uk/api/integrations/outlook/health \
     -H "Authorization: Bearer $OUTLOOK_SYNC_JOB_SECRET"
   ```
   * Returns:
     * Total connections / tokens expiring within the next hour.
     * Active project list counts.
     * Queue stats (pending, processing, failed, oldest pending job).
     * Timestamps for last completed job and last failure (with `last_error` message).
     * Warnings array (high backlog, expiring tokens, failed jobs, missing list IDs).

2. **Vercel Logs:**
   * Targets: `/api/integrations/outlook/sync`, `/api/integrations/outlook/webhook`, `/api/integrations/outlook/subscriptions`.
   * Look for HTTP errors from Microsoft Graph (`401` token issues, `404` list deleted, `429`/`503` throttling).

3. **Supabase Queries:**
   * Pending jobs:  
     `select id, action, status, last_error, scheduled_at from task_sync_jobs where status = 'pending';`
   * Failed jobs:  
     `select id, action, last_error, updated_at from task_sync_jobs where status = 'failed';`
   * Active project mappings:  
     `select project_id, graph_list_id, graph_list_name, is_active from project_outlook_lists where user_id = '<userId>' and is_active = true;`

---

## 10. Troubleshooting Workflow

1. **Run the health endpoint** → capture warnings and the last failure message.
2. **Check the queue** → if pending jobs remain, trigger a manual drain with a higher limit:  
   ```
   curl https://planner.orangejelly.co.uk/api/integrations/outlook/sync \
     -H "Authorization: Bearer $OUTLOOK_SYNC_JOB_SECRET" \
     -H "x-sync-limit: 150"
   ```
3. **Inspect failed jobs** → note `last_error`. Common cases:
   * `Item not found` – list or task was deleted in Outlook; the worker now recreates lists automatically.
   * `Unauthorized` – refresh token expired or was revoked (reconnect account).
   * `Delta token is no longer valid` – handled internally by clearing the delta token and re-syncing.
4. **Verify project status** → ensure projects whose lists should exist are not marked `Completed`/`Cancelled`.
5. **Run scripts**:
   * `archive-closed-projects.mjs` after closing projects, to remove obsolete lists.
   * `backfill-task-sync.mjs` after reconnecting to enqueue missing create jobs.
6. **Reconnect flow**: if tokens fail repeatedly, have the user disconnect (`/api/integrations/outlook/disconnect`) and reconnect (`/api/integrations/outlook/authorize`).
7. **Check Microsoft subscriptions** via health endpoint or Supabase — ensure `subscription_expires_at` is in the future. If not, rerun `/subscriptions`.

---

## 11. Behavioural Notes & Edge Cases

* **Closed projects**: The worker will not recreate lists for projects marked `Completed` or `Cancelled`. Tasks in those projects intentionally skip sync. Reopen a project to re-enable sync; the next job recreates the list automatically.
* **Manual list deletion**: Detected during `full_sync`. The worker clears the mapping, re-provisions the list, and logs the event.
* **List rename in Outlook**: The worker updates `graph_list_name` and, if the local project name still matches the old list name, updates `projects.name` to stay aligned.
* **Webhook bursts**: The webhook handler enqueues at most one `full_sync` per user per notification batch and reports `enqueued` vs `skipped` counts.
* **Refresh token rotation**: Tokens are stored in Supabase Vault (`refresh_token_secret`); the worker refreshes tokens when <2 minutes remain and updates the stored secret if Microsoft returns a new refresh token.
* **Throttling**: Graph `429`/`503` responses honour `Retry-After`; the worker defers the job with exponential backoff so it re-runs automatically once the cooldown passes.

---

## 12. Verification Checklist After Deployment

1. Deploy latest `main` to Vercel and confirm environment variables are present.
2. Run health check—expect zero warnings, `pending = 0`, `failed = 0`.
3. Trigger manual sync with higher limit (see above) and confirm `processed > 0`.
4. Verify Outlook: new tasks created in Planner appear in the corresponding Microsoft To Do list within the next cron cycle, and vice versa.
5. Close a test project → list should be archived (removed from Outlook). Reopen project → list should reappear after the next sync.

---

## 13. Reference Commands

```bash
# Health report
curl https://planner.orangejelly.co.uk/api/integrations/outlook/health \
  -H "Authorization: Bearer $OUTLOOK_SYNC_JOB_SECRET"

# Drain queue aggressively
curl https://planner.orangejelly.co.uk/api/integrations/outlook/sync \
  -H "Authorization: Bearer $OUTLOOK_SYNC_JOB_SECRET" \
  -H "x-sync-limit: 150"

# Requeue all failed and pending jobs (SQL, run via Supabase)
update task_sync_jobs
   set status = 'pending', last_error = null, attempts = 0, updated_at = now()
 where status in ('failed','pending');

# Inspect mappings for a user (replace <userId>)
select project_id, graph_list_id, graph_list_name, is_active
  from project_outlook_lists
 where user_id = '<userId>';
```

---

## 14. Known Limitations / Backlog Ideas

* Alerts are surfaced via the health endpoint but not yet wired into Slack/email. Consider adding a scheduled check that notifies when warnings are present.
* Error handling for Graph throttling currently requires manual requeueing.
* No automated cleanup for stale subscriptions if a user disconnects without unsubscribing; a future enhancement could call `DELETE /subscriptions/{id}`.
* Integration tests covering worker recovery paths and rename flows are still TODO.

---

By following this guide, an external consultant should be able to:

1. Understand how the Outlook integration is wired end to end.
2. Inspect the queue, mappings, and health metrics without touching the codebase.
3. Run scripted maintenance tasks and know when/how lists and tasks are recreated.
4. Troubleshoot the most common failure modes quickly.
