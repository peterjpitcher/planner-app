import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { finaliseUpload } from '@/services/attachmentService';

// POST /api/attachments/[id]/finalise
//
// Step three. Reads the object's ACTUAL size and content type and checks them
// against the limits, rather than trusting what the client declared in step
// one. A signed upload authorises a transfer; it does not promise the finished
// object matches the request. Without this the 25 MB cap and the MIME allowlist
// would be decorative.
export async function POST(request, { params }) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }

    const { id } = await params;

    const { data, error } = await finaliseUpload({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      attachmentId: id,
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('POST /api/attachments/[id]/finalise error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
