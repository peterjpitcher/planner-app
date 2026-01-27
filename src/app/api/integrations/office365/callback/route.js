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
const COOKIE_USER_ID = 'o365_oauth_user_id';

function safeRedirectTarget(value) {
  if (typeof value !== 'string') return '/settings/integrations';
  if (!value.startsWith('/')) return '/settings/integrations';
  if (value.startsWith('//')) return '/settings/integrations';
  return value;
}

function buildReturnUrl({ origin, returnTo, status }) {
  const safeReturnTo = safeRedirectTarget(returnTo);
  const target = new URL(safeReturnTo, origin);
  target.searchParams.set('office365', status);
  return target;
}

export async function GET(request) {
  const session = await getServerSession(authOptions);

  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const error = url.searchParams.get('error');
  const errorDescription = url.searchParams.get('error_description');

  const expectedState = request.cookies.get(COOKIE_STATE)?.value || null;
  const codeVerifier = request.cookies.get(COOKIE_VERIFIER)?.value || null;
  const returnToCookie = request.cookies.get(COOKIE_RETURN_TO)?.value || null;
  const userIdCookie = request.cookies.get(COOKIE_USER_ID)?.value || null;

  const userId = session?.user?.id || userIdCookie;

  const clearCookies = (response) => {
    response.cookies.set(COOKIE_STATE, '', { maxAge: 0, path: '/api/integrations/office365/callback' });
    response.cookies.set(COOKIE_VERIFIER, '', { maxAge: 0, path: '/api/integrations/office365/callback' });
    response.cookies.set(COOKIE_USER_ID, '', { maxAge: 0, path: '/api/integrations/office365/callback' });
    response.cookies.set(COOKIE_RETURN_TO, '', { maxAge: 0, path: '/api/integrations/office365' });
  };

  if (!userId) {
    const response = NextResponse.redirect(buildReturnUrl({ origin: url.origin, returnTo: returnToCookie, status: 'unauthorized' }));
    clearCookies(response);
    return response;
  }

  if (error) {
    const response = NextResponse.redirect(buildReturnUrl({ origin: url.origin, returnTo: returnToCookie, status: 'error' }));
    clearCookies(response);
    return response;
  }

  if (!code || !state) {
    const response = NextResponse.redirect(buildReturnUrl({ origin: url.origin, returnTo: returnToCookie, status: 'missing_params' }));
    clearCookies(response);
    return response;
  }

  if (!expectedState || state !== expectedState) {
    const response = NextResponse.redirect(buildReturnUrl({ origin: url.origin, returnTo: returnToCookie, status: 'state_mismatch' }));
    clearCookies(response);
    return response;
  }

  if (!codeVerifier) {
    const response = NextResponse.redirect(buildReturnUrl({ origin: url.origin, returnTo: returnToCookie, status: 'missing_verifier' }));
    clearCookies(response);
    return response;
  }

  const redirectUri = `${url.origin}/api/integrations/office365/callback`;

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
      userId,
      tokenResponse,
      tenantIdOverride: getOffice365TenantId(),
      userEmail: session?.user?.email || (process.env.MICROSOFT_USER_EMAIL || '').trim() || null,
    });

    const response = NextResponse.redirect(buildReturnUrl({ origin: url.origin, returnTo: returnToCookie, status: 'connected' }));
    clearCookies(response);
    return response;
  } catch (err) {
    console.error('Office365 OAuth callback error:', err, errorDescription);
    const response = NextResponse.redirect(buildReturnUrl({ origin: url.origin, returnTo: returnToCookie, status: 'failed' }));
    clearCookies(response);
    return response;
  }
}
