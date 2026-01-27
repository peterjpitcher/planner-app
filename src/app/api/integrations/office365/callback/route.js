import { NextResponse } from 'next/server';
import { getServerSession } from 'next-auth/next';
import { authOptions } from '@/app/api/auth/[...nextauth]/route';
import {
  exchangeOffice365AuthorizationCode,
  getOffice365ClientId,
  getOffice365ClientSecret,
  getOffice365Scopes,
  getOffice365TenantId,
} from '@/lib/office365/oauth';
import { upsertOffice365ConnectionFromTokenResponse } from '@/services/office365ConnectionService';

const COOKIE_STATE = 'o365_oauth_state';
const COOKIE_VERIFIER = 'o365_oauth_verifier';
const COOKIE_RETURN_TO = 'o365_oauth_return_to';

function safeRedirectTarget(value) {
  if (typeof value !== 'string') return '/settings/integrations';
  if (!value.startsWith('/')) return '/settings/integrations';
  if (value.startsWith('//')) return '/settings/integrations';
  return value;
}

export async function GET(request) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.id) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  const expectedState = request.cookies.get(COOKIE_STATE)?.value || null;
  const codeVerifier = request.cookies.get(COOKIE_VERIFIER)?.value || null;
  const returnToCookie = request.cookies.get(COOKIE_RETURN_TO)?.value || null;

  const clearCookies = (response) => {
    response.cookies.set(COOKIE_STATE, '', { maxAge: 0, path: '/api/integrations/office365/callback' });
    response.cookies.set(COOKIE_VERIFIER, '', { maxAge: 0, path: '/api/integrations/office365/callback' });
    response.cookies.set(COOKIE_RETURN_TO, '', { maxAge: 0, path: '/api/integrations/office365' });
  };

  if (error) {
    const response = NextResponse.redirect(`${safeRedirectTarget(returnToCookie)}?office365=error`);
    clearCookies(response);
    return response;
  }

  if (!code || !state) {
    const response = NextResponse.redirect(`${safeRedirectTarget(returnToCookie)}?office365=missing_params`);
    clearCookies(response);
    return response;
  }

  if (!expectedState || state !== expectedState) {
    const response = NextResponse.redirect(`${safeRedirectTarget(returnToCookie)}?office365=state_mismatch`);
    clearCookies(response);
    return response;
  }

  if (!codeVerifier) {
    const response = NextResponse.redirect(`${safeRedirectTarget(returnToCookie)}?office365=missing_verifier`);
    clearCookies(response);
    return response;
  }

  const origin = url.origin;
  const redirectUri = `${origin}/api/integrations/office365/callback`;

  try {
    const tokenResponse = await exchangeOffice365AuthorizationCode({
      tenantId: getOffice365TenantId(),
      clientId: getOffice365ClientId(),
      clientSecret: getOffice365ClientSecret(),
      redirectUri,
      code,
      codeVerifier,
      scopes: getOffice365Scopes(),
    });

    await upsertOffice365ConnectionFromTokenResponse({
      userId: session.user.id,
      tokenResponse,
      tenantIdOverride: getOffice365TenantId(),
      userEmail: session.user.email || null,
    });

    const response = NextResponse.redirect(`${safeRedirectTarget(returnToCookie)}?office365=connected`);
    clearCookies(response);
    return response;
  } catch (err) {
    console.error('Office365 OAuth callback error:', err, errorDescription);
    const response = NextResponse.redirect(`${safeRedirectTarget(returnToCookie)}?office365=failed`);
    clearCookies(response);
    return response;
  }
}

