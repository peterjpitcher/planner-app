import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';

// GET /api/planning-sessions?windowType=daily&windowDate=2026-04-15
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const windowType = searchParams.get('windowType');
    const windowDate = searchParams.get('windowDate');

    if (!windowType || !['daily', 'weekly'].includes(windowType)) {
      return NextResponse.json({ error: 'Invalid windowType' }, { status: 400 });
    }
    if (!windowDate || !/^\d{4}-\d{2}-\d{2}$/.test(windowDate)) {
      return NextResponse.json({ error: 'Invalid windowDate' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('planning_sessions')
      .select('id, window_type, window_date, completed_at')
      .eq('user_id', session.user.id)
      .eq('window_type', windowType)
      .eq('window_date', windowDate)
      .maybeSingle();

    if (error) {
      console.error('Planning session lookup error:', error);
      return NextResponse.json({ error: 'Failed to check planning session' }, { status: 500 });
    }

    return NextResponse.json({ data: data || null });
  } catch (err) {
    console.error('Planning sessions GET error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/planning-sessions — upsert a completed session
export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const { windowType, windowDate } = body;

    if (!windowType || !['daily', 'weekly'].includes(windowType)) {
      return NextResponse.json({ error: 'Invalid windowType' }, { status: 400 });
    }
    if (!windowDate || !/^\d{4}-\d{2}-\d{2}$/.test(windowDate)) {
      return NextResponse.json({ error: 'Invalid windowDate' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('planning_sessions')
      .upsert(
        {
          user_id: session.user.id,
          window_type: windowType,
          window_date: windowDate,
          completed_at: new Date().toISOString(),
        },
        { onConflict: 'user_id,window_type,window_date' }
      )
      .select('id, window_type, window_date, completed_at')
      .single();

    if (error) {
      console.error('Planning session upsert error:', error);
      return NextResponse.json({ error: 'Failed to record planning session' }, { status: 500 });
    }

    return NextResponse.json({ data });
  } catch (err) {
    console.error('Planning sessions POST error:', err);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
