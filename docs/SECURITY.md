# Security Posture

## Current Controls
- **RLS enforced:** Supabase tables are protected with user-scoped policies; all access is via server API routes (no client-side Supabase queries).
- **Server-only secrets:** Service role key is used only in server contexts; only `NEXT_PUBLIC_*` keys reach the client bundle.
- **Auth:** NextAuth sessions gate all API routes; middleware protects app routes.
- **Rate limiting:** Applied to sensitive endpoints (notes, batch operations, auth diagnostics) to mitigate abuse.
- **Access checks:** Task/project mutations verify ownership before writing.

## Operational Notes
- Required env vars: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_KEY`, `NEXTAUTH_SECRET`, `NEXTAUTH_URL`.
- Office 365 tokens are stored in Supabase Vault (server-side only); do not expose vault secret IDs to the client.
- Keep service keys out of the client and logs. Rotate secrets if exposed.
- When adding new Supabase tables, mirror the user-scoped RLS pattern:
  ```sql
  CREATE POLICY "Users manage own rows" ON public.example
  FOR ALL TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);
  ```

## Backlog (from prior audits)
- Harden headers (CSP, X-Frame-Options, X-Content-Type-Options) in `next.config.mjs`/middleware.
- Tighten session handling (shorter lifetimes, rotation on privilege changes).
- Add CSRF protection for custom mutations beyond NextAuth defaults.
- Expand input validation and length limits on all form submissions; sanitize user HTML.
- Reduce production console logging; route errors through centralized handlers/monitoring.
- Consider auth simplification (single source of truth vs mixed NextAuth/Supabase concerns).
