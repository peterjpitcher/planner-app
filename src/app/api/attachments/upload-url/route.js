import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { createUploadUrl } from '@/services/attachmentService';

// POST /api/attachments/upload-url
//
// Step one of three. Creates the pending row (which is the authorisation
// record) and returns a signed URL the browser uploads to directly.
//
// Direct because Vercel caps request bodies at 4.5 MB and returns 413 above it.
// The file cannot travel through this route at all.
export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);
    const clientId = getClientIdentifier(request, session?.user?.id);
    const rateLimitResult = checkRateLimit(`attachments-sign-${clientId}`, 30, 60000);

    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { status: 429, headers: { 'Retry-After': rateLimitResult.retryAfter.toString() } }
      );
    }

    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const body = await request.json();

    const { data, error } = await createUploadUrl({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      parentType: body?.parent_type,
      parentId: body?.parent_id,
      fileName: body?.file_name,
      mimeType: body?.mime_type,
      sizeBytes: body?.size_bytes,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message, ...(error.details ? { details: error.details } : {}) },
        { status: error.status }
      );
    }

    return NextResponse.json({ data });
  } catch (error) {
    console.error('POST /api/attachments/upload-url error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
