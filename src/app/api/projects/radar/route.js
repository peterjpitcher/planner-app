import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { fetchProjectRadar } from '@/services/projectRadarService';

// GET /api/projects/radar — Wave 5 project-altitude radar.
// Returns the caller's non-terminal projects (Open / On Hold) with a
// "needs a next action" (stalled) classification, computed from existing
// project + task data — no migration, no new columns. The service-role client
// is fine here because every query is scoped by user_id. No secrets returned.
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseServiceRole();
    const radar = await fetchProjectRadar({
      supabase,
      userId: session.user.id,
      nowMs: Date.now(),
    });

    return NextResponse.json(radar);
  } catch (error) {
    console.error('GET /api/projects/radar error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
