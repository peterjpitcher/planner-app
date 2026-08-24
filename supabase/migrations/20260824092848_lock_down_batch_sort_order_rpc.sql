-- Close the last unauthenticated write path into public.tasks.
--
-- 20260527061836_security_hardening_2026_05_27.sql revoked EXECUTE on exec_sql
-- and the vault_* helpers but missed fn_batch_update_sort_order, which is the
-- one SECURITY DEFINER function that actually writes user rows. Its only
-- ownership check is the p_user_id argument the caller supplies, and EXECUTE was
-- still held by PUBLIC, anon and authenticated. Because the anon key ships in
-- the client bundle by design, anyone holding it could POST to
-- /rest/v1/rpc/fn_batch_update_sort_order with any user id and rewrite that
-- user's task ordering, with no session involved and RLS bypassed by the
-- SECURITY DEFINER context.
--
-- The application only ever calls this through the service-role client
-- (src/services/taskService.js), and service_role keeps EXECUTE, so no
-- application path changes.
REVOKE EXECUTE ON FUNCTION public.fn_batch_update_sort_order(uuid, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.fn_batch_update_sort_order(uuid, jsonb) FROM anon;
REVOKE EXECUTE ON FUNCTION public.fn_batch_update_sort_order(uuid, jsonb) FROM authenticated;
GRANT EXECUTE ON FUNCTION public.fn_batch_update_sort_order(uuid, jsonb) TO service_role;

-- Pin the search_path on the one trigger function that drifted. Every other
-- function in public already carries "SET search_path" after the hardening
-- migration and 20260813113504_restore_task_cleanup_search_path.sql; this one
-- was created before that rule and never caught up, so a role with a mutable
-- search_path could shadow the objects it resolves.
CREATE OR REPLACE FUNCTION public.fn_project_completed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public', 'pg_catalog'
AS $function$
BEGIN
  IF NEW.status = 'Completed' AND (OLD IS NULL OR OLD.status <> 'Completed') THEN
    NEW.completed_at := COALESCE(NEW.completed_at, now());
  END IF;
  IF OLD IS NOT NULL AND NEW.status <> 'Completed' AND OLD.status = 'Completed' THEN
    NEW.completed_at := NULL;
  END IF;
  RETURN NEW;
END;
$function$;
