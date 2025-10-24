INSERT INTO supabase_migrations.schema_migrations (version, name)
SELECT '20250707', '20250707_initial_schema.sql'
WHERE NOT EXISTS (
  SELECT 1 FROM supabase_migrations.schema_migrations WHERE version = '20250707'
);
