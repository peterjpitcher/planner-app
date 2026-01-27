import { getSupabaseServiceRole } from '@/lib/supabaseServiceRole';
import { updateSecret, retrieveSecret, deleteSecret } from '@/lib/supabaseVault';
import { getOffice365ClientId, getOffice365ClientSecret, getOffice365Scopes, getOffice365TenantId, refreshOffice365AccessToken } from '@/lib/office365/oauth';

function toIsoTimestamp(valueMs) {
  if (!Number.isFinite(valueMs)) return null;
  return new Date(valueMs).toISOString();
}

function parseScopes(scopeValue) {
  if (!scopeValue) return [];
  if (Array.isArray(scopeValue)) return scopeValue.map(String);
  if (typeof scopeValue === 'string') {
    return scopeValue
      .split(' ')
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return [];
}

export async function getOffice365Connection({ userId }) {
  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase
    .from('office365_connections')
    .select('*')
    .eq('user_id', userId)
    .maybeSingle();

  if (error) throw error;
  return data ?? null;
}

export async function upsertOffice365ConnectionFromTokenResponse({
  userId,
  tokenResponse,
  tenantIdOverride,
  userEmail,
}) {
  const supabase = getSupabaseServiceRole();
  const existing = await getOffice365Connection({ userId });

  const refreshToken = tokenResponse?.refresh_token;
  const accessToken = tokenResponse?.access_token;
  if (!refreshToken) {
    throw new Error('Office365 token response missing refresh_token (ensure offline_access scope is granted)');
  }
  if (!accessToken) {
    throw new Error('Office365 token response missing access_token');
  }

  const refreshTokenSecretId = await updateSecret(existing?.refresh_token_secret_id || null, refreshToken);
  const accessTokenSecretId = await updateSecret(existing?.access_token_secret_id || null, accessToken);

  const expiresInSeconds = Number(tokenResponse?.expires_in || 3600);
  const expiresAtMs = Date.now() + expiresInSeconds * 1000;

  const scopes = parseScopes(tokenResponse?.scope);

  const payload = {
    user_id: userId,
    microsoft_tenant_id: tenantIdOverride || existing?.microsoft_tenant_id || getOffice365TenantId(),
    microsoft_user_email: userEmail || existing?.microsoft_user_email || null,
    scopes,
    refresh_token_secret_id: refreshTokenSecretId,
    access_token_secret_id: accessTokenSecretId,
    access_token_expires_at: toIsoTimestamp(expiresAtMs),
    sync_enabled: true,
  };

  const { data, error } = await supabase
    .from('office365_connections')
    .upsert(payload, { onConflict: 'user_id' })
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function deleteOffice365Connection({ userId }) {
  const supabase = getSupabaseServiceRole();
  const existing = await getOffice365Connection({ userId });
  if (!existing) return { deleted: false };

  await deleteSecret(existing.refresh_token_secret_id).catch(() => {});
  await deleteSecret(existing.access_token_secret_id).catch(() => {});

  await supabase.from('office365_project_lists').delete().eq('user_id', userId);
  await supabase.from('office365_task_items').delete().eq('user_id', userId);

  const { error } = await supabase.from('office365_connections').delete().eq('user_id', userId);
  if (error) throw error;

  return { deleted: true };
}

export async function getValidOffice365AccessToken({ userId }) {
  const supabase = getSupabaseServiceRole();
  const connection = await getOffice365Connection({ userId });
  if (!connection?.sync_enabled) {
    throw new Error('Office365 sync is not connected');
  }

  const expiresAt = connection.access_token_expires_at ? new Date(connection.access_token_expires_at).getTime() : 0;
  const hasValidAccessToken = Boolean(connection.access_token_secret_id) && Date.now() < expiresAt - 60_000;

  if (hasValidAccessToken) {
    const token = await retrieveSecret(connection.access_token_secret_id);
    if (token) return token;
  }

  const refreshToken = await retrieveSecret(connection.refresh_token_secret_id);
  if (!refreshToken) {
    throw new Error('Office365 refresh token is missing (reconnect integration)');
  }

  const tenantId = (connection.microsoft_tenant_id || getOffice365TenantId()).trim();
  const tokenResponse = await refreshOffice365AccessToken({
    tenantId,
    clientId: getOffice365ClientId(),
    clientSecret: getOffice365ClientSecret(),
    refreshToken,
    scopes: getOffice365Scopes(),
  });

  const nextRefreshToken = tokenResponse?.refresh_token || refreshToken;
  const nextAccessToken = tokenResponse?.access_token;
  if (!nextAccessToken) {
    throw new Error('Office365 refresh response missing access_token');
  }

  const refreshTokenSecretId = await updateSecret(connection.refresh_token_secret_id, nextRefreshToken);
  const accessTokenSecretId = await updateSecret(connection.access_token_secret_id, nextAccessToken);

  const expiresInSeconds = Number(tokenResponse?.expires_in || 3600);
  const nextExpiresAtMs = Date.now() + expiresInSeconds * 1000;

  const scopes = parseScopes(tokenResponse?.scope);

  const { error } = await supabase
    .from('office365_connections')
    .update({
      refresh_token_secret_id: refreshTokenSecretId,
      access_token_secret_id: accessTokenSecretId,
      access_token_expires_at: toIsoTimestamp(nextExpiresAtMs),
      scopes: scopes.length ? scopes : connection.scopes,
      updated_at: new Date().toISOString(),
    })
    .eq('user_id', userId);

  if (error) throw error;

  return nextAccessToken;
}
