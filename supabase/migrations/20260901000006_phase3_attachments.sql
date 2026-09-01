-- ============================================================
-- Customers, Phase 3: attachments
-- ============================================================
--
-- Spec: docs/superpowers/specs/2026-09-01-customers-crm-design.md section 8.
--
-- Requires 20260901000004_phase2_record.sql.

BEGIN;

-- ------------------------------------------------------------
-- 1. The bucket
-- ------------------------------------------------------------
--
-- Private, and deliberately given NO policies for anon or authenticated.
--
-- Auth here is NextAuth, not Supabase Auth, so there is no Supabase JWT for the
-- logged-in user and auth.uid() is NULL inside a storage policy. The standard
-- documented folder policy (auth.uid()::text = (storage.foldername(name))[1])
-- would therefore deny everything, or, written loosely, allow everything.
-- Security rests entirely on the NextAuth session check plus an explicit
-- user_id check in the route, exactly as it does for every table.
--
-- The size and MIME limits are enforced by the bucket as well as the route, so
-- a bug in the route cannot let a 2 GB file through.

INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'attachments',
  'attachments',
  false,
  26214400, -- 25 MB
  ARRAY[
    'application/pdf',
    'image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/heic',
    'application/msword',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-powerpoint',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'text/csv', 'text/plain',
    'application/zip', 'application/x-zip-compressed',
    'message/rfc822', 'application/vnd.ms-outlook'
  ]
)
ON CONFLICT (id) DO UPDATE
  SET public = false,
      file_size_limit = EXCLUDED.file_size_limit,
      allowed_mime_types = EXCLUDED.allowed_mime_types;

-- image/svg+xml and text/html are absent on purpose: both can carry script.
-- They would execute on the Supabase origin rather than the app's, so they
-- cannot touch app cookies, but there is no reason to host them.

-- ------------------------------------------------------------
-- 2. attachments
-- ------------------------------------------------------------
--
-- The row exists BEFORE the file does, and is the authorisation record.
--
-- The alternative, issuing a signed URL and then trusting the client's declared
-- size and type, makes the 25 MB cap and the MIME allowlist decorative: a
-- signed upload authorises a transfer, it does not promise the finished object
-- matches the JSON that asked for it. A client could declare 1 MB and upload
-- 500 MB, or hand back a path that was never issued to it.

CREATE TABLE IF NOT EXISTS public.attachments (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  customer_id        uuid,
  project_id         uuid,
  task_id            uuid,
  note_id            uuid REFERENCES public.notes(id) ON DELETE SET NULL,
  origin_project_id  uuid,
  lifecycle_move_id  uuid,
  lifecycle_moved_at timestamptz,
  storage_path       text NOT NULL UNIQUE,
  file_name          text NOT NULL,
  mime_type          text,
  size_bytes         bigint,
  status             text NOT NULL DEFAULT 'pending',
  upload_expires_at  timestamptz,
  ready_at           timestamptz,
  deleting_at        timestamptz,
  last_error         text,
  context_label      text,
  created_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT attachments_status_check
    CHECK (status IN ('pending', 'ready', 'deleting', 'failed')),
  -- size_bytes is null until finalisation, because until the object is on disk
  -- the server has not measured it. A ready row must have been measured.
  CONSTRAINT attachments_ready_has_size
    CHECK (status <> 'ready' OR (size_bytes IS NOT NULL AND size_bytes > 0)),
  CONSTRAINT attachments_size_positive
    CHECK (size_bytes IS NULL OR size_bytes > 0),
  CONSTRAINT attachments_file_name_length CHECK (length(file_name) <= 255),
  -- At most one parent, or none (unfiled), matching notes.
  CONSTRAINT check_attachment_parent CHECK (
    (CASE WHEN customer_id IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN project_id  IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN task_id     IS NOT NULL THEN 1 ELSE 0 END
   + CASE WHEN note_id     IS NOT NULL THEN 1 ELSE 0 END) <= 1
  ),

  -- Every parent is SET NULL, never CASCADE. A file is never destroyed as a
  -- side effect of deleting something else: the application decides, and says
  -- so first.
  CONSTRAINT attachments_customer_fkey
    FOREIGN KEY (customer_id, user_id)
    REFERENCES public.customers(id, user_id) ON DELETE SET NULL (customer_id),
  CONSTRAINT attachments_project_fkey
    FOREIGN KEY (project_id, user_id)
    REFERENCES public.projects(id, user_id) ON DELETE SET NULL (project_id),
  CONSTRAINT attachments_task_fkey
    FOREIGN KEY (task_id, user_id)
    REFERENCES public.tasks(id, user_id) ON DELETE SET NULL (task_id),
  CONSTRAINT attachments_origin_project_fkey
    FOREIGN KEY (origin_project_id, user_id)
    REFERENCES public.projects(id, user_id) ON DELETE SET NULL (origin_project_id)
);

CREATE INDEX IF NOT EXISTS attachments_customer_idx
  ON public.attachments (customer_id, created_at DESC) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS attachments_project_idx
  ON public.attachments (project_id, created_at DESC) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS attachments_task_idx
  ON public.attachments (task_id, created_at DESC) WHERE status = 'ready';
CREATE INDEX IF NOT EXISTS attachments_note_idx
  ON public.attachments (note_id) WHERE status = 'ready';

-- Reconciliation is database-driven, not a bucket scan: storage.list() returns
-- 100 objects by default and lists one folder level, so "list the bucket and
-- compare" would silently stop after 100 rows and never recurse.
CREATE INDEX IF NOT EXISTS attachments_stale_pending_idx
  ON public.attachments (upload_expires_at) WHERE status = 'pending';
CREATE INDEX IF NOT EXISTS attachments_stuck_deleting_idx
  ON public.attachments (deleting_at) WHERE status = 'deleting';

ALTER TABLE public.attachments ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS attachments_own ON public.attachments;
CREATE POLICY attachments_own ON public.attachments
  FOR ALL TO authenticated
  USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

-- ------------------------------------------------------------
-- 3. Files follow their notes through the lifecycle
-- ------------------------------------------------------------
--
-- Phase 2's RPCs move notes on close, reopen and delete. From here they move
-- files the same way. Replacing the functions rather than adding new ones keeps
-- one implementation per operation.

CREATE OR REPLACE FUNCTION public.fn_move_project_attachments(
  p_project_id  uuid,
  p_user_id     uuid,
  p_customer_id uuid,
  p_move_id     uuid,
  p_label       text
)
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_catalog
AS $$
DECLARE v_count int := 0;
BEGIN
  IF p_customer_id IS NULL THEN RETURN 0; END IF;

  WITH moved AS (
    UPDATE public.attachments
       SET customer_id = p_customer_id,
           project_id = NULL,
           origin_project_id = p_project_id,
           lifecycle_move_id = p_move_id,
           lifecycle_moved_at = now(),
           context_label = p_label
     WHERE project_id = p_project_id
       AND user_id = p_user_id
       AND status = 'ready'
    RETURNING id
  )
  SELECT count(*) INTO v_count FROM moved;

  RETURN v_count;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.fn_move_project_attachments(uuid, uuid, uuid, uuid, text)
  FROM PUBLIC, anon, authenticated;

COMMIT;
