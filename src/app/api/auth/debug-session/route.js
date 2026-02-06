import { NextResponse } from 'next/server';
import { getAuthContext, isAdminSession, isDevelopment } from '@/lib/authServer';

export async function GET(request) {
  try {
    const { session } = await getAuthContext(request, { requireAccessToken: false });
    if (!isDevelopment() && !isAdminSession(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Log server-side for debugging
    console.log('Debug endpoint - session:', session);
    console.log('Debug endpoint - session.user:', session?.user);
    
    return NextResponse.json({
      status: 'ok',
      sessionExists: !!session,
      sessionData: session || null,
      user: session?.user || null,
      timestamp: new Date().toISOString(),
    }, { 
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Debug session error:', error);
    return NextResponse.json({
      status: 'error',
      error: error.message,
    }, { status: 500 });
  }
}
