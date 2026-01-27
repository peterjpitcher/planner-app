const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

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

  const response = await fetch(targetUrl, {
    method: method || 'GET',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
    cache: 'no-store',
  });

  if (!response.ok) {
    const errorBody = await response.text().catch(() => '');
    const label = hasUrl ? url : path;
    throw new Error(`Office365 Graph ${method || 'GET'} ${label} failed (${response.status}): ${errorBody || response.statusText}`);
  }

  if (response.status === 204) {
    return null;
  }

  const json = await response.json().catch(() => null);
  return json;
}
