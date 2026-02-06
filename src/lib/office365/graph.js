const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);
const MAX_RETRIES = 3;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function getRetryDelayMs(response, attempt) {
  const retryAfter = response?.headers?.get('retry-after');
  const parsed = retryAfter ? Number(retryAfter) : NaN;
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed * 1000;
  }
  // Exponential backoff with jitter
  const base = 500 * Math.pow(2, attempt);
  const jitter = Math.floor(Math.random() * 200);
  return base + jitter;
}

export async function office365GraphRequest({ accessToken, method, path, url, body }) {
  if (!accessToken) {
    throw new Error('office365GraphRequest: accessToken is required');
  }

  const hasPath = typeof path === 'string' && path.length > 0;
  const hasUrl = typeof url === 'string' && url.length > 0;
  if (!hasPath && !hasUrl) {
    throw new Error('office365GraphRequest: either path or url is required');
  }
  if (hasPath && !path.startsWith('/')) {
    throw new Error('office365GraphRequest: path must start with "/"');
  }
  if (hasUrl && !url.startsWith(GRAPH_BASE_URL)) {
    throw new Error('office365GraphRequest: url must start with the Microsoft Graph base URL');
  }

  const targetUrl = hasUrl ? url : `${GRAPH_BASE_URL}${path}`;

  let lastError = null;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    const response = await fetch(targetUrl, {
      method: method || 'GET',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      cache: 'no-store',
    });

    if (response.ok) {
      if (response.status === 204) {
        return null;
      }
      const json = await response.json().catch(() => null);
      return json;
    }

    const errorBody = await response.text().catch(() => '');
    const label = hasUrl ? url : path;
    lastError = new Error(
      `Office365 Graph ${method || 'GET'} ${label} failed (${response.status}): ${errorBody || response.statusText}`
    );

    if (!RETRYABLE_STATUS.has(response.status) || attempt === MAX_RETRIES) {
      throw lastError;
    }

    const delayMs = getRetryDelayMs(response, attempt);
    await sleep(delayMs);
  }

  throw lastError || new Error('Office365 Graph request failed');
}
