import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import {
  buildOffice365AuthorizeUrl,
  createOAuthState,
  createPkcePair,
  getOffice365ClientId,
  getOffice365Scopes,
  getOffice365TenantId,
} from '@/lib/office365/oauth';

const COOKIE_STATE = 'o365_oauth_state';
const COOKIE_VERIFIER = 'o365_oauth_verifier';
const COOKIE_RETURN_TO = 'o365_oauth_return_to';
const COOKIE_USER_ID = 'o365_oauth_user_id';
const COOKIE_MAX_AGE_SECONDS = 10 * 60;

function isProduction() {
  return process.env.NODE_ENV === 'production';
}

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const requestUrl = new URL(request.url);
  const returnTo = requestUrl.searchParams.get('returnTo') || '/settings/integrations';
  const origin = requestUrl.origin;
  const redirectUri = `${origin}/api/integrations/office365/callback`;

  const state = createOAuthState();
  const { verifier, challenge } = createPkcePair();

  const authorizeUrl = buildOffice365AuthorizeUrl({
    tenantId: getOffice365TenantId(),
    clientId: getOffice365ClientId(),
    redirectUri,
    state,
    codeChallenge: challenge,
    scopes: getOffice365Scopes(),
    loginHint: (process.env.MICROSOFT_USER_EMAIL || session.user.email || '').trim() || undefined,
  });

  const response = NextResponse.redirect(authorizeUrl);

  const cookieBase = {
    httpOnly: true,
    secure: isProduction(),
    sameSite: 'lax',
    maxAge: COOKIE_MAX_AGE_SECONDS,
    path: '/api/integrations/office365/callback',
  };

  response.cookies.set(COOKIE_STATE, state, cookieBase);
  response.cookies.set(COOKIE_VERIFIER, verifier, cookieBase);
  response.cookies.set(COOKIE_USER_ID, session.user.id, cookieBase);
  response.cookies.set(COOKIE_RETURN_TO, returnTo, { ...cookieBase, httpOnly: true, path: '/api/integrations/office365' });

  return response;
}
