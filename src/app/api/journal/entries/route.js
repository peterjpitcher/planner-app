import { OpenAI } from 'openai';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { getSupabaseServer } from '@/lib/supabaseServer';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { handleSupabaseError } from '@/lib/errorHandler';
import { NextResponse } from 'next/server';

let openaiClient;

function getOpenAIClient() {
  if (!process.env.OPENAI_API_KEY) {
    return null;
  }

  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });
  }

  return openaiClient;
}

async function rewriteEntry(openai, content) {
  if (!openai) return null;

  const systemPrompt = [
    'You are an expert editor for dictated journal entries.',
    'Fix spelling, grammar, punctuation, flow, and structure.',
    'Preserve meaning, tone, and first-person voice.',
    'Do not add new facts or remove important details.',
    'If the text is already clean, return it unchanged.',
    'Return only the revised text with no commentary.',
  ].join(' ');

  const completion = await openai.chat.completions.create({
    model: 'gpt-4o',
    temperature: 0.2,
    messages: [
      { role: 'system', content: systemPrompt },
      { role: 'user', content },
    ],
  });

  const cleaned = completion?.choices?.[0]?.message?.content;
  if (!cleaned || !cleaned.trim()) {
    return null;
  }

  return cleaned.trim();
}

// POST /api/journal/entries - Clean and save a journal entry (fail-open on AI)
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

    const session = await getServerSession(authOptions);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();
    const rawContent = typeof body?.content === 'string' ? body.content : '';

    if (!rawContent.trim()) {
      return NextResponse.json({ error: 'Content is required' }, { status: 400 });
    }

    let cleaned = false;
    let finalContent = rawContent;

    const openai = getOpenAIClient();
    if (openai) {
      try {
        const rewritten = await rewriteEntry(openai, rawContent.trim());
        if (rewritten) {
          finalContent = rewritten;
          cleaned = true;
        }
      } catch (error) {
        console.warn('Journal AI cleanup failed, saving raw content:', error);
      }
    }

    const supabase = getSupabaseServer(session.accessToken);
    const { data, error } = await supabase
      .from('journal_entries')
      .insert({
        user_id: session.user.id,
        content: finalContent,
      })
      .select()
      .single();

    if (error) {
      const errorMessage = handleSupabaseError(error, 'create');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    return NextResponse.json({ data, cleaned });
  } catch (error) {
    console.error('POST /api/journal/entries error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
