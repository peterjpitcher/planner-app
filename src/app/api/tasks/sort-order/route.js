import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { updateSortOrder } from '@/services/taskService';

// POST /api/tasks/sort-order - Batch update task sort order
export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { items } = body;

    if (!items || !Array.isArray(items)) {
      return NextResponse.json({ error: 'items array is required' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();

    const result = await updateSortOrder({
      supabase,
      userId: session.user.id,
      items,
    });

    if (result.error) {
      return NextResponse.json({ error: result.error }, { status: 400 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error('POST /api/tasks/sort-order error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
