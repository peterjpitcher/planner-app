import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';

// GET /api/areas — returns deduplicated area values (case-insensitive)
// Used by area dropdown in TaskCard quick actions
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const userId = session.user.id;
    const supabase = getSupabaseServiceRole();

    // Fetch all non-null areas from tasks and projects for this user
    const [{ data: taskAreas }, { data: projectAreas }] = await Promise.all([
      supabase
        .from('tasks')
        .select('area')
        .eq('user_id', userId)
        .not('area', 'is', null),
      supabase
        .from('projects')
        .select('area')
        .eq('user_id', userId)
        .not('area', 'is', null),
    ]);

    // Case-insensitive dedup — first occurrence wins
    const seen = new Map();
    [...(taskAreas || []), ...(projectAreas || [])].forEach(row => {
      const key = row.area.toLowerCase();
      if (!seen.has(key)) seen.set(key, row.area);
    });

    return NextResponse.json({ data: Array.from(seen.values()).sort() });
  } catch (error) {
    console.error('GET /api/areas error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
