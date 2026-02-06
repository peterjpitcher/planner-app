import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { handleSupabaseError } from '@/lib/errorHandler';
import { NextResponse } from 'next/server';

function isValidUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

// POST /api/journal/entries - Save raw entry first, AI cleanup happens separately
export async function POST(request) {
  try {
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`journal-post-${clientId}`, 20, 60000);

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() },
        }
      );
    }

    const { session, accessToken } = await getAuthContext(request);

    if (!session?.user?.id || !accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const rawContent = typeof body?.content === 'string' ? body.content : '';
    const entryId = typeof body?.entryId === 'string' ? body.entryId : null;
    const normalizedEntryId = isValidUuid(entryId) ? entryId : null;

    if (!rawContent.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    const initialAiStatus = process.env.OPENAI_API_KEY ? 'pending' : 'skipped';

    const supabase = getSupabaseServer(accessToken);
    const insertPayload = {
      user_id: session.user.id,
      content: rawContent,
      ai_status: initialAiStatus,
    };

    if (normalizedEntryId) {
      insertPayload.id = normalizedEntryId;
    }

    const { data, error } = await supabase
      .from('journal_entries')
      .insert(insertPayload)
      .select()
      .single();

    if (error) {
      if (error.code === '23505' && normalizedEntryId) {
        const { data: existing, error: fetchError } = await supabase
          .from('journal_entries')
          .select('*')
          .eq('id', normalizedEntryId)
          .eq('user_id', session.user.id)
          .maybeSingle();

        if (fetchError) {
          console.error('Supabase fetch existing entry error:', fetchError);
        }

        if (existing) {
          return NextResponse.json({
            data: existing,
            cleaned: Boolean(existing.cleaned_content),
            aiStatus: existing.ai_status,
          });
        }
      }

      console.error('Supabase insert error details:', JSON.stringify(error, null, 2));
      const errorMessage = handleSupabaseError(error, 'create');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    return NextResponse.json({
      data,
      cleaned: Boolean(data?.cleaned_content),
      aiStatus: data?.ai_status || initialAiStatus,
    });
  } catch (error) {
    console.error('POST /api/journal/entries error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// GET /api/journal/entries - Fetch journal entries
export async function GET(request) {
  try {
    const { session, accessToken } = await getAuthContext(request);

    if (!session?.user?.id || !accessToken) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const supabase = getSupabaseServer(accessToken);
    const { data, error } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false });

    if (error) {
      console.error('Supabase select error:', error);
      const errorMessage = handleSupabaseError(error, 'fetch');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    return NextResponse.json(data || []);
  } catch (error) {
    console.error('GET /api/journal/entries error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
