import { NextResponse } from 'next/server';
import { getSupabaseServer } from '@/lib/supabaseServer';

// GET /api/health/supabase - Supabase database health check
export async function GET() {
  const startTime = Date.now();
  
  try {
    // Create Supabase client (will use service key if available)
    const supabase = getSupabaseServer();
    
    // Perform a simple query to check database connectivity
    // Using raw SQL for minimal overhead
    const { data, error } = await supabase
      .rpc('ping', {})
      .maybeSingle();
    
    // If the ping function doesn't exist, try a simple select
    let dbStatus = 'ok';
    let dbLatency = 0;
    
    if (error && error.code === 'PGRST202') {
      // Function doesn't exist, try a simple query
      const testQuery = await supabase
        .from('projects')
        .select('id')
        .limit(1);
      
      if (testQuery.error) {
        // Try without table access (just connection test)
        const { data: nowData, error: nowError } = await supabase
          .rpc('now')
          .maybeSingle()
          .catch(() => ({ data: null, error: { message: 'Database unreachable' } }));
        
        if (nowError) {
          throw new Error(`Database connection failed: ${nowError.message}`);
        }
      }
    } else if (error) {
      throw new Error(`Database check failed: ${error.message}`);
    }
    
    dbLatency = Date.now() - startTime;
    
    const health = {
      status: 'ok',
      timestamp: new Date().toISOString(),
      database: {
        status: dbStatus,
        latencyMs: dbLatency,
        url: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'configured' : 'not configured',
        serviceKey: process.env.SUPABASE_SERVICE_KEY ? 'configured' : 'using anon key',
        connection: 'established'
      },
      checks: {
        environment: {
          NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
          NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
          SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY
        }
      }
    };
    
    // Add warning if latency is high
    if (dbLatency > 1000) {
      health.warnings = [`High database latency: ${dbLatency}ms`];
    }
    
    return NextResponse.json(health, {
      status: 200,
      headers: {
        'Cache-Control': 'no-store, max-age=0'
      }
    });
  } catch (error) {
    const errorLatency = Date.now() - startTime;
    console.error('Supabase health check failed:', error);
    
    return NextResponse.json(
      {
        status: 'error',
        timestamp: new Date().toISOString(),
        database: {
          status: 'unreachable',
          latencyMs: errorLatency,
          error: error.message || 'Unknown error',
          connection: 'failed'
        },
        checks: {
          environment: {
            NEXT_PUBLIC_SUPABASE_URL: !!process.env.NEXT_PUBLIC_SUPABASE_URL,
            NEXT_PUBLIC_SUPABASE_ANON_KEY: !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
            SUPABASE_SERVICE_KEY: !!process.env.SUPABASE_SERVICE_KEY
          }
        }
      },
      { status: 503 }
    );
  }
}

// Add a simple ping RPC function creation script for reference
export const CREATE_PING_FUNCTION = `
-- Run this in Supabase SQL editor to create a simple ping function
CREATE OR REPLACE FUNCTION ping()
RETURNS text
LANGUAGE sql
AS $$
  SELECT 'pong'::text;
$$;

-- Grant execute permission to authenticated and anon users
GRANT EXECUTE ON FUNCTION ping() TO authenticated, anon;
`;