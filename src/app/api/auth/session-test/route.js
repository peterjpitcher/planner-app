import { NextResponse } from 'next/server';
import { getAuthContext, isAdminSession, isDevelopment } from '@/lib/authServer';

export async function GET(request) {
  try {
    const { session } = await getAuthContext(request, { requireAccessToken: false });
    if (!isDevelopment() && !isAdminSession(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Get cookies from request
    const cookies = request.headers.get('cookie') || 'none';
    const sessionToken = request.cookies.get('next-auth.session-token');
    const csrfToken = request.cookies.get('next-auth.csrf-token');
    
    return NextResponse.json({
      status: 'ok',
      serverSession: session || null,
      cookies: {
        raw: cookies.substring(0, 200) + '...', // Truncate for security
        hasSessionToken: !!sessionToken,
        hasCsrfToken: !!csrfToken,
        sessionTokenName: sessionToken?.name,
      },
      timestamp: new Date().toISOString(),
    }, { 
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Session test error:', error);
    return NextResponse.json({
      status: 'error',
      error: error.message,
    }, { status: 500 });
  }
}
