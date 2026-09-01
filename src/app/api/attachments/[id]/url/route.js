import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { createDownloadUrl } from '@/services/attachmentService';

// GET /api/attachments/[id]/url
//
// A sixty second signed URL, generated per click and never stored. The bucket
// is private with no policies, so this route's session and ownership checks are
// the only thing standing between a caller and the file.
export async function GET(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const { data, error } = await createDownloadUrl({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      attachmentId: id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/attachments/[id]/url error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
