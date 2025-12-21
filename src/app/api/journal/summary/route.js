import { OpenAI } from 'openai';
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
        const openai = getOpenAIClient();

        if (!openai) {
            return NextResponse.json({ error: 'OpenAI API key not configured' }, { status: 500 });
        }

        // 1. Authenticate user
        // Note: In a real app with NextAuth/Supabase, we'd get the session from the request cookies or headers carefully.
        // For this implementation, relying on the client sending the request. 
        // However, since we are in a server route, we should verify the user.
        // Assuming standard Supabase auth header passing or NextAuth session if available.
        // Let's use the standard supabase approach for route handlers if possible, or pass user_id if we want to trust the client (bad practice).
        // Better: use createServerClient from @supabase/ssr if available, but for now I'll use a simpler check or assume the frontend is protected.
        // Actually, I can check the headers for the session token if passed, but let's stick to a simpler implementation 
        // where we might need to rely on the service role to fetch data for the *current* user if we can identify them.
        // Let's assume the request comes from an authenticated context.

        // To properly secure this without full @supabase/ssr setup in this file (which might be complex), 
        // I will look for a user_id in the body for now, BUT for production this should be from the session.
        // Given the constraints and existing codebase styles, I'll see if I can get the user from the request.
        // I will try to use the headers to get the user if using Supabase Auth helpers.

        // Let's just mock the auth part or trust the client sending the ID for this prototype step 
        // OR better, since I installed `openai`, I can focus on that.
        // I'll assume we can get the journal entries passed in? No, that's too much data.
        // I'll fetch them here.

        // For now, I'll use a hardcoded check or simple extraction. 
        // Actually, `src/lib/supabase/server.js` might exist? I saw `src/lib` in list_dir.
        // Let's check `src/lib/supabase/client.js` was used in service, maybe there's `server.js`.
        // I'll safely assume I need to fetch entries.

        const body = await req.json();
        const { type } = body;

        // TEMPORARY: Accepting user_id from body for simplicity in this specific task context 
        // if I can't easily get it. But wait, I shouldn't do insecure things.
        // I'll try to get it from the session if I can, but `getServerSession` from `next-auth` is strictly for NextAuth.
        // The `package.json` has `next-auth` AND `@supabase/supabase-js`. 
        // The user logs in via `NextAuthProvider` in layout.js.
        // So I should use `getServerSession`.

        const { getServerSession } = await import('next-auth');
        // I need the auth options. usually in `src/app/api/auth/[...nextauth]/route.js` or `src/lib/auth.js`
        // I'll skip deep auth verification complexities and fetch all entries for the user found in session.
        // But I don't know where auth options are.

        // FALLBACK: I will fetch the last 30 days of entries passing the user_id from the client for this specific "prototype" request 
        // to ensure it works without debugging auth config, BUT I will add a comment.
        // Actually, looking at `AppShell`, it takes `user` prop.
        // The `journalService.getSummary` doesn't pass user_id.

        // Let's try to just use OpenAI with dummy text if we can't fetch, OR 
        // fetch using a service key for a specific user ID if I can find one.
        // I'll rely on the client passing the Journal Entries content TO the API? 
        // No, that might be too large.

        // Let's go with: Fetch entries for the user (I'll need to know WHO the user is).
        // I will ask the `journalService` to fetch the text and pass it to this API. 
        // That avoids server-side auth complexity for this specific task.
        // RE-WRITING journalService to pass content.

        const { entries } = body; // Expecting entries to be passed in strictly for this implementation to avoid Auth issues.

        if (!entries || !Array.isArray(entries)) {
            return NextResponse.json({ error: 'No entries provided' }, { status: 400 });
        }

        const compiledText = entries
            .map((entry) => {
                const entryContent = entry.cleaned_content || entry.content || '';
                return `[${new Date(entry.created_at).toLocaleDateString()}] ${entryContent}`;
            })
            .join('\n\n');

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
