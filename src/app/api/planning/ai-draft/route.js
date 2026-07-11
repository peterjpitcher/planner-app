import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { getLondonDateKey } from '@/lib/timezone';
import { sortTasksByPriority } from '@/lib/taskSort';
import { fetchAutopilotPool } from '@/services/autopilotService';
import { draftPlanWithAI } from '@/services/aiPlannerService';
import { SOFT_CAPS } from '@/lib/constants';

// A5 (Wave 8) — on-demand "Draft my day with AI" for the planning modal.
//
// ADVISORY ONLY: this fetches the caller's daily candidate pool, asks the model
// to arrange it, and returns the suggested { taskId, section, reason } per task.
// It does NOT place any task — the modal pre-selects the suggestions and the user
// confirms. On any problem (AI opted out, unconfigured, no candidates, or an AI
// error) it returns an empty assignments array so the modal falls back to manual.
export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    const userId = session.user.id;

    const supabase = getSupabaseServiceRole();
    const todayKey = getLondonDateKey();

    // Respect the opt-in server-side (defence in depth): never call OpenAI for a
    // user who has not enabled AI planning, regardless of what the UI sends.
    const { data: settings } = await supabase
      .from('user_settings')
      .select('ai_planning_enabled')
      .eq('user_id', userId)
      .maybeSingle();
    if (settings?.ai_planning_enabled !== true) {
      return NextResponse.json({ assignments: [] });
    }

    const pool = await fetchAutopilotPool({ supabase, userId, windowDate: todayKey });
    const ranked = sortTasksByPriority(pool, { todayKey });
    const aiPlan = await draftPlanWithAI({ candidates: ranked, caps: SOFT_CAPS, todayKey });

    return NextResponse.json({ assignments: aiPlan?.assignments || [] });
  } catch (error) {
    // Fail soft: the modal falls back to manual planning on an empty array.
    console.error('AI draft route failed:', error?.message || error);
    return NextResponse.json({ assignments: [] });
  }
}
