#!/usr/bin/env node

/**
 * Database Migration Runner
 * This script creates the necessary indexes and RLS policies for the Planner app
 * 
 * Usage: node run-migration.js
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs').promises;
const path = require('path');

// Load environment variables from .env.local
try {
  const envPath = path.join(__dirname, '.env.local');
  const envContent = require('fs').readFileSync(envPath, 'utf8');
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
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY || process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('  - NEXT_PUBLIC_SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_KEY (or NEXT_PUBLIC_SUPABASE_ANON_KEY)');
  process.exit(1);
}

console.log('🔗 Connecting to Supabase...');
console.log(`   URL: ${supabaseUrl}`);

// Create Supabase client with service key for admin operations
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

// Test connection first
async function testConnection() {
  try {
    const { data, error } = await supabase
      .from('projects')
      .select('id')
      .limit(1);
    
    if (error && error.message.includes('Row Level Security')) {
      console.log('✅ Connected to Supabase (RLS is active)');
      return true;
    } else if (error) {
      console.error('❌ Connection test failed:', error.message);
      return false;
    }
    
    console.log('✅ Connected to Supabase');
    return true;
  } catch (err) {
    console.error('❌ Connection test failed:', err.message);
    return false;
  }
}

// Check if we can use service key for RLS bypass
async function checkServiceKeyAccess() {
  try {
    // Try to count all projects (will fail if using anon key with RLS)
    const { count, error } = await supabase
      .from('projects')
      .select('*', { count: 'exact', head: true });
    
    if (error) {
      if (error.message.includes('Row Level Security')) {
        console.log('⚠️  Using anonymous key - RLS policies are enforced');
        console.log('   Some operations may fail. Consider using SUPABASE_SERVICE_KEY');
        return false;
      }
      throw error;
    }
    
    console.log('✅ Using service key - full access available');
    return true;
  } catch (err) {
    console.log('⚠️  Limited access - some operations may be restricted');
    return false;
  }
}

async function runMigration() {
  console.log('\n📦 Starting database migration...\n');
  
  // Test connection
  const connected = await testConnection();
  if (!connected) {
    console.error('\n❌ Could not connect to database. Please check your credentials.');
    process.exit(1);
  }
  
  const hasFullAccess = await checkServiceKeyAccess();
  
  console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━');
  console.log('\n📋 Migration Summary:\n');
  console.log('This migration needs to:');
  console.log('  1. Create performance indexes on projects, tasks, and notes tables');
  console.log('  2. Enable Row Level Security (RLS) on all tables');
  console.log('  3. Create RLS policies for user data isolation\n');
  
  if (!hasFullAccess) {
    console.log('⚠️  WARNING: Cannot execute DDL statements through the API without service key.');
    console.log('\n📝 Please run the following SQL in your Supabase SQL Editor:\n');
    console.log('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    
    // Output the SQL for manual execution
    const migrationSQL = `
-- Performance Indexes for Planner Application
-- ============================================

-- Projects indexes
CREATE INDEX IF NOT EXISTS idx_projects_user_status_updated 
ON public.projects (user_id, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_projects_user_due_date 
ON public.projects (user_id, due_date) 
WHERE status NOT IN ('Completed', 'Cancelled');

-- Tasks indexes  
CREATE INDEX IF NOT EXISTS idx_tasks_user_completed_due_priority 
ON public.tasks (user_id, is_completed, due_date, priority DESC);

CREATE INDEX IF NOT EXISTS idx_tasks_project_id 
ON public.tasks (project_id);

CREATE INDEX IF NOT EXISTS idx_tasks_user_project 
ON public.tasks (user_id, project_id);

-- Notes indexes
CREATE INDEX IF NOT EXISTS idx_notes_task_created 
ON public.notes (task_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_notes_project_created 
ON public.notes (project_id, created_at DESC);

-- Enable Row Level Security
-- ==========================

ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tasks ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes ENABLE ROW LEVEL SECURITY;

-- Projects RLS Policies
-- =====================

DROP POLICY IF EXISTS "Users can view their own projects" ON public.projects;
CREATE POLICY "Users can view their own projects" 
ON public.projects FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own projects" ON public.projects;
CREATE POLICY "Users can insert their own projects" 
ON public.projects FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own projects" ON public.projects;
CREATE POLICY "Users can update their own projects" 
ON public.projects FOR UPDATE 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own projects" ON public.projects;
CREATE POLICY "Users can delete their own projects" 
ON public.projects FOR DELETE 
USING (auth.uid() = user_id);

-- Tasks RLS Policies
-- ==================

DROP POLICY IF EXISTS "Users can view their own tasks" ON public.tasks;
CREATE POLICY "Users can view their own tasks" 
ON public.tasks FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own tasks" ON public.tasks;
CREATE POLICY "Users can insert their own tasks" 
ON public.tasks FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own tasks" ON public.tasks;
CREATE POLICY "Users can update their own tasks" 
ON public.tasks FOR UPDATE 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own tasks" ON public.tasks;
CREATE POLICY "Users can delete their own tasks" 
ON public.tasks FOR DELETE 
USING (auth.uid() = user_id);

-- Notes RLS Policies
-- ==================

DROP POLICY IF EXISTS "Users can view their own notes" ON public.notes;
CREATE POLICY "Users can view their own notes" 
ON public.notes FOR SELECT 
USING (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can insert their own notes" ON public.notes;
CREATE POLICY "Users can insert their own notes" 
ON public.notes FOR INSERT 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can update their own notes" ON public.notes;
CREATE POLICY "Users can update their own notes" 
ON public.notes FOR UPDATE 
USING (auth.uid() = user_id) 
WITH CHECK (auth.uid() = user_id);

DROP POLICY IF EXISTS "Users can delete their own notes" ON public.notes;
CREATE POLICY "Users can delete their own notes" 
ON public.notes FOR DELETE 
USING (auth.uid() = user_id);

-- Verification Query
-- ==================
-- Run this to verify indexes were created:

SELECT 
    schemaname,
    tablename,
    indexname
FROM 
    pg_indexes
WHERE 
    schemaname = 'public'
    AND tablename IN ('projects', 'tasks', 'notes')
ORDER BY 
    tablename, indexname;
`;
    
    console.log(migrationSQL);
    console.log('\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n');
    console.log('📌 To apply this migration:');
    console.log('   1. Go to your Supabase Dashboard');
    console.log('   2. Navigate to SQL Editor');
    console.log('   3. Copy and paste the SQL above');
    console.log('   4. Click "Run" to execute\n');
    
    // Also save to file for convenience
    const migrationFile = 'migration-to-run.sql';
    await fs.writeFile(migrationFile, migrationSQL);
    console.log(`💾 Migration SQL also saved to: ${migrationFile}\n`);
    
  } else {
    console.log('❌ Direct SQL execution through JavaScript client is not supported.');
    console.log('   Please use the Supabase SQL Editor to run the migration.\n');
    
    // Save migration to file
    const migrationFile = 'migration-to-run.sql';
    const migrationContent = await fs.readFile('src/migrations/001_add_performance_indexes.sql', 'utf8');
    await fs.writeFile(migrationFile, migrationContent);
    console.log(`💾 Migration SQL saved to: ${migrationFile}`);
    console.log('   Copy this file content to your Supabase SQL Editor and run it.\n');
  }
  
  // Try to verify current state
  console.log('🔍 Checking current database state...\n');
  
  try {
    // Check if we can query tables
    const tables = ['projects', 'tasks', 'notes'];
    
    for (const table of tables) {
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (error) {
        if (error.message.includes('Row Level Security')) {
          console.log(`✅ ${table}: RLS is enabled (good for security)`);
        } else {
          console.log(`⚠️  ${table}: ${error.message}`);
        }
      } else {
        console.log(`📊 ${table}: Found ${count || 0} accessible rows`);
      }
    }
  } catch (err) {
    console.log('⚠️  Could not verify table state:', err.message);
  }
  
  console.log('\n✨ Migration preparation complete!');
  console.log('   Please run the SQL in your Supabase Dashboard to apply changes.\n');
}

// Run the migration
runMigration().catch(err => {
  console.error('\n❌ Migration failed:', err.message);
  process.exit(1);
});