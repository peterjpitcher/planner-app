import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { createClient } from '@supabase/supabase-js';
import { NextResponse } from 'next/server';

export async function GET(request) {
  try {
    const session = await getServerSession(authOptions);
    
    if (!session?.user?.id) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
    const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
    
    // Test with anon key
    const anonClient = createClient(supabaseUrl, supabaseAnonKey);
    const { data: anonData, error: anonError } = await anonClient
      .from('projects')
      .select('id, name, user_id')
      .eq('user_id', session.user.id)
      .limit(5);
    
    // Test with service key if available
    let serviceData = null;
    let serviceError = null;
    if (supabaseServiceKey) {
      const serviceClient = createClient(supabaseUrl, supabaseServiceKey);
      const result = await serviceClient
        .from('projects')
        .select('id, name, user_id')
        .eq('user_id', session.user.id)
        .limit(5);
      serviceData = result.data;
      serviceError = result.error;
    }
    
    // Test without user_id filter
    const { data: allData, error: allError } = await anonClient
      .from('projects')
      .select('id, name, user_id')
      .limit(5);
    
    return NextResponse.json({
      session: {
        userId: session.user.id,
        email: session.user.email
      },
      tests: {
        anonKey: {
          hasKey: !!supabaseAnonKey,
          data: anonData,
          error: anonError,
          count: anonData?.length || 0
        },
        serviceKey: {
          hasKey: !!supabaseServiceKey,
          data: serviceData,
          error: serviceError,
          count: serviceData?.length || 0
        },
        allProjects: {
          data: allData?.map(p => ({ ...p, user_id: p.user_id === session.user.id ? 'MATCHES' : 'DIFFERENT' })),
          error: allError,
          count: allData?.length || 0
        }
      }
    });
  } catch (error) {
    console.error('Test DB error:', error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}