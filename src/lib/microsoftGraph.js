const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

let cachedToken = null;
let cachedTokenExpiresAtMs = 0;

function requireEnv(name) {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing ${name} environment variable`);
  }
  return value;
}

export async function getMicrosoftGraphAccessToken() {
  if (cachedToken && Date.now() < cachedTokenExpiresAtMs - 60_000) {
    return cachedToken;
  }

  const tenantId = requireEnv('MICROSOFT_TENANT_ID');
  const clientId = requireEnv('MICROSOFT_CLIENT_ID');
  const clientSecret = requireEnv('MICROSOFT_CLIENT_SECRET');

  const tokenUrl = `https://login.microsoftonline.com/${encodeURIComponent(tenantId)}/oauth2/v2.0/token`;
  const body = new URLSearchParams();
  body.set('client_id', clientId);
  body.set('client_secret', clientSecret);
  body.set('grant_type', 'client_credentials');
  body.set('scope', 'https://graph.microsoft.com/.default');

  const response = await fetch(tokenUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Microsoft token request failed (${response.status}): ${errorBody || response.statusText}`);
  }

  const json = await response.json();
  if (!json?.access_token) {
    throw new Error('Microsoft token response missing access_token');
  }

  const expiresInSeconds = Number(json.expires_in || 3600);
  cachedToken = json.access_token;
  cachedTokenExpiresAtMs = Date.now() + expiresInSeconds * 1000;

  return cachedToken;
}

export async function sendMicrosoftEmail({ fromUser, to, subject, html, text }) {
  if (!fromUser) throw new Error('sendMicrosoftEmail: fromUser is required');
  if (!to) throw new Error('sendMicrosoftEmail: to is required');
  if (!subject) throw new Error('sendMicrosoftEmail: subject is required');
  if (!html && !text) throw new Error('sendMicrosoftEmail: html or text is required');

  const token = await getMicrosoftGraphAccessToken();
  const endpoint = `${GRAPH_BASE_URL}/users/${encodeURIComponent(fromUser)}/sendMail`;

  const message = {
    subject,
    body: {
      contentType: html ? 'HTML' : 'Text',
      content: html || text,
    },
    toRecipients: [{ emailAddress: { address: to } }],
  };

  const response = await fetch(endpoint, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      saveToSentItems: true,
    }),
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    throw new Error(`Microsoft sendMail failed (${response.status}): ${errorBody || response.statusText}`);
  }
}
