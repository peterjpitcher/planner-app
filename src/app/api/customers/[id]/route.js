import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { deleteCustomer, getCustomer, updateCustomer } from '@/services/customerService';

async function authorise(request, limitKey, max = 60) {
  const { session } = await getAuthContext(request);
  const clientId = getClientIdentifier(request, session?.user?.id);
  const rateLimitResult = checkRateLimit(`${limitKey}-${clientId}`, max, 60000);

  if (!rateLimitResult.allowed) {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter.toString() } }
      ),
    };
  }

  if (!session?.user?.id) {
    return {
      session: null,
      response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }),
    };
  }

  return { session, response: null };
}

// GET /api/customers/[id]
export async function GET(request, { params }) {
  try {
    const { session, response } = await authorise(request, 'customer-get', 120);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await getCustomer({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      customerId: id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/customers/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// PATCH /api/customers/[id] - update, archive or unarchive
export async function PATCH(request, { params }) {
  try {
    const { session, response } = await authorise(request, 'customer-patch', 60);
    if (response) return response;

    const { id } = await params;
    const body = await request.json();

    const { data, error } = await updateCustomer({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      customerId: id,
      payload: body,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message, ...(error.details ? { details: error.details } : {}) },
        { status: error.status }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('PATCH /api/customers/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/customers/[id]
//
// Removes the customer record. Projects and tasks survive with customer_id
// cleared, because the composite foreign keys are ON DELETE SET NULL
// (customer_id). The confirmation dialog states this before the button is live.
export async function DELETE(request, { params }) {
  try {
    const { session, response } = await authorise(request, 'customer-delete', 30);
    if (response) return response;

    const { id } = await params;
    const { data, error } = await deleteCustomer({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      customerId: id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('DELETE /api/customers/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
