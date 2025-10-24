# Outlook Sync Architecture

## High-Level Flow

1. **Connect Button** (`OutlookSyncCard.jsx`) sends the user to `/api/integrations/outlook/authorize`.
2. **Authorize Endpoint** builds the Microsoft OAuth URL, sets a `planner_outlook_oauth_state` cookie, and redirects.
3. **Callback** (`/api/integrations/outlook/callback`):
   - Exchanges the `code` for tokens
   - Stores access token & refresh token reference in `public.outlook_connections`
   - Seeds per-project Outlook lists (see below)
   - Registers a Microsoft webhook
   - Enqueues a `full_sync` job so the worker pulls initial data
4. **Worker** (triggered by cron hitting `/api/integrations/outlook/sync`) drains `task_sync_jobs` and mirrors changes both ways.
5. **Status Endpoint** exposes connection metadata (`connected`, list IDs, token expiries) to the dashboard card.

## Supabase Schema

| Table | Purpose |
| ----- | ------- |
| `outlook_connections` | One row per user, stores refresh token secret, default To Do list, and connection metadata. |
| `task_sync_state` | Maps each Planner task to the Microsoft task (`graph_task_id`, `graph_etag`, `graph_list_id`). |
| `task_sync_jobs` | Persistent queue for background sync work. |
| `project_outlook_lists` | Maps Planner projects to Microsoft To Do lists (`graph_list_id`) and stores `delta_token`, `subscription_id`, `subscription_expires_at`. |

Every table has RLS policies (`auth.uid() = user_id`), updated_at triggers via `public.update_updated_at_column`, and appropriate indexes.

## Key Files & Responsibilities

### API Routes

```text
src/app/api/integrations/outlook/authorize/route.js   // Redirect to Microsoft consent
src/app/api/integrations/outlook/callback/route.js    // Token exchange, list seeding, enqueue full sync
src/app/api/integrations/outlook/status/route.js      // Returns connection metadata
src/app/api/integrations/outlook/disconnect/route.js  // Removes connection + secrets + sync state
src/app/api/integrations/outlook/sync/route.js        // Cron worker + "sync now" endpoint
src/app/api/integrations/outlook/webhook/route.js     // Graph change notifications
src/app/api/integrations/outlook/subscriptions/route.js // Creates/renews todoTask subscriptions per list
```

### Services

```text
src/services/taskService.js           // Centralised task CRUD + enqueue sync jobs
src/services/taskSyncQueue.js         // Writes/fetches jobs from `task_sync_jobs`
src/services/outlookSyncService.js    // Background worker creating/updating lists & tasks
```

### Graph Helpers

`src/lib/microsoftGraphClient.js` wraps token exchange and To Do APIs (`createTodoTask`, `createTodoList`, `listTodoLists`, `renewTodoSubscription`, etc.).

### UI

`src/components/dashboard/OutlookSyncCard.jsx` displays connection state, triggers connect/disconnect, and explains that each Planner project has its own Outlook list.

### Middleware & Cron

- `src/middleware.js` excludes `/api/integrations/outlook/webhook`, `/api/integrations/outlook/sync`, and `/api/integrations/outlook/subscriptions` from auth redirects so Microsoft Graph and Vercel Cron can call them.
- `vercel.json` configures Vercel cron jobs (set an `Authorization: Bearer <OUTLOOK_SYNC_JOB_SECRET>` header for each job in the Vercel dashboard):

```json
{
  "crons": [
    { "path": "/api/integrations/outlook/sync", "schedule": "*/2 * * * *" },
    { "path": "/api/integrations/outlook/subscriptions", "schedule": "*/30 * * * *" }
  ]
}
```

Environment variables (set in Vercel): `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, `MICROSOFT_TENANT_ID`, `OUTLOOK_WEBHOOK_URL`, `OUTLOOK_SYNC_JOB_SECRET`, `OUTLOOK_SUBSCRIPTION_DURATION_MIN`, `OUTLOOK_CLIENT_STATE`, `OUTLOOK_RENEW_BEFORE_MIN`, `SUPABASE_SERVICE_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`, `NEXT_PUBLIC_SUPABASE_*`.

## Per-Project Outlook Lists

The sync worker ensures each Planner project maps to its own Microsoft To Do list:

```js
const projectMapping = await ensureProjectList({
  supabase,
  connection,
  userId: task.user_id,
  projectId: task.project_id
});

await createTodoTask(connection.accessToken, projectMapping.graph_list_id, buildGraphTaskPayload(task));
```

If a change is detected in a list with no mapping, `ensureProjectForList()` creates a new Planner project and records the association.

Moving a task between projects deletes it from the old list and recreates it in the new list with updated sync state.

## Connection Status

`GET /api/integrations/outlook/status` checks `outlook_connections`. If present, `connected: true` and expiration timestamps are returned; otherwise `connected: false`.

## Error Surfacing

The callback now appends `reason=` to the dashboard redirect when Microsoft returns an error:

```
https://planner.orangejelly.co.uk/dashboard?outlook=callback_error&reason=Invalid%20Scopes
```

Capture that value to diagnose consent issues.

## Outstanding Enhancements / Notes

- Runtime logs are limited; recommend adding structured logging around the callback and worker.
- Webhook route currently enqueues a `full_sync`; consider diff-based handling for efficiency once stable.
- Manual Supabase SQL (in the dashboard) may be needed when `supabase db push` can’t target individual migrations.
