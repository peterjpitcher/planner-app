import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { promoteIdea } from '@/services/ideaService';

// POST /api/ideas/[id]/promote - Promote an idea to a task
export async function POST(request, { params }) {
  try {
    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;
    const supabase = getSupabaseServiceRole();

    const { data, error } = await promoteIdea({
      supabase,
      userId: session.user.id,
      ideaId: id,
    });

    if (error) {
      return NextResponse.json({ error: error.message || 'Unable to promote idea' }, { status: error.status || 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
