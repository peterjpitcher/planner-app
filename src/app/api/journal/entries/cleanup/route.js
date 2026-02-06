import { OpenAI } from 'openai';
import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { handleSupabaseError } from '@/lib/errorHandler';
import { NextResponse } from 'next/server';

const CLEANUP_MODEL = process.env.JOURNAL_CLEANUP_MODEL || 'gpt-4o-mini';
const AI_TIMEOUT_MS = 20000;
const AI_MAX_RETRIES = 2;
const AI_RETRY_BASE_DELAY_MS = 1000;

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

function isValidUuid(value) {
  return typeof value === 'string' &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}

async function rewriteEntry(openai, content, signal) {
  const systemPrompt = [
    'You are an expert editor for dictated journal entries.',
    'Fix spelling, grammar, punctuation, flow, and structure.',
    'Preserve meaning, tone, and first-person voice.',
    'Do not add new facts or remove important details.',
    'If the text is already clean, return it unchanged.',
    'Return only the revised text with no commentary.',
  ].join(' ');

  const completion = await openai.chat.completions.create(
    {
      model: CLEANUP_MODEL,
      temperature: 0.2,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content },
      ],
    },
    { signal }
  );

  const cleaned = completion?.choices?.[0]?.message?.content;
  if (!cleaned || !cleaned.trim()) {
    return null;
  }

  return cleaned.trim();
}

async function attemptCleanup(openai, content) {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  let lastError = null;

  for (let attempt = 0; attempt <= AI_MAX_RETRIES; attempt += 1) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), AI_TIMEOUT_MS);

    try {
      const cleaned = await rewriteEntry(openai, content, controller.signal);
      if (!cleaned) {
        return { cleanedContent: null, status: 'failed', error: 'empty_response' };
      }
      return { cleanedContent: cleaned, status: 'cleaned', error: null };
    } catch (error) {
      const message = error?.message || 'cleanup_failed';
      const isAbort = error?.name === 'AbortError' || message.toLowerCase().includes('aborted');
      lastError = isAbort ? 'timeout' : message;

      if (attempt < AI_MAX_RETRIES) {
        await sleep(AI_RETRY_BASE_DELAY_MS * (attempt + 1));
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  return { cleanedContent: null, status: 'failed', error: lastError || 'cleanup_failed' };
}

export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json().catch(() => ({}));
    const entryId = typeof body?.entryId === 'string' ? body.entryId : null;
    const normalizedEntryId = isValidUuid(entryId) ? entryId : null;

    if (!normalizedEntryId) {
      return NextResponse.json({ error: 'Valid entryId is required' }, { status: 400 });
    }

    const supabase = getSupabaseServiceRole();

    const { data: entry, error: fetchError } = await supabase
      .from('journal_entries')
      .select('*')
      .eq('id', normalizedEntryId)
      .eq('user_id', session.user.id)
      .maybeSingle();

    if (fetchError) {
      const errorMessage = handleSupabaseError(fetchError, 'fetch');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    if (!entry) {
      return NextResponse.json({ error: 'Entry not found' }, { status: 404 });
    }

    if (entry.cleaned_content) {
      return NextResponse.json({
        data: entry,
        cleaned: true,
        aiStatus: entry.ai_status || 'cleaned',
      });
    }

    const openai = getOpenAIClient();
    if (!openai) {
      const { data: skipped } = await supabase
        .from('journal_entries')
        .update({
          ai_status: 'skipped',
          ai_error: 'missing_api_key',
          updated_at: new Date().toISOString(),
        })
        .eq('id', normalizedEntryId)
        .eq('user_id', session.user.id)
        .select()
        .single();

      return NextResponse.json({
        data: skipped || entry,
        cleaned: false,
        aiStatus: 'skipped',
      });
    }

    await supabase
      .from('journal_entries')
      .update({
        ai_status: 'pending',
        ai_error: null,
        updated_at: new Date().toISOString(),
      })
      .eq('id', normalizedEntryId)
      .eq('user_id', session.user.id);

    const rawContent = typeof entry.content === 'string' ? entry.content : '';
    if (!rawContent.trim()) {
      return NextResponse.json({ error: 'Entry content is empty' }, { status: 400 });
    }

    const { cleanedContent, status, error: aiError } = await attemptCleanup(openai, rawContent.trim());
    const updatePayload = {
      ai_status: status,
      ai_error: aiError || null,
      updated_at: new Date().toISOString(),
    };

    if (cleanedContent) {
      updatePayload.cleaned_content = cleanedContent;
      updatePayload.cleaned_at = new Date().toISOString();
    }

    const { data: updated, error: updateError } = await supabase
      .from('journal_entries')
      .update(updatePayload)
      .eq('id', normalizedEntryId)
      .eq('user_id', session.user.id)
      .select()
      .single();

    if (updateError) {
      const errorMessage = handleSupabaseError(updateError, 'update');
      return NextResponse.json({ error: errorMessage }, { status: 400 });
    }

    return NextResponse.json({
      data: updated || entry,
      cleaned: Boolean(updatePayload.cleaned_content),
      aiStatus: updatePayload.ai_status,
    });
  } catch (error) {
    console.error('POST /api/journal/entries/cleanup error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
