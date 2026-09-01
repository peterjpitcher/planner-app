import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { applyTriage, getTriageData } from '@/services/customerService';

// GET /api/customers/triage
//
// Every distinct stakeholder name with the projects using it, plus a profile of
// what is actually in the column (blanks, embedded commas, email-like entries),
// and every project that still has no customer.
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await getTriageData({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/customers/triage error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/customers/triage
//
// Applies the confirmed decisions. Nothing is written until this is called, so
// the screen can be explored freely before committing.
export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);
    const clientId = getClientIdentifier(request, session?.user?.id);
    const rateLimitResult = checkRateLimit(`customers-triage-${clientId}`, 10, 60000);

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

    const { data, error } = await applyTriage({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      customerNames: Array.isArray(body?.customerNames) ? body.customerNames : [],
      assignments: Array.isArray(body?.assignments) ? body.assignments : [],
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('POST /api/customers/triage error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
