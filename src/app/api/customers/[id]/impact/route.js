import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { getCustomer, getCustomerImpact } from '@/services/customerService';

// GET /api/customers/[id]/impact
//
// What archiving or deleting this customer would affect. Never cached: it has
// to reflect the state at the moment the user is asked to confirm, which is the
// same reason /api/projects/[id]/impact is not cached either.
export async function GET(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseServiceRole();

    // Ownership is checked before counting, so a probe cannot learn how much
    // work another user has by reading the counts back.
    const { error: ownerError } = await getCustomer({
      supabase,
      userId: session.user.id,
      customerId: id,
    });
    if (ownerError) {
      return NextResponse.json({ error: ownerError.message }, { status: ownerError.status });
    }

    const { data, error } = await getCustomerImpact({
      supabase,
      userId: session.user.id,
      customerId: id,
    });

    if (error) {
      console.error('GET /api/customers/[id]/impact failed:', error);
      return NextResponse.json({ error: 'Failed to load impact' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/customers/[id]/impact error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
