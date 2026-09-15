import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { listEmailFollowUps, createEmailFollowUp } from '@/services/emailFollowUpService';

// GET /api/email-follow-ups - List follow-ups, optionally filtered.
export async function GET(request) {
  try {
    // Auth first, so the limit is keyed on the user id rather than a
    // client-supplied IP header (see rateLimiter.js).
    const { session } = await getAuthContext(request);
    const clientId = getClientIdentifier(request, session?.user?.id);
    const rateLimitResult = checkRateLimit(`follow-ups-get-${clientId}`, 120, 60000);

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter.toString() } }
      );
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const filters = {};
    if (searchParams.get('state')) filters.state = searchParams.get('state');
    if (searchParams.get('mailbox')) filters.mailbox = searchParams.get('mailbox');
    if (searchParams.get('draft_status')) filters.draft_status = searchParams.get('draft_status');
    if (searchParams.get('includeClosed') === '1') filters.includeClosed = true;

    const supabase = getSupabaseServiceRole();
    const { data, error } = await listEmailFollowUps({ supabase, userId: session.user.id, filters });

    if (error) {
      return NextResponse.json({ error: error.message || 'Unable to fetch follow-ups' }, { status: error.status || 500 });
    }
    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/email-follow-ups error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/email-follow-ups - Create a follow-up by hand.
export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);
    const clientId = getClientIdentifier(request, session?.user?.id);
    const rateLimitResult = checkRateLimit(`follow-ups-post-${clientId}`, 60, 60000);

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter.toString() } }
      );
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const supabase = getSupabaseServiceRole();
    const { data, error } = await createEmailFollowUp({ supabase, userId: session.user.id, payload: body });

    if (error) {
      const response = { error: error.message || 'Unable to create follow-up' };
      if (error.details) response.details = error.details;
      return NextResponse.json(response, { status: error.status || 500 });
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
