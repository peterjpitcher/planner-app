import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { listUnfiledNotes, refileNote } from '@/services/noteService';

// GET /api/unfiled
//
// Notes with no parent at all. They arise when a project without a customer is
// deleted: the notes are kept rather than destroyed, but they have nowhere to
// live. Legal (check_note_parent permits zero parents), and they must not
// become invisible, which is why they get a panel and a nav count of their own.
export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { data, error } = await listUnfiledNotes({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/unfiled error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/unfiled/refile - move one unfiled note onto a customer
export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    if (!body?.noteId || !body?.customerId) {
      return NextResponse.json(
        { error: 'noteId and customerId are both required' },
        { status: 400 }
      );
    }

    const { data, error } = await refileNote({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      noteId: body.noteId,
      customerId: body.customerId,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('POST /api/unfiled error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
