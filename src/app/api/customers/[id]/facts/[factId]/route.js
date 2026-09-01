import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { deleteFact, updateFact } from '@/services/customerService';

export async function PATCH(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { factId } = await params;
    const body = await request.json();

    const { data, error } = await updateFact({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      factId,
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
    console.error('PATCH fact error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function DELETE(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { factId } = await params;

    const { data, error } = await deleteFact({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      factId,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('DELETE fact error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
