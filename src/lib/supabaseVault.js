import { getSupabaseServiceRole } from './supabaseServiceRole';

export async function storeSecret(secretValue) {
  if (!secretValue) {
    return null;
  }

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase.rpc('vault_create_secret', {
    secret: secretValue
  });

  if (error) {
    throw error;
  }

  return data;
}

export async function updateSecret(secretId, secretValue) {
  if (!secretValue) {
    return secretId || null;
  }

  const supabase = getSupabaseServiceRole();

  if (secretId) {
    const { error } = await supabase.rpc('vault_update_secret', {
      secret_id: secretId,
      secret: secretValue
    });

    if (error) {
      throw error;
    }

    return secretId;
  }

  return storeSecret(secretValue);
}

export async function retrieveSecret(secretId) {
  if (!secretId) {
    return null;
  }

  const supabase = getSupabaseServiceRole();
  const { data, error } = await supabase.rpc('vault_get_secret', {
    secret_id: secretId
  });

  if (error) {
    throw error;
  }

  return data ?? null;
}

export async function deleteSecret(secretId) {
  if (!secretId) {
    return;
  }

  const supabase = getSupabaseServiceRole();
  const { error } = await supabase.rpc('vault_delete_secret', {
    secret_id: secretId
  });

  if (error) {
    throw error;
  }
}
