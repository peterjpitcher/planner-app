import { OpenAI } from 'openai';
import { NextResponse } from 'next/server';
import { getAuthContext } from '@/lib/authServer';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';

let openaiClient;
const MAX_ENTRIES = 120;
const MAX_TOTAL_CHARS = 60000;

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
        const clientId = getClientIdentifier(req);
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

        const { session } = await getAuthContext(req, { requireAccessToken: false });
        if (!session?.user?.id) {
            return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
        }

        const openai = getOpenAIClient();

        if (!openai) {
            return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
        }

        const body = await req.json();
        const { type } = body;

        const { entries } = body; // Expecting entries to be passed in strictly for this implementation to avoid Auth issues.

        if (!entries || !Array.isArray(entries)) {
            return NextResponse.json({ error: 'No entries provided' }, { status: 400 });
        }

        const limitedEntries = entries.slice(0, MAX_ENTRIES);
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
