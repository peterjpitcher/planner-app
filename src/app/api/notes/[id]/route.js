import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { deleteNote, updateNote } from '@/services/noteService';

async function authorise(request, limitKey, max) {
  const { session } = await getAuthContext(request);
  const clientId = getClientIdentifier(request, session?.user?.id);
  const rateLimitResult = checkRateLimit(`${limitKey}-${clientId}`, max, 60000);

  if (!rateLimitResult.allowed) {
    return {
      session: null,
      response: NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter.toString() } }
      ),
    };
  }

  if (!session?.user?.id) {
    return { session: null, response: NextResponse.json({ error: 'Unauthorized' }, { status: 401 }) };
  }

  return { session, response: null };
}

// PATCH /api/notes/[id]
//
// Notes were previously write-once: there was no way to fix a typo or correct a
// date. Editing also clears the lifecycle marker, so a note you have touched is
// yours and reopening its old project will not drag it back.
export async function PATCH(request, { params }) {
  try {
    const { session, response } = await authorise(request, 'notes-patch', 60);
    if (response) return response;

    const { id } = await params;
    const body = await request.json();

    const { data, error } = await updateNote({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      noteId: id,
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
    console.error('PATCH /api/notes/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// DELETE /api/notes/[id]
export async function DELETE(request, { params }) {
  try {
    const { session, response } = await authorise(request, 'notes-delete', 30);
    if (response) return response;

    const { id } = await params;

    const { data, error } = await deleteNote({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      noteId: id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('DELETE /api/notes/[id] error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
