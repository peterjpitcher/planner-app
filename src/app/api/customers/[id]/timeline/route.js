import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { getCustomer } from '@/services/customerService';
import { getCustomerTimeline } from '@/services/noteService';

// GET /api/customers/[id]/timeline
//
// Every note that reaches this customer: filed directly on them, on one of
// their projects (open or closed), or on one of their tasks. Closing a project
// must not make its notes disappear from the customer's record, which is the
// whole reason the roll-up exists.
export async function GET(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseServiceRole();

    // Ownership before contents, so a probe cannot read another user's notes.
    const { error: ownerError } = await getCustomer({
      supabase,
      userId: session.user.id,
      customerId: id,
    });
    if (ownerError) {
      return NextResponse.json({ error: ownerError.message }, { status: ownerError.status });
    }

    const { data, error } = await getCustomerTimeline({
      supabase,
      userId: session.user.id,
      customerId: id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/customers/[id]/timeline error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
