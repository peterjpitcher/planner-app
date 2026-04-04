import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { listIdeas, createIdea } from '@/services/ideaService';

// GET /api/ideas - List ideas, optionally filtered by idea_state
export async function GET(request) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`ideas-get-${clientId}`, 120, 60000); // 120 requests per minute

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() }
        }
      );
    }

    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { searchParams } = new URL(request.url);
    const ideaState = searchParams.get('idea_state');

    const supabase = getSupabaseServiceRole();
    const { data, error } = await listIdeas({
      supabase,
      userId: session.user.id,
      filters: ideaState ? { idea_state: ideaState } : {},
    });

    if (error) {
      return NextResponse.json({ error: error.message || 'Unable to fetch ideas' }, { status: error.status || 500 });
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/ideas error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/ideas - Create a new idea
export async function POST(request) {
  try {
    // Rate limiting
    const clientId = getClientIdentifier(request);
    const rateLimitResult = checkRateLimit(`ideas-post-${clientId}`, 30, 60000); // 30 creates per minute

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        {
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() }
        }
      );
    }

    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const supabase = getSupabaseServiceRole();
    const { data, error } = await createIdea({
      supabase,
      userId: session.user.id,
      payload: body,
    });

    if (error) {
      const response = { error: error.message || 'Unable to create idea' };
      if (error.details) {
        response.details = error.details;
      }
      return NextResponse.json(response, { status: error.status || 500 });
    }

    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
