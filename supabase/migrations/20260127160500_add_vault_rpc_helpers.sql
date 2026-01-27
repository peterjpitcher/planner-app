-- RPC helpers for Supabase Vault
--
-- PostgREST exposes RPC functions from the configured API schemas (typically `public`).
-- The Vault extension lives in the `vault` schema, so we provide a minimal, service-role-only
-- wrapper API in `public` for server-side code.

create or replace function public.vault_create_secret(secret text)
returns uuid
language plpgsql
security definer
as $$
declare
  secret_id uuid;
begin
  if auth.role() != 'service_role' then
    raise exception 'Unauthorized';
  end if;

  select vault.create_secret(secret) into secret_id;
  return secret_id;
end;
$$;

revoke all on function public.vault_create_secret(text) from public;
grant execute on function public.vault_create_secret(text) to service_role;

create or replace function public.vault_update_secret(secret_id uuid, secret text)
returns void
language plpgsql
security definer
as $$
begin
  if auth.role() != 'service_role' then
    raise exception 'Unauthorized';
  end if;

  perform vault.update_secret(secret_id, secret);
end;
$$;

revoke all on function public.vault_update_secret(uuid, text) from public;
grant execute on function public.vault_update_secret(uuid, text) to service_role;

create or replace function public.vault_get_secret(secret_id uuid)
returns text
language plpgsql
security definer
as $$
declare
  decrypted text;
begin
  if auth.role() != 'service_role' then
    raise exception 'Unauthorized';
  end if;

  select decrypted_secret
    into decrypted
    from vault.decrypted_secrets
   where id = secret_id;

  return decrypted;
end;
$$;

revoke all on function public.vault_get_secret(uuid) from public;
grant execute on function public.vault_get_secret(uuid) to service_role;

create or replace function public.vault_delete_secret(secret_id uuid)
returns void
language plpgsql
security definer
as $$
begin
  if auth.role() != 'service_role' then
    raise exception 'Unauthorized';
  end if;

  delete from vault.secrets where id = secret_id;
end;
$$;

revoke all on function public.vault_delete_secret(uuid) from public;
grant execute on function public.vault_delete_secret(uuid) to service_role;

