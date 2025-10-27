# Microsoft Outlook Sync – Consultant Brief

This document captures the current Microsoft To Do integration for **Planner**, including architecture, configuration requirements, and the blockers that are preventing successful task synchronisation for the account `peter@orangejelly.co.uk`. A consultant can use this brief without direct repository access.

---

## 1. High-Level Flow

1. **User connects Outlook** from the dashboard card (`src/components/dashboard/OutlookSyncCard.jsx`).
2. **Authorization endpoint** builds the Microsoft OAuth URL:

   ```js
   // src/app/api/integrations/outlook/authorize/route.js
   const scopes = [
     'offline_access',
     'Tasks.ReadWrite',
     'User.Read',
     'openid',
     'profile',
     'email'
   ];
   ```

3. **Callback handler** (`src/app/api/integrations/outlook/callback/route.js`) exchanges the auth code, stores refresh/access tokens in Supabase, seeds project/list mappings, optionally registers a webhook, and enqueues an initial `full_sync` job.
4. **Background worker** (`src/services/outlookSyncService.js`) drains `task_sync_jobs` and synchronises tasks both ways via Microsoft Graph.
5. **Webhook endpoint** (`src/app/api/integrations/outlook/webhook/route.js`) receives Microsoft change notifications and enqueues `full_sync` jobs for the affected user.
6. **Cron jobs** trigger `/api/integrations/outlook/sync` (queue worker) every 2 minutes and `/api/integrations/outlook/subscriptions` (subscription maintenance) every 30 minutes. These are now run via GitHub Actions (see section 6). Remove any legacy Vercel cron jobs to avoid duplicate calls.

---

## Recent Code Updates (Oct 27 2025)

- Cron authentication logic is centralised in `src/lib/cronAuth.js` and used by both `/api/integrations/outlook/sync` and `/api/integrations/outlook/subscriptions`, with the sync route explicitly configured for the Node runtime (`runtime = 'nodejs'`, `dynamic = 'force-dynamic'`).
- Microsoft Graph subscriptions request `changeType: 'created,updated,deleted'` and advertise `latestSupportedTlsVersion: 'v1_2'` (`src/lib/microsoftGraphClient.js`).
- Delta queries now detect Microsoft’s HTTP 410 responses, clear the stored `delta_token`, and immediately resynchronise without the stale token (`src/services/outlookSyncService.js`).

Outstanding fixes still require environment or database access (see Sections 2, 6, 11, and 12).

---

## 2. Required Environment Variables

| Variable | Purpose | Notes |
| --- | --- | --- |
| `MICROSOFT_CLIENT_ID` | Azure AD application ID | App must have delegated Graph permissions: `Tasks.ReadWrite`, `offline_access`, `User.Read`, `email`, `openid`, `profile`. |
| `MICROSOFT_CLIENT_SECRET` | Client secret for token exchange | Stored only server-side. |
| `MICROSOFT_TENANT_ID` | Tenant or `common` | Optional; defaults to `common`. |
| `OUTLOOK_WEBHOOK_URL` | Public HTTPS endpoint for Graph notifications | e.g. `https://planner.orangejelly.co.uk/api/integrations/outlook/webhook`. |
| `OUTLOOK_SYNC_JOB_SECRET` | Shared secret required by cron requests | Must match the `Authorization` header value supplied by Vercel cron jobs. |
| `OUTLOOK_SUBSCRIPTION_DURATION_MIN` | Desired todoTask subscription lifetime (minutes) | Default 60, max 4230. |
| `OUTLOOK_RENEW_BEFORE_MIN` | Renew subscriptions when fewer minutes remain | Default 360. |
| `OUTLOOK_CLIENT_STATE` | Optional clientState for webhook validation | If set, webhook rejects notifications without this value. |
| `SUPABASE_SERVICE_KEY` | Supabase service role key | Used by server-side clients. |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase project settings | Already configured. |
| `NEXTAUTH_URL`, `NEXTAUTH_SECRET` | NextAuth configuration | Required for session handling. |

You can verify env coverage locally via `npm run build` (already succeeds) and by hitting `/api/auth/verify-config` on the deployed site.

---

## 3. Supabase Schema & Migrations

The integration depends on the following tables (see `supabase/migrations`):

| SQL File | Purpose |
| --- | --- |
| `20250910_outlook_sync_schema.sql` | Creates `outlook_connections`, `task_sync_state`, `task_sync_jobs`, and associated RLS policies. |
| `20250911_outlook_project_lists.sql` | Adds `project_outlook_lists` and `graph_list_id` to `task_sync_state`. |
| `20250913_outlook_list_subscription_metadata.sql` | Adds `subscription_id`, `subscription_expires_at`, and `delta_token` columns plus indexes. |

> **Current status:** `docs/MIGRATION_STATUS.md` still lists the two Outlook migrations as “pending manual migration”. If they were never executed against the production Supabase instance, any sync job will fail because required tables/columns are missing.

Token storage relies on Supabase Vault RPC calls (`src/lib/supabaseVault.js`). Ensure the `supabase_vault` extension is enabled; it is added in `20250707_initial_schema.sql`.

---

## 4. Microsoft Graph Interaction

- Graph helper wrappers live in `src/lib/microsoftGraphClient.js`.
- `createTodoSubscription` currently posts:

  ```js
  body: {
    changeType: 'updated',
    notificationUrl,
    resource: `/me/todo/lists/${listId}/tasks`,
    expirationDateTime: expiresAt,
    ...(clientState ? { clientState } : {})
  }
  ```

  **Limitation:** Only `updated` changes are subscribed. To capture creations and deletions, the body must use `changeType: 'created,updated,deleted'`.

- `refreshAccessToken` requests new tokens with scope `offline_access Tasks.ReadWrite User.Read`.

---

## 5. Queue Processing & Sync Logic

### Job Enqueueing
- Task CRUD (`src/services/taskService.js`) pushes `create`, `update`, or `delete` jobs with metadata.
- `/api/integrations/outlook/callback` enqueues a `full_sync` job for new connections.
- Webhook notifications enqueue `full_sync` for the affected user.

### Worker Execution
`processTaskSyncJobs(limit)` (default 25) follows this flow:

1. Fetch pending jobs `status='pending'` with `scheduled_at <= now`.
2. Transition to `processing`, execute via `processSingleJob`.
3. On success, mark `completed`; on failure, mark `failed` and store the error message.

**Important constraint:** Failed jobs are never retried automatically. Once errors are resolved (e.g., migrations applied, tokens refreshed), the `task_sync_jobs` table must be manually cleaned up or each failed row reset to `pending`.

### Remote Sync Details
- `syncRemoteChangesForUser` iterates lists in `project_outlook_lists`, calling `getTodoTaskDelta`.
- Delta token invalidation (Graph returning HTTP 410) is not handled; job fails and stale `delta_token` persists.
- Remote create/update path uses `handleRemoteCreateOrUpdate`, which maps tasks and ensures associated projects/lists exist.

---

## 6. Scheduled Jobs (GitHub Actions)

Vercel’s cron UI doesn’t currently support request headers, so the scheduled calls now live in GitHub Actions (`.github/workflows/outlook-sync.yml`). The workflow:

- Runs every 2 minutes: `GET https://planner.orangejelly.co.uk/api/integrations/outlook/sync`
- Runs every 30 minutes: `GET https://planner.orangejelly.co.uk/api/integrations/outlook/subscriptions`
- Supplies the header `Authorization: Bearer ${{ secrets.OUTLOOK_SYNC_JOB_SECRET }}`

Make sure the repo secret `OUTLOOK_SYNC_JOB_SECRET` matches the value in your runtime environment. Remove or disable any legacy Vercel cron jobs to avoid duplicate or unauthorized calls.

---

## 7. Webhook Endpoint

`src/app/api/integrations/outlook/webhook/route.js`:

- Supports Microsoft validation tokens (GET/POST).
- Filters notifications by `OUTLOOK_CLIENT_STATE`.
- Enqueues `full_sync` for each unique `subscriptionId`.
- Requires the Supabase migrations to map `subscription_id` back to users (`project_outlook_lists.subscription_id`).

---

## 8. Current Blockers

1. **Supabase migrations likely missing** – Tables referenced throughout the service appear in SQL files dated September 2025 but are flagged as pending in documentation. Check Supabase database for `project_outlook_lists` and `task_sync_jobs`.
2. **Cron jobs sending `401`** – Vercel UI shows jobs but without the required Authorization header the worker never runs.
3. **Webhook subscription scope** – `changeType: 'updated'` misses creations/deletions.
4. **Delta token resilience** – No fallback when tokens expire (Graph HTTP 410). Worker stalls unless manual action clears the delta token.
5. **Failed job cleanup** – Existing failed rows must be requeued or deleted once root causes are fixed.

---

## 9. Verification Checklist

After applying fixes:

1. **Run Supabase SQL** migrations `20250910`, `20250911`, `20250913`.
2. **Confirm cron headers** using Vercel logs: successful executions should log JSON with processed job counts.
3. **Inspect Supabase tables**:
   - `outlook_connections` contains row for user with valid `access_token_expires_at`.
   - `project_outlook_lists` contains mappings and `delta_token`.
   - `task_sync_jobs` queue drains (no persistent failures).
4. **Microsoft Graph**:
   - Test manual `PUT /api/integrations/outlook/sync` while authenticated to enqueue full sync.
   - Create a task in Planner → expect Graph list entry.
   - Create a task in Microsoft To Do → expect Planner entry (requires `changeType` fix plus working delta tokens).

---

## 10. Useful Endpoints & Tools

| Endpoint | Description |
| --- | --- |
| `/api/integrations/outlook/status` | Authenticated status check; returns `connected`, `plannerListId`, token expiry, etc. |
| `/api/integrations/outlook/disconnect` | Removes connection + secret. |
| `/api/integrations/outlook/sync` (GET/POST) | Cron worker; requires Authorization header. |
| `/api/integrations/outlook/sync` (PUT) | Authenticated user-triggered full sync enqueue. |
| `/api/integrations/outlook/subscriptions` | Cron endpoint for creating/renewing Graph subscriptions; also guarded by Authorization header. |

---

## 11. Next Steps for Consultant

1. **Database Audit** – Verify required tables, indexes, and triggers exist. Run migrations if absent.
2. **Cron Job Recreation** – Ensure both Vercel cron jobs include the `Authorization` header. Check logs for successful 200 responses.
3. **Graph Subscription Update** – Modify `createTodoSubscription` body to include `created,updated,deleted`, redeploy, then trigger subscription renewals.
4. **Delta Token Handling** – Add error handling for HTTP 410 responses from Graph to clear `delta_token` and retry without it.
5. **Job Retry Strategy** – Implement automatic retries or scheduled cleanup for failed jobs.
6. **Monitoring** – Add structured logging around queue processing for faster diagnosis.

Once the above are in place, repeat verification (Section 9). Any consultant can operate with this document plus access to Supabase, Vercel, and Microsoft Azure portals.

---

## 12. Observed Data & Logs (Oct 27, 2025)

Recent CLI checks provide additional colour:

- **Vercel runtime response:** `curl https://planner.orangejelly.co.uk/api/integrations/outlook/sync` → `401 Unauthorized`, confirming cron invocations without the `Authorization` header will continue to fail.
- **Supabase queue state:** `task_sync_jobs` currently holds four pending rows (actions `update` and `create`) dating back to *2025‑10‑24*. Example REST query:<br>`GET …/task_sync_jobs?status=eq.pending&select=id,action,scheduled_at` returns rows such as<br>`{"id":"a7bb7921-f567-41c8-8110-ac5e6bbbd6e0","action":"update","scheduled_at":"2025-10-24T11:17:58.239+00:00"}`.
- **No connection/list records:** `GET …/outlook_connections` and `GET …/project_outlook_lists` currently return `[]`, implying either migrations were not run or the connection bootstrap failed.

These data points support the hypotheses that (a) cron requests never reach the worker, (b) even if they did, no Microsoft connection metadata is stored for the user, and (c) backlog cleanup is required once the root causes are fixed.

---

*Prepared on 27 Oct 2025. Contact: peter.pitcher@genmills.com / peter@orangejelly.co.uk.*
