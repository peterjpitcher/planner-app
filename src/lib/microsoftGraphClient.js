const GRAPH_BASE_URL = 'https://graph.microsoft.com/v1.0';
const AUTH_BASE_URL = 'https://login.microsoftonline.com';

function getTenantId() {
  return process.env.MICROSOFT_TENANT_ID || 'common';
}

function getClientId() {
  const value = process.env.MICROSOFT_CLIENT_ID;
  if (!value) {
    throw new Error('Missing MICROSOFT_CLIENT_ID environment variable');
  }
  return value;
}

function getClientSecret() {
  const value = process.env.MICROSOFT_CLIENT_SECRET;
  if (!value) {
    throw new Error('Missing MICROSOFT_CLIENT_SECRET environment variable');
  }
  return value;
}

export function buildAuthorizeUrl({ state, redirectUri, scopes }) {
  const tenantId = getTenantId();
  const params = new URLSearchParams({
    client_id: getClientId(),
    response_type: 'code',
    redirect_uri: redirectUri,
    response_mode: 'query',
    scope: scopes.join(' '),
    state,
    prompt: 'consent'
  });

  return `${AUTH_BASE_URL}/${tenantId}/oauth2/v2.0/authorize?${params.toString()}`;
}

export async function exchangeCodeForToken({ code, redirectUri }) {
  const tenantId = getTenantId();
  const params = new URLSearchParams({
    client_id: getClientId(),
    client_secret: getClientSecret(),
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri
  });

  const response = await fetch(`${AUTH_BASE_URL}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error_description || 'Failed to exchange authorization code for token');
  }

  return response.json();
}

export async function refreshAccessToken({ refreshToken }) {
  const tenantId = getTenantId();
  const params = new URLSearchParams({
    client_id: getClientId(),
    client_secret: getClientSecret(),
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    scope: 'offline_access Tasks.ReadWrite User.Read'
  });

  const response = await fetch(`${AUTH_BASE_URL}/${tenantId}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: params.toString()
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error_description || 'Failed to refresh access token');
  }

  return response.json();
}

async function graphRequest({ accessToken, resource, method = 'GET', body, headers = {} }) {
  const url = resource.startsWith('https://') ? resource : `${GRAPH_BASE_URL}${resource}`;

  const response = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
      ...headers
    },
    body: body ? JSON.stringify(body) : undefined
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    const message = error.error?.message || error.message || 'Microsoft Graph request failed';
    const err = new Error(message);
    err.status = response.status;
    err.details = error;
    const retryAfterHeader = response.headers.get('Retry-After');
    if (retryAfterHeader) {
      const retrySeconds = Number(retryAfterHeader);
      if (!Number.isNaN(retrySeconds)) {
        err.retryAfter = retrySeconds;
      }
    }
    throw err;
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

export async function fetchMicrosoftProfile(accessToken) {
  return graphRequest({ accessToken, resource: '/me' });
}

export async function getOrCreatePlannerList(accessToken, displayName = 'Planner') {
  const lists = await graphRequest({
    accessToken,
    resource: `/me/todo/lists?$filter=displayName eq '${displayName.replace(/'/g, "''")}'`
  });

  if (Array.isArray(lists?.value) && lists.value.length > 0) {
    return lists.value[0];
  }

  return graphRequest({
    accessToken,
    resource: '/me/todo/lists',
    method: 'POST',
    body: {
      displayName
    }
  });
}

export async function getTodoTaskDelta(accessToken, listId, deltaToken) {
  try {
    if (deltaToken) {
      return await graphRequest({ accessToken, resource: deltaToken, method: 'GET' });
    }

    return await graphRequest({
      accessToken,
      resource: `/me/todo/lists/${listId}/tasks/delta`
    });
  } catch (error) {
    if (error?.status === 410) {
      const deltaError = new Error('Microsoft Graph delta token is no longer valid');
      deltaError.status = 410;
      throw deltaError;
    }
    throw error;
  }
}

export async function getPlannerTasks(accessToken, listId) {
  return graphRequest({
    accessToken,
    resource: `/me/todo/lists/${listId}/tasks`
  });
}

export async function createTodoTask(accessToken, listId, payload) {
  return graphRequest({
    accessToken,
    resource: `/me/todo/lists/${listId}/tasks`,
    method: 'POST',
    body: payload
  });
}

export async function updateTodoTask(accessToken, listId, taskId, payload, etag) {
  return graphRequest({
    accessToken,
    resource: `/me/todo/lists/${listId}/tasks/${taskId}`,
    method: 'PATCH',
    body: payload,
    headers: etag ? { 'If-Match': etag } : {}
  });
}

export async function deleteTodoTask(accessToken, listId, taskId, etag) {
  return graphRequest({
    accessToken,
    resource: `/me/todo/lists/${listId}/tasks/${taskId}`,
    method: 'DELETE',
    headers: etag ? { 'If-Match': etag } : {}
  });
}

export async function createTodoList(accessToken, displayName) {
  return graphRequest({
    accessToken,
    resource: '/me/todo/lists',
    method: 'POST',
    body: { displayName }
  });
}

export async function getTodoList(accessToken, listId) {
  return graphRequest({
    accessToken,
    resource: `/me/todo/lists/${listId}`
  });
}

export async function listTodoLists(accessToken) {
  return graphRequest({ accessToken, resource: '/me/todo/lists' });
}

export async function deleteTodoList(accessToken, listId) {
  return graphRequest({
    accessToken,
    resource: `/me/todo/lists/${listId}`,
    method: 'DELETE'
  });
}

export async function createTodoSubscription(accessToken, listId, notificationUrl, expirationMinutes = 60, clientState) {
  const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000).toISOString();

  return graphRequest({
    accessToken,
    resource: '/subscriptions',
    method: 'POST',
    body: {
      changeType: 'created,updated,deleted',
      notificationUrl,
      resource: `/me/todo/lists/${listId}/tasks`,
      expirationDateTime: expiresAt,
      latestSupportedTlsVersion: 'v1_2',
      ...(clientState ? { clientState } : {})
    }
  });
}

export async function renewTodoSubscription(accessToken, subscriptionId, expirationMinutes = 60) {
  const expiresAt = new Date(Date.now() + expirationMinutes * 60 * 1000).toISOString();

  return graphRequest({
    accessToken,
    resource: `/subscriptions/${subscriptionId}`,
    method: 'PATCH',
    body: {
      expirationDateTime: expiresAt
    }
  });
}

export async function deleteSubscription(accessToken, subscriptionId) {
  return graphRequest({
    accessToken,
    resource: `/subscriptions/${subscriptionId}`,
    method: 'DELETE'
  });
}

// Backwards compatibility aliases
export const createPlannerTask = createTodoTask;
export const updatePlannerTask = updateTodoTask;
export const deletePlannerTask = deleteTodoTask;
export const getPlannerListDelta = getTodoTaskDelta;
export const renewSubscription = renewTodoSubscription;
