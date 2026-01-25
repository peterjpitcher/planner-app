#!/usr/bin/env node

/**
 * Execute Migration via Supabase HTTP API
 * This uses the Supabase REST API to execute SQL statements
 */

const https = require('https');
const fs = require('fs');
const path = require('path');
const projectRoot = path.resolve(__dirname, '..');

// Load environment variables from .env.local
try {
  const envPath = path.join(projectRoot, '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').replace(/^["']|["']$/g, '');
      process.env[key.trim()] = value.trim();
    }
  });
} catch (err) {
  console.log('⚠️  Could not load .env.local, using existing environment variables');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('  - NEXT_PUBLIC_SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_KEY (required for admin operations)');
  process.exit(1);
}

// Extract project ref from URL
const projectRef = supabaseUrl.match(/https:\/\/([^.]+)\.supabase\.co/)?.[1];
if (!projectRef) {
  console.error('❌ Could not extract project reference from Supabase URL');
  process.exit(1);
}

console.log(`🔗 Connecting to Supabase project: ${projectRef}`);

// Migration statements broken into smaller chunks
const migrations = [
  {
    name: 'Create projects performance indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_projects_user_status_updated 
      ON public.projects (user_id, status, updated_at DESC);
      
      CREATE INDEX IF NOT EXISTS idx_projects_user_due_date 
      ON public.projects (user_id, due_date) 
      WHERE status NOT IN ('Completed', 'Cancelled');
    `
  },
  {
    name: 'Create tasks performance indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_tasks_user_completed_due_priority 
      ON public.tasks (user_id, is_completed, due_date, priority DESC);
      
      CREATE INDEX IF NOT EXISTS idx_tasks_project_id 
      ON public.tasks (project_id);
      
      CREATE INDEX IF NOT EXISTS idx_tasks_user_project 
      ON public.tasks (user_id, project_id);
    `
  },
  {
    name: 'Create notes performance indexes',
    sql: `
      CREATE INDEX IF NOT EXISTS idx_notes_task_created 
      ON public.notes (task_id, created_at DESC);
      
      CREATE INDEX IF NOT EXISTS idx_notes_project_created 
      ON public.notes (project_id, created_at DESC);
    `
  },
  {
    name: 'Create journal entries table, indexes, and RLS policies',
    sql: `
      CREATE TABLE IF NOT EXISTS public.journal_entries (
        id uuid not null default gen_random_uuid(),
        user_id uuid not null default auth.uid(),
        content text not null,
        created_at timestamp with time zone not null default now(),
        updated_at timestamp with time zone not null default now(),
        constraint journal_entries_pkey primary key (id),
        constraint journal_entries_user_id_fkey foreign key (user_id) references auth.users (id) on delete cascade
      );

      CREATE INDEX IF NOT EXISTS journal_entries_user_id_idx 
      ON public.journal_entries (user_id);

      CREATE INDEX IF NOT EXISTS journal_entries_created_at_idx 
      ON public.journal_entries (created_at);

      ALTER TABLE public.journal_entries ENABLE ROW LEVEL SECURITY;

      DROP POLICY IF EXISTS "Users can view their own journal entries" ON public.journal_entries;
      CREATE POLICY "Users can view their own journal entries" 
      ON public.journal_entries FOR SELECT 
      USING (auth.uid() = user_id);

      DROP POLICY IF EXISTS "Users can create their own journal entries" ON public.journal_entries;
      CREATE POLICY "Users can create their own journal entries" 
      ON public.journal_entries FOR INSERT 
      WITH CHECK (auth.uid() = user_id);

      DROP POLICY IF EXISTS "Users can update their own journal entries" ON public.journal_entries;
      CREATE POLICY "Users can update their own journal entries" 
      ON public.journal_entries FOR UPDATE 
      USING (auth.uid() = user_id);

      DROP POLICY IF EXISTS "Users can delete their own journal entries" ON public.journal_entries;
      CREATE POLICY "Users can delete their own journal entries" 
      ON public.journal_entries FOR DELETE 
      USING (auth.uid() = user_id);
    `
  }
];

// Function to execute SQL via REST API
async function executeSQL(sql, migrationName) {
  return new Promise((resolve, reject) => {
    const url = new URL(`${supabaseUrl}/rest/v1/rpc/exec_sql`);
    
    const postData = JSON.stringify({ query: sql });
    
    const options = {
      hostname: url.hostname,
      path: url.pathname,
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(postData),
        'apikey': supabaseServiceKey,
        'Authorization': `Bearer ${supabaseServiceKey}`,
        'Prefer': 'return=minimal'
      }
    };
    
    const req = https.request(options, (res) => {
      let data = '';
      
      res.on('data', (chunk) => {
        data += chunk;
      });
      
      res.on('end', () => {
        if (res.statusCode === 200 || res.statusCode === 201 || res.statusCode === 204) {
          console.log(`✅ ${migrationName}: Success`);
          resolve({ success: true });
        } else if (res.statusCode === 404) {
          console.log(`⚠️  ${migrationName}: RPC function not available`);
          resolve({ success: false, reason: 'rpc_not_found' });
        } else {
          console.log(`❌ ${migrationName}: Failed (HTTP ${res.statusCode})`);
          try {
            const error = JSON.parse(data);
            console.log(`   Error: ${error.message || error.error || 'Unknown error'}`);
          } catch (e) {
            console.log(`   Response: ${data}`);
          }
          resolve({ success: false, reason: 'http_error' });
        }
      });
    });
    
    req.on('error', (err) => {
      console.error(`❌ ${migrationName}: Request failed`);
      console.error(`   ${err.message}`);
      resolve({ success: false, reason: 'request_error' });
    });
    
    req.write(postData);
    req.end();
  });
}

async function runMigrations() {
  console.log('\n📦 Starting database migration...\n');
  console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  let successCount = 0;
  let failCount = 0;
  let rpcNotFound = false;
  
  for (const migration of migrations) {
    const result = await executeSQL(migration.sql, migration.name);
    if (result.success) {
      successCount++;
    } else {
      failCount++;
      if (result.reason === 'rpc_not_found') {
        rpcNotFound = true;
        break; // Stop trying if RPC doesn't exist
      }
    }
  }
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
  
  if (rpcNotFound) {
    console.log('📝 The exec_sql RPC function is not available in your Supabase project.');
    console.log('   SQL execution via API requires setting up a custom RPC function.\n');
    console.log('To enable this, run the following in your Supabase SQL Editor:\n');
    
    const rpcSetup = `
-- Create a function to execute SQL (for admin use only)
CREATE OR REPLACE FUNCTION exec_sql(query text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  -- Only allow service role to execute
  IF auth.role() != 'service_role' THEN
    RAISE EXCEPTION 'Unauthorized';
  END IF;
  
  -- Execute the query
  EXECUTE query;
END;
$$;

-- Grant execute permission only to service role
REVOKE ALL ON FUNCTION exec_sql(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION exec_sql(text) TO service_role;
`;
    
    console.log(rpcSetup);
    console.log('\nAfter creating this function, run this script again.\n');
    
    // Save to file
    const rpcSetupPath = path.join(projectRoot, 'db', 'rpc', 'create-exec-sql-function.sql');
    fs.mkdirSync(path.dirname(rpcSetupPath), { recursive: true });
    fs.writeFileSync(rpcSetupPath, rpcSetup);
    console.log(`💾 RPC setup SQL saved to: ${path.relative(projectRoot, rpcSetupPath)}\n`);
  } else if (failCount === 0) {
    console.log('✨ All migrations completed successfully!\n');
  } else {
    console.log(`⚠️  Migration completed with issues:`);
    console.log(`   ✅ Successful: ${successCount}`);
    console.log(`   ❌ Failed: ${failCount}\n`);
  }
  
  // Always output the manual migration SQL
  console.log('📌 For manual execution, the complete migration SQL is in:');
  console.log('   - db/migrations/archive/001_add_performance_indexes.sql');
  console.log('   - db/migrations/migration-to-run.sql\n');
  console.log('Copy the content to your Supabase SQL Editor and run it there.\n');
}

// Run the migrations
runMigrations().catch(err => {
  console.error('❌ Migration script failed:', err.message);
  process.exit(1);
});
