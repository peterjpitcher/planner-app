# Database Files

This folder contains **manual SQL scripts** and **helper snippets** for working with the Planner database.

For Supabase CLI-managed migrations, see `supabase/migrations/`.

## Contents

- `db/migrations/` – Manual migrations to run in the Supabase SQL Editor.
- `db/migrations/archive/` – Historical/legacy migration SQL kept for reference.
- `db/maintenance/` – One-off maintenance scripts (indexes, policy fixes, etc.).
- `db/rpc/` – SQL snippets for required RPC helpers (e.g. `exec_sql`).

