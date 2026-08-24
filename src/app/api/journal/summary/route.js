import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';
import { fromZonedTime } from 'date-fns-tz';
import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { LONDON_TIME_ZONE } from '@/lib/timezone';

let openaiClient;
const MAX_ENTRIES = 120;
const MAX_TOTAL_CHARS = 60000;
const RANGE_DAYS = { weekly: 7, monthly: 30, annual: 365 };

function isDateKey(value) {
    return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);
}

/**
 * The instant range a summary covers, in London terms.
 *
 * A custom range runs from the start of its first day to the end of its last,
 * both in London. Doing this server-side also fixes the client's asymmetry,
 * where the start was parsed as UTC midnight but the end as local end of day.
 */
function resolveRange(type, dates) {
    if (type === 'custom') {
        if (!isDateKey(dates?.start) || !isDateKey(dates?.end)) return null;
        if (dates.end < dates.start) return null;
        return {
            from: fromZonedTime(`${dates.start} 00:00:00`, LONDON_TIME_ZONE).toISOString(),
            to: fromZonedTime(`${dates.end} 23:59:59.999`, LONDON_TIME_ZONE).toISOString(),
        };
    }
    const days = RANGE_DAYS[type] ?? RANGE_DAYS.weekly;
    const now = new Date();
    const from = new Date(now.getTime() - days * 24 * 60 * 60 * 1000);
    return { from: from.toISOString(), to: now.toISOString() };
}

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

function extractBulletPoints(text) {
    if (!text || typeof text !== 'string') {
        return [];
    }

    const lines = text
        .split('\n')
        .map((line) => line.trim())
        .filter(Boolean);

    const isBullet = (line) => /^[-*\u2022]\s+/.test(line) || /^\d+[.)]\s+/.test(line);
    const bulletLines = lines.filter(isBullet);
    const sourceLines = bulletLines.length > 0 ? bulletLines : lines;

    const points = sourceLines
        .map((line) => line.replace(/^[-*\u2022]\s+/, '').replace(/^\d+[.)]\s+/, '').trim())
        .filter(Boolean);

    if (points.length > 0) {
        return points;
    }

    const fallback = text.trim();
    return fallback ? [fallback] : [];
}

export async function POST(req) {
    try {
        // Resolve the session before rate limiting so the limit is keyed on the
        // authenticated user id rather than a client-supplied IP header, matching
        // /api/journal/entries.
        const { session } = await getAuthContext(req, { requireAccessToken: false });
        const clientId = getClientIdentifier(req, session?.user?.id);
        const rateLimitResult = checkRateLimit(`journal-summary-${clientId}`, 10, 60000);
        if (!rateLimitResult.allowed) {
            return NextResponse.json(
                { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
                {
                    status: 429,
                    headers: { 'Retry-After': rateLimitResult.retryAfter.toString() },
                }
            );
        }

        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const openai = getOpenAIClient();

        if (!openai) {
            return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
        }

        const body = await req.json().catch(() => ({}));
        const { type, dates } = body || {};

        const range = resolveRange(type, dates);
        if (!range) {
            return NextResponse.json({ error: 'Invalid date range' }, { status: 400 });
        }

        // The entries are read here, by user_id, rather than accepted from the
        // request body. Trusting the body meant this route had no ownership tie
        // between the caller and the content it forwarded to OpenAI: it would
        // summarise, and bill for, up to 60,000 characters of anything at all.
        // It was also the only route in the app taking row data from the client,
        // against the architecture contract in CLAUDE.md.
        const supabase = getSupabaseServiceRole();
        const { data: limitedEntries, error: entriesError } = await supabase
            .from('journal_entries')
            .select('content, cleaned_content, created_at')
            .eq('user_id', session.user.id)
            .gte('created_at', range.from)
            .lte('created_at', range.to)
            .order('created_at', { ascending: true })
            .limit(MAX_ENTRIES);

        if (entriesError) {
            console.error('Journal summary entry fetch failed:', entriesError);
            return NextResponse.json({ error: 'Failed to load journal entries' }, { status: 500 });
        }

        if (!limitedEntries || limitedEntries.length === 0) {
            return NextResponse.json({ summary: [], message: 'No journal entries found for this period.' });
        }
        let totalChars = 0;
        const compiledChunks = [];
        for (const entry of limitedEntries) {
            const entryContent = String(entry.cleaned_content || entry.content || '').trim();
            if (!entryContent) continue;
            const dateLabel = entry.created_at
                ? new Date(entry.created_at).toLocaleDateString()
                : 'Unknown date';
            const chunk = `[${dateLabel}] ${entryContent}`;
            totalChars += chunk.length;
            if (totalChars > MAX_TOTAL_CHARS) break;
            compiledChunks.push(chunk);
        }

        if (compiledChunks.length === 0) {
            return NextResponse.json({ summary: [], message: 'No journal entries found for this period.' });
        }

        const compiledText = compiledChunks.join('\n\n');

        const timeRangeLabel = (() => {
            switch (type) {
                case 'weekly':
                    return 'the past week';
                case 'monthly':
                    return 'the past month';
                case 'annual':
                    return 'the past year';
                case 'custom':
                    return 'the selected date range';
                default:
                    return 'the recent period';
            }
        })();

        const prompt = `You are an experienced, licensed therapist.
Using the journal entries from ${timeRangeLabel}, write 6-10 bullet points that the client should consider discussing with their therapist, Victoria, in their next session.

Guidelines:
- Output only bullet points, no greeting, sign-off, or title.
- Use "-" to start each bullet.
- Each bullet should be concise (1-2 sentences), supportive, and non-judgmental.
- Focus on emotions, themes, patterns, and specific situations that stand out.
- Avoid diagnosis or medical advice.
- Do not format as an email or write as Victoria speaking to the client.

Journal Entries:
${compiledText}`;

        const completion = await openai.chat.completions.create({
            messages: [
                { role: 'system', content: 'You are an experienced, licensed therapist who writes clear, supportive discussion prompts.' },
                { role: 'user', content: prompt }
            ],
            model: 'gpt-4o', // or gpt-3.5-turbo
        });

        const content = completion.choices?.[0]?.message?.content ?? '';
        const points = extractBulletPoints(content);
        return NextResponse.json({ summary: points });
    } catch (error) {
        console.error('AI Summary Error:', error);
        return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
    }
}
