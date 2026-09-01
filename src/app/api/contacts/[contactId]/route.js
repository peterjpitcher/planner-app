import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { deleteContact, setPrimaryContact, updateContact } from '@/services/contactService';

export async function PATCH(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { contactId } = await params;
    const body = await request.json();
    const supabase = getSupabaseServiceRole();

    // Making a contact primary is a swap, not a field update: the old primary
    // has to be cleared in the same transaction or the partial unique index
    // refuses the write.
    if (body?.makePrimary && body?.customerId) {
      const { data, error } = await setPrimaryContact({
        supabase,
        userId: session.user.id,
        customerId: body.customerId,
        contactId,
      });
      if (error) return NextResponse.json({ error: error.message }, { status: error.status });
      return NextResponse.json({ data });
    }

    const { data, error } = await updateContact({
      supabase,
      userId: session.user.id,
      contactId,
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
    console.error('PATCH /api/contacts/[contactId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { contactId } = await params;

    const { data, error } = await deleteContact({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      contactId,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('DELETE /api/contacts/[contactId] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
