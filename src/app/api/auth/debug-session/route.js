import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '../[...nextauth]/route';

export async function GET(request) {
  try {
    // Get the session using the same authOptions
    const session = await getServerSession(authOptions);
    
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