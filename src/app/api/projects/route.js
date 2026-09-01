import { getAuthContext } from '@/lib/authServer';
import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { handleSupabaseError } from '@/lib/errorHandler';
import { validateProject } from '@/lib/validators';
import { NextResponse } from 'next/server';
import { checkRateLimit, getClientIdentifier } from '@/lib/rateLimiter';
import { syncOffice365Project } from '@/services/office365SyncService';

const PROJECT_UPDATE_FIELDS = [
  'name',
  'description',
  'status',
  'due_date',
  'area',
  'customer_id',
];

function pickProjectUpdates(payload) {
  const updates = {};
  PROJECT_UPDATE_FIELDS.forEach((field) => {
    if (Object.prototype.hasOwnProperty.call(payload, field)) {
      updates[field] = payload[field];
    }
  });
  return updates;
}

function stripUndefined(payload) {
  return Object.fromEntries(
    Object.entries(payload).filter(([, value]) => value !== undefined)
  );
}

// GET /api/projects - Fetch user's projects
export async function GET(request) {
  try {
    // Rate limiting
    // Auth first, so the limit is keyed on the user id rather than a
    // client-supplied IP header (see rateLimiter.js).
    const { session } = await getAuthContext(request);
    const clientId = getClientIdentifier(request, session?.user?.id);
    const rateLimitResult = checkRateLimit(`projects-get-${clientId}`, 120, 60000); // 120 requests per minute (2/sec)
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { 
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() }
        }
      );
    }

    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const supabase = getSupabaseServiceRole();
    const { searchParams } = new URL(request.url);
    const includeCompleted = searchParams.get('includeCompleted') === 'true';
    const parsedLimit = parseInt(searchParams.get('limit') || '50', 10);
    const limit = Number.isFinite(parsedLimit) ? Math.min(Math.max(parsedLimit, 1), 200) : 50;
    const parsedOffset = parseInt(searchParams.get('offset') || '0', 10);
    const offset = Number.isFinite(parsedOffset) ? Math.max(parsedOffset, 0) : 0;
    
    let query = supabase
      .from('projects')
      .select('*', { count: 'exact' })
      .eq('user_id', session.user.id)
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);
    
    if (!includeCompleted) {
      query = query.not('status', 'in', '("Completed","Cancelled")');
    }
    
    const { data, error, count } = await query;
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'fetch');
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }
    
    // Customer names are looked up separately rather than embedded.
    //
    // projects.customer_id is half of a COMPOSITE foreign key,
    // (customer_id, user_id) -> customers(id, user_id), which is what stops the
    // database linking a customer to another user's project. PostgREST cannot
    // resolve an embed hinted on customer_id alone against a composite key, so
    // `customer:customer_id(name)` fails the whole request. One extra read of a
    // handful of rows is cheaper than weakening the constraint.
    const customerIds = [...new Set((data || []).map((p) => p.customer_id).filter(Boolean))];
    let customerNames = new Map();
    if (customerIds.length > 0) {
      const { data: customers } = await supabase
        .from('customers')
        .select('id, name')
        .eq('user_id', session.user.id)
        .in('id', customerIds);
      customerNames = new Map((customers || []).map((c) => [c.id, c.name]));
    }

    return NextResponse.json({ 
      data: (data || []).map((project) => ({
        ...project,
        customer_name: project.customer_id ? customerNames.get(project.customer_id) || null : null,
      })),
      pagination: {
        total: count || 0,
        limit,
        offset,
        hasMore: (offset + limit) < (count || 0)
      }
    });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

// POST /api/projects - Create a new project
export async function POST(request) {
  try {
    // Rate limiting
    // Auth first, so the limit is keyed on the user id rather than a
    // client-supplied IP header (see rateLimiter.js).
    const { session } = await getAuthContext(request);
    const clientId = getClientIdentifier(request, session?.user?.id);
    const rateLimitResult = checkRateLimit(`projects-post-${clientId}`, 30, 60000); // 30 creates per minute
    
    if (!rateLimitResult.allowed) {
      return NextResponse.json(
        { error: 'Too many requests', retryAfter: rateLimitResult.retryAfter },
        { 
          status: 429,
          headers: { 'Retry-After': rateLimitResult.retryAfter.toString() }
        }
      );
    }

    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const body = await request.json();
    // FF-029: allowlist client-supplied columns so mass assignment cannot set
    // id, user_id, timestamps or completed_at. user_id is owned by the server.
    const projectData = {
      ...stripUndefined(pickProjectUpdates(body)),
      user_id: session.user.id
    };

    // Validate project data
    const validation = validateProject(projectData);
    if (!validation.isValid) {
      return NextResponse.json({ 
        error: 'Validation failed', 
        details: validation.errors 
      }, { status: 400 });
    }
    
    const supabase = getSupabaseServiceRole();
    const { data, error } = await supabase
      .from('projects')
      .insert(projectData)
      .select()
      .single();
    
    if (error) {
      const errorMessage = handleSupabaseError(error, 'create');
      return NextResponse.json({ error: errorMessage }, { status: 500 });
    }

    try {
      await syncOffice365Project({ userId: session.user.id, projectId: data.id });
    } catch (err) {
      console.warn('Office365 sync failed for created project:', err);
    }
    
    return NextResponse.json({ data }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: 'Internal server error' }, { status: 500 });
  }
}

/*
 * Collection-level PATCH and DELETE used to live here. They wrote directly to
 * `projects` and never called projectLifecycleService, so they skipped the task
 * cascade entirely, and would have skipped close-out capture, note movement and
 * the delete safeguards added with customers. Two URLs for one operation meant
 * the result depended on which one the caller used.
 *
 * `/api/projects/[id]` is now the only mutation path for an existing project.
 * apiClient already used it for both (updateProject, deleteProject), so nothing
 * in the app called these. See the Phase 0 note in
 * docs/superpowers/specs/2026-09-01-customers-crm-design.md section 12.
 */
