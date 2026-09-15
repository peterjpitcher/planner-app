-- ============================================================
-- Email follow-ups: the reply-and-chase tracker
-- ============================================================
--
-- One row per email conversation that needs action: something waiting on a
-- reply from Peter, or something Peter is waiting on from someone else. An
-- external agent (the "Jordan" inbox worker) keeps the sync-owned fields in
-- step with the Orange Jelly / Anchor mailbox and proposes a draft; Peter sets
-- the draft_status and feedback in the UI; the agent sends what he approves.
--
-- Purely additive: a new table only. It references the existing customers
-- composite key (id, user_id) added in 20260901000002 and the shared
-- update_updated_at_column() trigger function. Nothing else is touched.
--
-- Requires 20260901000002_phase1_customers.sql (customers_id_user_unique).

BEGIN;

CREATE TABLE IF NOT EXISTS public.email_follow_ups (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,

  -- Which mailbox / brand this thread belongs to. Both land in
  -- peter@orangejelly.co.uk, so the brand is a label, not a separate account.
  mailbox            text NOT NULL DEFAULT 'orangejelly',

  -- Graph identifiers. conversation_id is the thread key the sync upserts on;
  -- message_id is the latest message, used to reply in-thread.
  conversation_id    text,
  message_id         text,

  -- The other party and what the thread is about.
  counterpart_name   text,
  counterpart_email  text,
  subject            text,
  needs              text,

  -- Who is waiting on whom, and who sent the last message.
  state              text NOT NULL DEFAULT 'awaiting_me',
  last_message_at    timestamptz,
  last_message_from  text,

  -- The proposed reply/chase and where it is in the approval loop.
  proposed_draft     text,
  draft_status       text NOT NULL DEFAULT 'none',

  -- Peter's controls. Never written by the sync, so his feedback is safe.
  feedback           text,
  urgent             boolean NOT NULL DEFAULT false,

  -- Chase pacing. next_chase_date is the earliest a chase should go out; the
  -- default rule is last outbound + 3 days unless urgent.
  next_chase_date    date,
  chase_count        integer NOT NULL DEFAULT 0,

  sent_at            timestamptz,

  -- Optional link to a customer record, same-owner enforced.
  customer_id        uuid,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),

  CONSTRAINT email_follow_ups_mailbox_check
    CHECK (mailbox IN ('orangejelly', 'anchor')),
  CONSTRAINT email_follow_ups_state_check
    CHECK (state IN ('awaiting_me', 'awaiting_them', 'closed')),
  CONSTRAINT email_follow_ups_draft_status_check
    CHECK (draft_status IN ('none', 'ready', 'approved', 'edit_requested', 'hold', 'sent')),
  CONSTRAINT email_follow_ups_last_from_check
    CHECK (last_message_from IS NULL OR last_message_from IN ('me', 'them')),
  CONSTRAINT email_follow_ups_subject_length
    CHECK (subject IS NULL OR length(subject) <= 500),
  CONSTRAINT email_follow_ups_needs_length
    CHECK (needs IS NULL OR length(needs) <= 1000),
  CONSTRAINT email_follow_ups_draft_length
    CHECK (proposed_draft IS NULL OR length(proposed_draft) <= 20000),
  CONSTRAINT email_follow_ups_feedback_length
    CHECK (feedback IS NULL OR length(feedback) <= 5000),
  CONSTRAINT email_follow_ups_name_length
    CHECK (counterpart_name IS NULL OR length(counterpart_name) <= 200),
  CONSTRAINT email_follow_ups_email_length
    CHECK (counterpart_email IS NULL OR length(counterpart_email) <= 320),
  CONSTRAINT email_follow_ups_conversation_length
    CHECK (conversation_id IS NULL OR length(conversation_id) <= 500),
  CONSTRAINT email_follow_ups_message_length
    CHECK (message_id IS NULL OR length(message_id) <= 500),
  CONSTRAINT email_follow_ups_chase_count_nonneg
    CHECK (chase_count >= 0),

  -- SET NULL (customer_id), not CASCADE: deleting a customer must never destroy
  -- the follow-up. The column-list form needs PostgreSQL 15 (this project is on
  -- 15.8) and matches the pattern in 20260901000002.
  CONSTRAINT email_follow_ups_customer_fkey
    FOREIGN KEY (customer_id, user_id)
    REFERENCES public.customers(id, user_id) ON DELETE SET NULL (customer_id)
);

-- id is already unique via the primary key; the composite unique exists only so
-- (id, user_id) can be a foreign-key target later, mirroring the neighbours.
ALTER TABLE public.email_follow_ups
  ADD CONSTRAINT email_follow_ups_id_user_unique UNIQUE (id, user_id);

-- One follow-up per conversation per user. This is what makes the sync
-- idempotent: re-scanning the same thread updates the row instead of adding a
-- second. Partial, because a manually created row may have no conversation_id.
CREATE UNIQUE INDEX IF NOT EXISTS email_follow_ups_user_conversation_unique
  ON public.email_follow_ups (user_id, conversation_id)
  WHERE conversation_id IS NOT NULL;

-- The dashboard reads open rows by state; closed rows drop out of the index.
CREATE INDEX IF NOT EXISTS email_follow_ups_user_state_idx
  ON public.email_follow_ups (user_id, state)
  WHERE state <> 'closed';

-- The chase sweep reads awaiting_them rows whose next_chase_date has arrived.
CREATE INDEX IF NOT EXISTS email_follow_ups_user_chase_idx
  ON public.email_follow_ups (user_id, next_chase_date)
  WHERE state = 'awaiting_them';

DROP TRIGGER IF EXISTS trg_email_follow_ups_updated_at ON public.email_follow_ups;
CREATE TRIGGER trg_email_follow_ups_updated_at
  BEFORE UPDATE ON public.email_follow_ups
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.email_follow_ups ENABLE ROW LEVEL SECURITY;

-- Per-user only. Deliberately NOT the USING (true) pattern Phase 0 removed:
-- permissive policies OR together, so one of those makes every other policy on
-- the table pointless. Every route uses the service-role client (which bypasses
-- RLS), so authorization also rests on an explicit user_id filter in the code.
DROP POLICY IF EXISTS email_follow_ups_own ON public.email_follow_ups;
CREATE POLICY email_follow_ups_own ON public.email_follow_ups
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

COMMIT;
