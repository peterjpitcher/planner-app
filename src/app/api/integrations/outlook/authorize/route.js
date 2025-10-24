import { randomUUID } from 'crypto';
import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';

import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import { buildAuthorizeUrl } from '@/lib/microsoftGraphClient';

const STATE_COOKIE_NAME = 'planner_outlook_oauth_state';

export async function GET(request) {
  const session = await getServerSession(authOptions);

  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const redirectUri = `${url.origin}/api/integrations/outlook/callback`;
  const state = randomUUID();
  const scopes = [
    'offline_access',
    'Tasks.ReadWrite',
    'User.Read',
    'openid',
    'profile',
    'email'
  ];

  try {
    const authorizeUrl = buildAuthorizeUrl({ state, redirectUri, scopes });

    const response = NextResponse.redirect(authorizeUrl);
    response.cookies.set(STATE_COOKIE_NAME, state, {
      httpOnly: true,
      secure: process.env.NODE_ENV === 'production',
      path: '/api/integrations/outlook',
      sameSite: 'lax',
      maxAge: 600
    });

    return response;
  } catch (error) {
    return NextResponse.json({ error: error.message || 'Failed to initiate Microsoft authorization' }, { status: 500 });
  }
}
