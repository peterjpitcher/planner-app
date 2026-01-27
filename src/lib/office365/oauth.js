import crypto from 'crypto';

const MS_LOGIN_BASE_URL = 'https://login.microsoftonline.com';

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

function base64Url(input) {
  const buffer = Buffer.isBuffer(input) ? input : Buffer.from(String(input));
  return buffer
    .toString('base64')
    .replaceAll('+', '-')
    .replaceAll('/', '_')
    .replaceAll('=', '');
}

export function getOffice365TenantId() {
  return (process.env.MICROSOFT_TENANT_ID || 'organizations').trim();
}

export function getOffice365ClientId() {
  return requireEnv('MICROSOFT_CLIENT_ID');
}

export function getOffice365ClientSecret() {
  return requireEnv('MICROSOFT_CLIENT_SECRET');
}

export function getOffice365Scopes() {
  return [
    'offline_access',
    'openid',
    'profile',
    'email',
    'https://graph.microsoft.com/Tasks.ReadWrite',
  ];
}

export function createPkcePair() {
  const verifier = base64Url(crypto.randomBytes(32));
  const challenge = base64Url(crypto.createHash('sha256').update(verifier).digest());
  return { verifier, challenge, method: 'S256' };
}

export function createOAuthState() {
  return base64Url(crypto.randomBytes(16));
}

export function buildOffice365AuthorizeUrl({
  tenantId,
  clientId,
  redirectUri,
  state,
  codeChallenge,
  scopes,
  loginHint,
}) {
  const url = new URL(`${MS_LOGIN_BASE_URL}/${encodeURIComponent(tenantId)}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', clientId);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', scopes.join(' '));
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  url.searchParams.set('prompt', 'consent');
  if (loginHint) {
    url.searchParams.set('login_hint', loginHint);
  }
  return url.toString();
}

export async function exchangeOffice365AuthorizationCode({
  tenantId,
  clientId,
  clientSecret,
  redirectUri,
  code,
  codeVerifier,
  scopes,
}) {
  const tokenUrl = `${MS_LOGIN_BASE_URL}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;

  const body = new URLSearchParams();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('grant_type', 'authorization_code');
  body.set('code', code);
  body.set('redirect_uri', redirectUri);
  body.set('code_verifier', codeVerifier);
  body.set('scope', scopes.join(' '));

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Office365 token exchange failed (${response.status}): ${errorBody || response.statusText}`);
  }

  return response.json();
}

export async function refreshOffice365AccessToken({
  tenantId,
  clientId,
  clientSecret,
  refreshToken,
  scopes,
}) {
  const tokenUrl = `${MS_LOGIN_BASE_URL}/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;

  const body = new URLSearchParams();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('grant_type', 'refresh_token');
  body.set('refresh_token', refreshToken);
  body.set('scope', scopes.join(' '));

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Office365 token refresh failed (${response.status}): ${errorBody || response.statusText}`);
  }

  return response.json();
}
