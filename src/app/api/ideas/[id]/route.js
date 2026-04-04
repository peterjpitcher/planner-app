import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { updateIdea, deleteIdea } from '@/services/ideaService';

// PATCH /api/ideas/[id] - Update an idea
export async function PATCH(request, { params }) {
  try {
    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const body = await request.json();
    const supabase = getSupabaseServiceRole();

    const { data, error } = await updateIdea({
      supabase,
      userId: session.user.id,
      ideaId: id,
      updates: body,
    });

    if (error) {
      return NextResponse.json({ error: error.message || 'Unable to update idea' }, { status: error.status || 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/ideas/[id] - Delete an idea
export async function DELETE(request, { params }) {
  try {
    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseServiceRole();

    const { data, error } = await deleteIdea({
      supabase,
      userId: session.user.id,
      ideaId: id,
    });

    if (error) {
      return NextResponse.json({ error: error.message || 'Unable to delete idea' }, { status: error.status || 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
