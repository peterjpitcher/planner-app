const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';

export async function office365GraphRequest({ accessToken, method, path, body }) {
  if (!accessToken) {
    throw new Error('office365GraphRequest: accessToken is required');
  }
  if (!path?.startsWith('/')) {
    throw new Error('office365GraphRequest: path must start with "/"');
  }

  const response = await fetch(`${GRAPH_BASE_URL}${path}`, {
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
    throw new Error(`Office365 Graph ${method || 'GET'} ${path} failed (${response.status}): ${errorBody || response.statusText}`);
  }

  if (response.status === 204) {
    return null;
  }

  const json = await response.json().catch(() => null);
  return json;
}

