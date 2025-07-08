import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { NextResponse } from 'next/server';

export async function GET(request) {
  const session = await getServerSession(authOptions);
  
  return NextResponse.json({
    session: session || null,
    timestamp: new Date().toISOString(),
    cookies: request.headers.get('cookie'),
  });
}