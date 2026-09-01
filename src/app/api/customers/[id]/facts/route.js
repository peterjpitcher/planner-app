import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { createFact, getCustomer, listFacts } from '@/services/customerService';

export async function GET(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const supabase = getSupabaseServiceRole();

    const { error: ownerError } = await getCustomer({ supabase, userId: session.user.id, customerId: id });
    if (ownerError) return NextResponse.json({ error: ownerError.message }, { status: ownerError.status });

    const { data, error } = await listFacts({ supabase, userId: session.user.id, customerId: id });
    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/customers/[id]/facts error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { id } = await params;
    const body = await request.json();

    const { data, error } = await createFact({
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
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('POST /api/customers/[id]/facts error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
