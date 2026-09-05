# Production migration approval packet

Status: approved in chat and applied to production planner-app (hufxwovthhsjmtifvign). Live migration version 20260905164422, atomic_promotion_and_recurrence. The approved SQL and SHA-256 below are unchanged. The original packet is retained as the approval record.

## Target and exact artefact

- Supabase project: `planner-app`.
- Project ID/ref: `hufxwovthhsjmtifvign`.
- API host: `hufxwovthhsjmtifvign.supabase.co`.
- Database host: `db.hufxwovthhsjmtifvign.supabase.co`.
- Region: `eu-west-2`; database version verified as PostgreSQL `15.8.1.085`.
- File: `supabase/migrations/20260905162045_atomic_promotion_and_recurrence.sql`.
- Migration name: `atomic_promotion_and_recurrence`.
- SHA-256: `94e48625e7a550e6a9716070241436ada0a64c8a75eafe58bd797fa8069d98fb`.

The main agent matched the production ref to the original project's `.env.local`; this agent independently verified the connected project name/ref, database version and current schema. Production application must use the Supabase MCP migration capability, with this exact file content. The apply-time history version may differ from the local filename; record the returned mapping.

## Result and dependency

Idea promotion locks the owned idea, inserts its task and changes its state in one transaction. A failed task insert leaves the idea unchanged. Concurrent promotion creates one task and returns a conflict to the other request.

Recurrence identifies the completed source by its ID. The new RPC locks that source, copies its authoritative project/customer data, inserts the next task and records a receipt atomically. A receipt prevents repeated calls, undo/redo and deletion or completion of the successor from producing another successor. Identically named tasks on unrelated projects do not suppress each other.

Deploy the `ideaService.promoteIdea` and `taskService.spawnNextRecurrence` changes only after this migration. There is deliberately no fallback to the old non-atomic implementations when an RPC is missing. Keep the migration-to-application interval short: old application instances do not record receipts for new completions.

## Verified live state on 5 September 2026

Read-only catalogue queries verified the columns, constraints, indexes, policies, trigger definitions, function definitions, grants, default privileges and migration history touched by this change.

| Object or check | Observation |
| --- | --- |
| Existing tasks | 603 rows; 835,584 bytes including indexes |
| Existing ideas | 2 rows; 49,152 bytes including indexes |
| Already completed recurring sources | 0 rows at the latest read-only check |
| Dependent ordinary views on tasks, ideas, projects or notes | None reported by `information_schema.view_table_usage` |
| Dependent materialized views | None found through `pg_depend`, `pg_rewrite` and `pg_class` |
| Task ownership key | Existing unique `(id, user_id)` constraint |
| Task customer relationship | Existing composite `(customer_id, user_id)` FK |
| Task insert/update triggers | `trg_task_customer_sync`, `trg_task_state_cleanup`, timestamp update trigger |
| Existing task/idea RLS | Enabled with per-user policies |
| Relevant latest history | Customer/lifecycle migrations through `phase4_drop_stakeholders`; `20260905053043_default_privileges_stop_anon_inheriting`; `20260905053122_revoke_anon_execute_on_trigger_functions` |
| New object names | Not present before this migration |

Existing trigger definitions were checked through `pg_get_functiondef`. The customer trigger derives a project's customer, and the completion trigger records the customer snapshot. This migration leaves those definitions and existing policies unchanged.

The receipt seed reads tasks with `state = 'done' AND recurrence IS NOT NULL` at apply time. It currently matches zero rows; the count can change before application. Any matched rows create records only in the new ledger with `next_task_id = NULL`. No existing business row is changed and no successor is guessed. This prevents historical completed-task undo/redo duplicates. It does not recover recurrences that failed before the migration, or infer historical links for tasks already reopened before application.

## Objects, locks and high-risk statements

| Statement group | Impact and mitigation |
| --- | --- |
| New receipt table and primary key | New empty table; no rewrite of `tasks` or `ideas`. Primary key makes each source receipt unique. |
| Source composite FK, `ON DELETE CASCADE` | References the existing task ownership key. Deleting a source removes its receipt only. Its successor task is retained. Installing reference constraints/triggers takes brief locks on `tasks`. |
| Successor FK, `ON DELETE SET NULL` | Deleting a successor retains the source receipt and therefore duplicate protection. |
| Initial receipt INSERT | Reads approximately 603 source task rows and inserts only already completed recurring sources into the new ledger. Latest matching count: zero. This is additive metadata, with no business row backfill. |
| RLS and table privilege changes | Applies to the new table only. RLS enabled with no public policies. Explicit revocation removes inherited `PUBLIC`, `anon` and `authenticated` grants; `service_role` receives SELECT. |
| Two `SECURITY DEFINER` functions | High-risk privileged entry points. Both pin an empty search path, qualify relations, require user/source IDs, check ownership and explicit state, and restrict execution to `service_role`. They do not trust client task identity fields. |
| Function REVOKE/GRANT | Applies only to the two new RPCs. `PUBLIC`, `anon` and `authenticated` cannot execute them. Existing trigger grants are unchanged. |

`lock_timeout = '5s'` bounds lock acquisition. The migration fails rather than waiting indefinitely. The tables are small, but elapsed application time is not guaranteed. There are no existing-column drops, renames, type changes or existing-table index rebuilds.

## Local validation evidence

All tests used synthetic records in the isolated PostgreSQL instance at `127.0.0.1:55432`, user `peterpitcher`. No production writes were used for validation.

Runnable fixture command from the repair worktree:

```sh
psql -X -h 127.0.0.1 -p 55432 -U peterpitcher -d postgres -v ON_ERROR_STOP=1 -f supabase/__tests__/workflow-repairs.sql
```

The fixture preserves the relevant current schema types and constraints and includes the deployed customer and completion trigger definitions from the repository migrations. It wraps all fixture objects/data and the migration in a transaction, then rolls back.

Observed output:

```text
NOTICE: Workflow identity, lifecycle, legacy receipts and privilege assertions passed
NOTICE: Dependency failure rollback assertions passed
ROLLBACK
```

Assertions covered independent same-name sources, standalone customer preservation, project customer inheritance, completion customer snapshots, existing/closed/deleted successor receipts, historical undo/redo receipts, foreign ownership, active source rejection, promotion once, invalid title rejection, and injected task-insert failures with no partial promotion or receipt.

Two independent database connections then exercised concurrency in disposable database `planner_workflow_57090228`:

```json
{"recurrenceReceipts":1,"recurrenceTasks":1,"promotedTasks":1}
```

Both recurrence calls completed, with one successor and one receipt. Paired promotion calls returned one success and one `23505` conflict. Actual `SET ROLE` execution denied RPCs for `anon` and `authenticated`; `service_role` successfully returned `already_exists`.

The exact rollback-only smoke below was also executed locally and returned `Workflow smoke passed; all synthetic rows rolled back`. Both rollback DROP FUNCTION statements were executed against the local fixture, followed by assertions that the functions were absent and receipts remained; output was `Rollback SQL removes only RPCs and retains receipts`.

The disposable concurrency database was subsequently dropped. A catalogue check returned `0` databases named `planner_workflow_57090228`. The rollback fixture left no test objects or data in the `postgres` database.

Application checks passed: 358 service/project/report tests under `TZ=Europe/London`, 52 focused regression tests under `TZ=UTC`, and ESLint for all changed workflow files. Full application/browser release verification is recorded separately by the main agent.

## Exact SQL proposed

```sql
-- Additive workflow repair. No existing tasks or ideas are changed.
-- The source receipt survives deletion/completion of the next occurrence.
-- Deleting the source removes only its receipt, never its next task.
SET lock_timeout = '5s';

CREATE TABLE public.task_recurrence_spawns (
  source_task_id uuid PRIMARY KEY,
  user_id uuid NOT NULL,
  next_task_id uuid REFERENCES public.tasks(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT task_recurrence_spawns_source_owner_fkey
    FOREIGN KEY (source_task_id, user_id)
    REFERENCES public.tasks(id, user_id) ON DELETE CASCADE
);
CREATE INDEX task_recurrence_spawns_next_idx
  ON public.task_recurrence_spawns(next_task_id) WHERE next_task_id IS NOT NULL;
ALTER TABLE public.task_recurrence_spawns ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.task_recurrence_spawns FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.task_recurrence_spawns TO service_role;

-- A pre-upgrade completion has already attempted its next occurrence. Record
-- that fact without guessing which task was its successor or changing tasks.
-- This prevents historical undo/redo from creating another occurrence; it does
-- not recover a recurrence that had already failed before this migration.
INSERT INTO public.task_recurrence_spawns(source_task_id, user_id)
  SELECT id, user_id FROM public.tasks WHERE state = 'done' AND recurrence IS NOT NULL;

CREATE FUNCTION public.spawn_task_recurrence(
  p_user_id uuid,
  p_task_id uuid,
  p_due_date date
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_source public.tasks%ROWTYPE;
  v_next public.tasks%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_task_id IS NULL THEN
    RAISE EXCEPTION 'User and task are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_source FROM public.tasks
    WHERE id = p_task_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Task not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_source.state <> 'done' THEN
    RAISE EXCEPTION 'Only completed tasks can repeat' USING ERRCODE = '23514';
  END IF;
  IF v_source.recurrence IS NULL THEN
    RETURN jsonb_build_object('spawned', false, 'reason', 'not_recurring');
  END IF;
  IF v_source.recurrence NOT IN ('daily', 'weekdays', 'weekly', 'monthly') THEN
    RAISE EXCEPTION 'Invalid recurrence' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM public.task_recurrence_spawns WHERE source_task_id = p_task_id) THEN
    RETURN jsonb_build_object('spawned', false, 'reason', 'already_exists');
  END IF;
  IF p_due_date IS NULL OR p_due_date <= greatest(
    v_source.due_date, (now() AT TIME ZONE 'Europe/London')::date
  ) THEN
    RAISE EXCEPTION 'Next occurrence must be in the future' USING ERRCODE = '22023';
  END IF;
  IF v_source.project_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public.projects WHERE id = v_source.project_id AND user_id = p_user_id
  ) THEN
    RAISE EXCEPTION 'Project is not owned by user' USING ERRCODE = '42501';
  END IF;

  INSERT INTO public.tasks (
    user_id, name, description, project_id, customer_id, area, task_type,
    chips, recurrence, recurrence_interval, due_date, state
  ) VALUES (
    p_user_id, v_source.name, v_source.description, v_source.project_id,
    CASE WHEN v_source.project_id IS NULL THEN v_source.customer_id ELSE NULL END,
    v_source.area, v_source.task_type, v_source.chips, v_source.recurrence,
    greatest(coalesce(v_source.recurrence_interval, 1), 1), p_due_date, 'backlog'
  ) RETURNING * INTO v_next;
  INSERT INTO public.task_recurrence_spawns(source_task_id, user_id, next_task_id)
    VALUES (p_task_id, p_user_id, v_next.id);
  RETURN jsonb_build_object('spawned', true, 'task', to_jsonb(v_next));
END;
$$;
REVOKE ALL ON FUNCTION public.spawn_task_recurrence(uuid, uuid, date) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.spawn_task_recurrence(uuid, uuid, date) TO service_role;

CREATE FUNCTION public.promote_idea(p_user_id uuid, p_idea_id uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = ''
AS $$
DECLARE
  v_idea public.ideas%ROWTYPE;
  v_task public.tasks%ROWTYPE;
BEGIN
  IF p_user_id IS NULL OR p_idea_id IS NULL THEN
    RAISE EXCEPTION 'User and idea are required' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_idea FROM public.ideas
    WHERE id = p_idea_id AND user_id = p_user_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Idea not found' USING ERRCODE = 'P0002';
  END IF;
  IF v_idea.idea_state = 'promoted' THEN
    RAISE EXCEPTION 'Already promoted' USING ERRCODE = '23505';
  END IF;
  IF v_idea.idea_state NOT IN ('captured', 'exploring', 'ready_later') THEN
    RAISE EXCEPTION 'Invalid idea state' USING ERRCODE = '23514';
  END IF;
  IF length(btrim(v_idea.title)) = 0 OR length(v_idea.title) > 255 THEN
    RAISE EXCEPTION 'Invalid task name' USING ERRCODE = '23514';
  END IF;
  INSERT INTO public.tasks (
    user_id, name, description, state, area, source_idea_id, sort_order, inbox
  ) VALUES (
    p_user_id, v_idea.title,
    nullif(concat_ws(E'\n\n', nullif(v_idea.why_it_matters, ''),
      nullif(v_idea.smallest_step, ''), nullif(v_idea.notes, '')), ''),
    'backlog', v_idea.area, v_idea.id, 0, true
  ) RETURNING * INTO v_task;
  UPDATE public.ideas SET idea_state = 'promoted' WHERE id = p_idea_id AND user_id = p_user_id;
  RETURN to_jsonb(v_task);
END;
$$;
REVOKE ALL ON FUNCTION public.promote_idea(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.promote_idea(uuid, uuid) TO service_role;
RESET lock_timeout;
```

## Rollback plan and exact SQL

First revert the application revision containing the new idea and recurrence RPC callers. Ensure that revision is deployed and no in-flight callers depend on the new RPCs. Then the following SQL removes only the new entry points. Keep the ledger and its rows, constraints and restrictive grants. Retaining receipts preserves evidence for a corrected forward deployment and avoids deleting any tasks or ideas.

```sql
BEGIN;
SET LOCAL lock_timeout = '5s';
DROP FUNCTION IF EXISTS public.promote_idea(uuid, uuid);
DROP FUNCTION IF EXISTS public.spawn_task_recurrence(uuid, uuid, date);
COMMIT;
```

Do not drop `task_recurrence_spawns` as a routine rollback: losing its receipts would permit duplicate successors when corrected code is redeployed. The prior application does not reference the ledger, so leaving it is compatible. A later repair should reuse the retained table and recreate the RPCs through a new reviewed migration; rerunning this original migration against the retained table would fail because its CREATE TABLE is intentionally not silent.

Rollback restores the older application behaviours, including its known recurrence/promotion weaknesses. A forward fix is preferable if only an RPC implementation needs correcting. This rollback does not reverse legitimate business actions completed after deployment.

## Post-application verification

Reconfirm project ref and checksum immediately before apply. After application, record the actual history name/version, re-read the table definition, indexes, RLS, policies and both function definitions, and check grants as each role. Recheck the number of receipt rows against the apply-time matched source count.

Read-only catalogue query:

```sql
SELECT p.proname, p.prosecdef, p.proconfig,
  has_function_privilege('anon', p.oid, 'EXECUTE') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated_execute,
  has_function_privilege('service_role', p.oid, 'EXECUTE') AS service_execute
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('promote_idea', 'spawn_task_recurrence');
SELECT relrowsecurity FROM pg_class
WHERE oid = 'public.task_recurrence_spawns'::regclass;
SELECT count(*) AS receipts FROM public.task_recurrence_spawns;
```

Expected: both RPCs have `prosecdef = true`, pinned empty search path, false anon/authenticated execution and true service-role execution. The receipt table has RLS enabled.

The following representative smoke test creates synthetic rows for an existing application user inside a nested transaction block. Its deliberate final exception rolls back every fixture mutation before reporting success. Any assertion failure also rolls back the whole statement. It does not update existing business records or invoke Outlook/email services. Run only as part of the approved post-application verification.

```sql
DO $$
DECLARE
  v_user uuid;
  v_customer uuid;
  v_source uuid;
  v_idea uuid;
  v_successor uuid;
  v_result jsonb;
BEGIN
  SELECT user_id INTO v_user FROM public.tasks LIMIT 1;
  IF v_user IS NULL THEN
    RAISE EXCEPTION 'No existing application user is available for the rollback-only smoke';
  END IF;
  BEGIN
    INSERT INTO public.customers(user_id, name)
      VALUES (v_user, 'Migration smoke ' || gen_random_uuid()::text)
      RETURNING id INTO v_customer;
    INSERT INTO public.tasks(user_id, name, customer_id, state, recurrence, due_date)
      VALUES (v_user, 'Migration smoke recurrence', v_customer, 'done', 'daily',
        (now() AT TIME ZONE 'Europe/London')::date)
      RETURNING id INTO v_source;
    v_result := public.spawn_task_recurrence(v_user, v_source,
      (now() AT TIME ZONE 'Europe/London')::date + 1);
    IF NOT (v_result->>'spawned')::boolean
      OR v_result->'task'->>'customer_id' <> v_customer::text THEN
      RAISE EXCEPTION 'Recurrence or standalone customer smoke failed';
    END IF;
    v_successor := (v_result->'task'->>'id')::uuid;
    v_result := public.spawn_task_recurrence(v_user, v_source,
      (now() AT TIME ZONE 'Europe/London')::date + 1);
    IF (v_result->>'spawned')::boolean THEN
      RAISE EXCEPTION 'Recurrence retry created a duplicate';
    END IF;
    BEGIN
      PERFORM public.spawn_task_recurrence(gen_random_uuid(), v_source,
        (now() AT TIME ZONE 'Europe/London')::date + 1);
      RAISE EXCEPTION 'Foreign ownership was accepted';
    EXCEPTION WHEN no_data_found THEN NULL;
    END;
    INSERT INTO public.ideas(user_id, title)
      VALUES (v_user, 'Migration smoke promotion') RETURNING id INTO v_idea;
    v_result := public.promote_idea(v_user, v_idea);
    IF v_result->>'source_idea_id' <> v_idea::text THEN
      RAISE EXCEPTION 'Promotion source identity smoke failed';
    END IF;
    BEGIN
      PERFORM public.promote_idea(v_user, v_idea);
      RAISE EXCEPTION 'Duplicate promotion was accepted';
    EXCEPTION WHEN unique_violation THEN NULL;
    END;
    RAISE EXCEPTION 'Rollback successful smoke fixtures' USING ERRCODE = 'Z0001';
  EXCEPTION WHEN SQLSTATE 'Z0001' THEN NULL;
  END;
  IF EXISTS (SELECT 1 FROM public.customers WHERE id = v_customer)
    OR EXISTS (SELECT 1 FROM public.tasks WHERE id IN (v_source, v_successor))
    OR EXISTS (SELECT 1 FROM public.ideas WHERE id = v_idea)
    OR EXISTS (SELECT 1 FROM public.task_recurrence_spawns WHERE source_task_id = v_source) THEN
    RAISE EXCEPTION 'Smoke fixture rollback failed';
  END IF;
  RAISE NOTICE 'Workflow smoke passed; all synthetic rows rolled back';
END $$;
```

After the application deploy, verify the actual project-status picker, completed report, customer recurrence and idea promotion paths in the browser with approved test data. Check application/deployment logs for missing RPCs, ownership errors or recurrence failures. Existing completion and successor creation remain separate calls; the new successor RPC is atomic and retry-safe, but this migration adds no automatic recovery job for failed recurrence creation.

## Independent deployment split

The active-status and reporting fixes have no dependency on this migration and can deploy first:

- `src/services/projectLifecycleService.js` and its regression tests: active status writes and reopening impact lookup use existing columns only.
- `src/app/api/projects/[id]/impact/route.js`: adds `reopeningTasks` using existing lifecycle markers. Deploy before or with its UI consumer.
- `src/app/api/completed-items/route.js` and `src/app/api/notes/batch/route.js`: origin-project notes use existing `origin_project_id` columns.
- Their adjacent tests.

Keep `src/services/ideaService.js` promotion changes, the recurrence helper changes within `src/services/taskService.js`, their tests, and this migration together in the second release. `taskService.js` also contains independent remote-deletion protection coordinated with the integration agent; that hunk can be released with the corresponding integration-service contract without requiring either new RPC. Stage it separately from the recurrence helper rather than releasing the entire file prematurely. Adding `customer_id` to the service SELECT uses an existing column and can deploy independently.

Production application completed following the user's explicit approval. Post-apply catalogue checks matched all expected functions, columns, keys, indexes and permissions. The exact rollback-only smoke ran as service_role and returned Workflow smoke passed; all synthetic rows rolled back. Actual anon and authenticated execution/read attempts were denied for both RPCs and the receipt table. Receipt count remained zero. The prepared rollback remains available and was not required.
