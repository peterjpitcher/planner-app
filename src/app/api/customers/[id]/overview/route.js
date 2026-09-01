import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { getCustomerOverview } from '@/services/customerService';

// GET /api/customers/[id]/overview
//
// Everything the customer workspace shows: the record, open and closed
// projects, and the task union. One request rather than four, because the whole
// panel changes together when you pick a different customer.
export async function GET(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    const clientId = getClientIdentifier(request, session?.user?.id);
    const rateLimitResult = checkRateLimit(`customer-overview-${clientId}`, 120, 60000);

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter.toString() } }
      );
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const { data, error } = await getCustomerOverview({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      customerId: id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/customers/[id]/overview error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
