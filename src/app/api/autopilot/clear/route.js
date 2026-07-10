import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { getLondonDateKey } from '@/lib/timezone';
import { clearAutopilotPlan } from '@/services/autopilotService';
import { NextResponse } from 'next/server';

// POST /api/autopilot/clear — "Clear auto-plan" (F5-lite undo). Moves every task
// still purely auto-placed (autoplanned_at set, still in Today, not since
// manually touched) back to This Week, clears the flag, and deletes today's
// auto-built daily session so the review banner disappears. Session-authenticated
// and user-scoped; a manually-created evening session (auto_planned=false) is
// never deleted.
export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseServiceRole();
    const userId = session.user.id;

    let result;
    try {
      result = await clearAutopilotPlan({ supabase, userId });
    } catch (err) {
      console.error('Clear auto-plan error:', err);
      return NextResponse.json({ error: 'Failed to clear auto-plan' }, { status: 500 });
    }

    // Remove only the auto-built session for today so the banner clears. Never
    // touch a manual evening session.
    const todayKey = getLondonDateKey();
    const { error: deleteError } = await supabase
      .from('planning_sessions')
      .delete()
      .eq('user_id', userId)
      .eq('window_type', 'daily')
      .eq('window_date', todayKey)
      .eq('auto_planned', true);

    if (deleteError) {
      console.error('Clear auto-plan session delete error:', deleteError);
      // The tasks were already returned to This Week; surface a partial result
      // rather than failing the whole request.
      return NextResponse.json(
        { cleared: result.cleared, sessionDeleted: false, failures: result.failures },
        { status: 200 }
      );
    }

    return NextResponse.json(
      { cleared: result.cleared, sessionDeleted: true, failures: result.failures },
      { status: 200 }
    );
  } catch (err) {
    console.error('Autopilot clear POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
