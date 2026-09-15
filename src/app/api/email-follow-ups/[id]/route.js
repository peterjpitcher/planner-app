import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { updateEmailFollowUp, deleteEmailFollowUp } from '@/services/emailFollowUpService';

// PATCH /api/email-follow-ups/[id] - Update a follow-up (Peter's controls).
export async function PATCH(request, { params }) {
  try {
    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const supabase = getSupabaseServiceRole();

    const { data, error } = await updateEmailFollowUp({
      supabase,
      userId: session.user.id,
      id,
      updates: body,
    });

    if (error) {
      const response = { error: error.message || 'Unable to update follow-up' };
      if (error.details) response.details = error.details;
      return NextResponse.json(response, { status: error.status || 500 });
    }
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/email-follow-ups/[id] - Delete a follow-up.
export async function DELETE(request, { params }) {
  try {
    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseServiceRole();

    const { data, error } = await deleteEmailFollowUp({
      supabase,
      userId: session.user.id,
      id,
    });

    if (error) {
      return NextResponse.json({ error: error.message || 'Unable to delete follow-up' }, { status: error.status || 500 });
    }
    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
