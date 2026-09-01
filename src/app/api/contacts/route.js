import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { createContact, listContacts } from '@/services/contactService';

export async function GET(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const { searchParams } = new URL(request.url);

    const { data, error } = await listContacts({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      customerId: searchParams.get('customerId'),
      includeArchived: searchParams.get('includeArchived') === 'true',
    });

    if (error) return NextResponse.json({ error: error.message }, { status: error.status });
    return NextResponse.json({ data });
  } catch (error) {
    console.error('GET /api/contacts error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

export async function POST(request) {
  try {
    const { session } = await getAuthContext(request);
    if (!session?.user?.id) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await request.json();

    const { data, error } = await createContact({
      supabase: getSupabaseServiceRole(),
      userId: session.user.id,
      payload: body,
    });

    if (error) {
      return NextResponse.json(
        { error: error.message, ...(error.details ? { details: error.details } : {}) },
        { status: error.status }
      );
    }
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    console.error('POST /api/contacts error:', error);
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}
