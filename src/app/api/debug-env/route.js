import { NextResponse } from 'next/server';
import { getAuthContext, isAdminSession, isDevelopment } from '@/lib/authServer';

export async function GET(request) {
  const { session } = await getAuthContext(request, { requireAccessToken: false });
  
  // Only show in development or for admin users
  if (!isDevelopment() && !isAdminSession(session)) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }
  
  return NextResponse.json({
    environment: {
      NODE_ENV: process.env.NODE_ENV,
      NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'NOT SET',
      VERCEL_URL: process.env.VERCEL_URL || 'NOT SET',
      computedAuthUrl: process.env.NEXTAUTH_URL || 'NOT SET',
    },
    session: session ? {
      user: session.user?.email,
      expires: session.expires,
    } : null,
    headers: {
      host: request.headers.get('host'),
      origin: request.headers.get('origin'),
      referer: request.headers.get('referer'),
    },
  });
}
