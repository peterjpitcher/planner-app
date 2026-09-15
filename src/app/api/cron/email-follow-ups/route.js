import { NextResponse } from 'next/server';
import { verifyCronAuth } from '@/lib/cronAuth';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { getLondonDateKey } from '@/lib/timezone';
import { addDaysToDateKey } from '@/lib/dateUtils';
import { resolveDigestUserId } from '@/services/dailyTaskEmailService';
import { FOLLOWUP_STATE, FOLLOWUP_CHASE_MIN_DAYS } from '@/lib/constants';
import {
  upsertFollowUpByConversation,
  syncUpdateEmailFollowUp,
  listPendingForWorker,
} from '@/services/emailFollowUpService';

// The machine bridge for the inbox worker ("Jordan"). It lives under /api/cron
// so the shared-secret guard (verifyCronAuth) applies instead of a NextAuth
// session, matching every other headless caller. It is not on a Vercel
// schedule; the worker calls it on demand. If the follow-up work later moves
// fully server-side, Vercel cron can call the same route.
//
//   GET  -> the pending worklist (approved to send, redrafts, due chases)
//   POST { op: 'upsert', items: [...] }      -> sync scanned threads
//   POST { op: 'mark_sent', id, updates? }   -> record a send, re-arm the chase
//   POST { op: 'update', id, updates }       -> sync-owned fields by id

const MAX_UPSERT_ITEMS = 200;

async function resolveOwnerId(supabase) {
  const directId = (process.env.EMAIL_FOLLOWUPS_USER_ID || process.env.DIGEST_USER_ID || '').trim();
  if (directId) return directId;

  const email = (
    process.env.EMAIL_FOLLOWUPS_USER_EMAIL ||
    process.env.DIGEST_USER_EMAIL ||
    process.env.MICROSOFT_USER_EMAIL ||
    ''
  ).trim();
  if (!email) return null;

  return resolveDigestUserId({ supabase, email });
}

export async function GET(request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status || 401 });
  }

  try {
    const supabase = getSupabaseServiceRole();
    const userId = await resolveOwnerId(supabase);
    if (!userId) {
      return NextResponse.json({ error: 'Follow-up owner not configured' }, { status: 500 });
    }

    const { data, error } = await listPendingForWorker({
      supabase,
      userId,
      today: getLondonDateKey(),
    });
    if (error) {
      return NextResponse.json({ error: error.message || 'Unable to list' }, { status: error.status || 500 });
    }
    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/cron/email-follow-ups error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  const auth = verifyCronAuth(request);
  if (!auth.authorized) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: auth.status || 401 });
  }

  try {
    const body = await request.json();
    const supabase = getSupabaseServiceRole();
    const userId = await resolveOwnerId(supabase);
    if (!userId) {
      return NextResponse.json({ error: 'Follow-up owner not configured' }, { status: 500 });
    }

    const op = body?.op;

    if (op === 'upsert') {
      const items = Array.isArray(body.items) ? body.items : [];
      if (items.length > MAX_UPSERT_ITEMS) {
        return NextResponse.json({ error: `Too many items (max ${MAX_UPSERT_ITEMS})` }, { status: 400 });
      }

      const results = [];
      for (const item of items) {
        const { data, error, created } = await upsertFollowUpByConversation({ supabase, userId, payload: item });
        results.push(
          error
            ? { conversation_id: item?.conversation_id ?? null, error: error.message, details: error.details }
            : { id: data.id, created }
        );
      }
      const failed = results.filter((r) => r.error).length;
      return NextResponse.json(
        { data: { results, upserted: results.length - failed, failed } },
        { status: failed ? 207 : 200 }
      );
    }

    if (op === 'mark_sent' || op === 'update') {
      if (!body.id) {
        return NextResponse.json({ error: 'id is required' }, { status: 400 });
      }

      const updates = { ...(body.updates || {}) };

      if (op === 'mark_sent') {
        const now = new Date().toISOString();
        updates.draft_status = 'sent';
        updates.sent_at = now;
        updates.last_message_at = now;
        updates.last_message_from = 'me';
        // A send flips the thread to waiting-on-them and re-arms the chase clock
        // at the 3-day default, unless the worker set these explicitly (e.g. a
        // chase that should keep its own cadence or bump chase_count).
        if (updates.state === undefined) updates.state = FOLLOWUP_STATE.AWAITING_THEM;
        if (updates.next_chase_date === undefined) {
          updates.next_chase_date = addDaysToDateKey(getLondonDateKey(), FOLLOWUP_CHASE_MIN_DAYS);
        }
      }

      const { data, error } = await syncUpdateEmailFollowUp({ supabase, userId, id: body.id, updates });
      if (error) {
        const response = { error: error.message || 'Unable to update' };
        if (error.details) response.details = error.details;
        return NextResponse.json(response, { status: error.status || 500 });
      }
      return NextResponse.json({ data });
    }

    return NextResponse.json({ error: 'Unknown op' }, { status: 400 });
  } catch (error) {
    console.error('POST /api/cron/email-follow-ups error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
