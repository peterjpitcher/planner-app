import { NextResponse } from 'next/server';
import { getAuthContext, isAdminSession, isDevelopment } from '@/lib/authServer';

export async function GET(request) {
  try {
    const { session } = await getAuthContext(request, { requireAccessToken: false });
    if (!isDevelopment() && !isAdminSession(session)) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    
    // Create a safe config object that masks sensitive values
    const config = {
      environment: process.env.NODE_ENV || 'not set',
      auth: {
        NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'NOT SET',
        NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? 'SET (hidden)' : 'NOT SET',
        COMPUTED_URL: process.env.NODE_ENV === 'production' 
          ? 'https://planner.orangejelly.co.uk' 
          : (process.env.NEXTAUTH_URL || 'http://localhost:3000'),
      },
      supabase: {
        NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET (hidden)' : 'NOT SET',
        NEXT_PUBLIC_SUPABASE_ANON_KEY: process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY ? 'SET (hidden)' : 'NOT SET',
      },
      vercel: {
        VERCEL: process.env.VERCEL || 'not set',
        VERCEL_ENV: process.env.VERCEL_ENV || 'not set',
        VERCEL_URL: process.env.VERCEL_URL || 'not set',
      },
      session: {
        exists: !!session,
        user: session?.user ? {
          id: session.user.id || 'not set',
          email: session.user.email || 'not set',
        } : null,
      },
      cookies: {
        // Check for NextAuth cookies
        sessionToken: request.cookies.has('next-auth.session-token') || 
                      request.cookies.has('__Secure-next-auth.session-token'),
        csrfToken: request.cookies.has('next-auth.csrf-token') ||
                   request.cookies.has('__Host-next-auth.csrf-token'),
      },
      timestamp: new Date().toISOString(),
    };

    // Add warnings for common issues
    const warnings = [];
    
    if (!process.env.NEXTAUTH_URL && process.env.NODE_ENV === 'production') {
      warnings.push('NEXTAUTH_URL is not set - this may cause redirect issues');
    }
    
    if (!process.env.NEXTAUTH_SECRET) {
      warnings.push('NEXTAUTH_SECRET is not set - authentication will fail');
    }
    
    if (process.env.NEXTAUTH_URL && process.env.NEXTAUTH_URL.includes('localhost') && process.env.NODE_ENV === 'production') {
      warnings.push('NEXTAUTH_URL contains localhost in production - this will cause redirect loops');
    }
    
    if (!process.env.NEXT_PUBLIC_SUPABASE_URL || !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
      warnings.push('Supabase environment variables are missing');
    }

    return NextResponse.json({
      status: 'ok',
      config,
      warnings,
      recommendations: [
        'Ensure NEXTAUTH_URL is set to your production domain (https://planner.orangejelly.co.uk)',
        'Ensure NEXTAUTH_SECRET is set (generate with: openssl rand -base64 32)',
        'Clear browser cookies and try logging in again',
        'Check Vercel environment variables dashboard',
      ],
    }, { 
      status: 200,
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    console.error('Config verification error:', error);
    return NextResponse.json({
      status: 'error',
      error: error.message,
    }, { status: 500 });
  }
}
