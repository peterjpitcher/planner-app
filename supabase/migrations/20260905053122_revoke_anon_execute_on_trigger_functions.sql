-- Take EXECUTE away from anon and PUBLIC on trigger functions.
--
-- Applied to production on 5 September 2026. A trigger function is invoked by its
-- trigger, never called directly, so no API role needs EXECUTE on it. These held
-- it only through the default privileges CREATE FUNCTION applies.

REVOKE EXECUTE ON FUNCTION public.fn_project_completed_at() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_project_customer_cascade() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_task_customer_sync() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.fn_task_state_cleanup() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_updated_at_column() FROM PUBLIC, anon;
REVOKE EXECUTE ON FUNCTION public.update_user_settings_updated_at() FROM PUBLIC, anon;
