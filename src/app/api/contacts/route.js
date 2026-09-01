import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { NextResponse } from 'next/server';
import { createContact, getContactLinks, listContacts } from '@/services/contactService';

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

    // What each person is actually on. Asked for explicitly, because a contact
    // with no visible link to any work is just a name in a list.
    if (searchParams.get('withLinks') === 'true' && data.length > 0) {
      const { data: links } = await getContactLinks({
        supabase: getSupabaseServiceRole(),
        userId: session.user.id,
        contactIds: data.map((c) => c.id),
      });

      return NextResponse.json({
        data: data.map((contact) => ({
          ...contact,
          projects: links?.get(contact.id)?.projects || [],
          open_task_count: links?.get(contact.id)?.openTaskCount || 0,
        })),
      });
    }

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
