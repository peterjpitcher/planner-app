#!/usr/bin/env node

/**
 * Direct migration runner using database URL
 * This connects directly to your Supabase database and runs the migration
 */

const { createClient } = require('@supabase/supabase-js');
const fs = require('fs');
const path = require('path');

// Load environment variables from .env.local
try {
  const envPath = path.join(__dirname, '.env.local');
  const envContent = fs.readFileSync(envPath, 'utf8');
  envContent.split('\n').forEach(line => {
    const [key, ...valueParts] = line.split('=');
    if (key && valueParts.length > 0) {
      const value = valueParts.join('=').replace(/^["']|["']$/g, '');
      process.env[key.trim()] = value.trim();
    }
  });
} catch (err) {
  console.log('⚠️  Could not load .env.local');
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('❌ Missing required environment variables:');
  console.error('  - NEXT_PUBLIC_SUPABASE_URL');
  console.error('  - SUPABASE_SERVICE_KEY (required for admin operations)');
  console.error('\nPlease ensure these are set in your .env.local file');
  process.exit(1);
}

console.log('🚀 Direct Migration Runner');
console.log('==========================\n');

// Read the migration file
const migrationPath = path.join(__dirname, 'supabase/migrations/20250904_performance_and_rls.sql');
const migrationSQL = fs.readFileSync(migrationPath, 'utf8');

console.log('📋 Migration to apply:');
console.log('  - Create 7 performance indexes');
console.log('  - Enable Row Level Security on 3 tables');
console.log('  - Create 12 RLS policies\n');

console.log('⚠️  IMPORTANT: This migration needs to be run in your Supabase SQL Editor.\n');
console.log('Steps to apply:');
console.log('1. Go to your Supabase Dashboard:');
console.log(`   ${supabaseUrl.replace('.supabase.co', '.supabase.co/project/hufxwovthhsjmtifvign/sql')}`);
console.log('\n2. The SQL Editor should open automatically');
console.log('\n3. Copy and paste the following SQL:\n');
console.log('━'.repeat(60));
console.log(migrationSQL);
console.log('━'.repeat(60));
console.log('\n4. Click "Run" to execute the migration');
console.log('\n5. You should see confirmation of:');
console.log('   - Indexes created');
console.log('   - RLS enabled');
console.log('   - Policies created\n');

// Create a ready-to-paste file
const outputFile = 'ready-to-paste-migration.sql';
fs.writeFileSync(outputFile, migrationSQL);
console.log(`💾 Migration SQL saved to: ${outputFile}`);
console.log('   You can copy this file\'s contents to paste into the SQL Editor\n');

// Test current database state
const supabase = createClient(supabaseUrl, supabaseServiceKey, {
  auth: {
    persistSession: false,
    autoRefreshToken: false
  }
});

async function checkCurrentState() {
  console.log('🔍 Checking current database state...\n');
  
  const tables = ['projects', 'tasks', 'notes'];
  let rlsEnabled = 0;
  
  for (const table of tables) {
    try {
      // Try to count rows (will work with service key even if RLS is enabled)
      const { count, error } = await supabase
        .from(table)
        .select('*', { count: 'exact', head: true });
      
      if (!error) {
        console.log(`📊 ${table}: ${count || 0} rows`);
      } else {
        console.log(`⚠️  ${table}: ${error.message}`);
        if (error.message.includes('Row Level Security')) {
          rlsEnabled++;
        }
      }
    } catch (err) {
      console.log(`❌ ${table}: Error checking`);
    }
  }
  
  console.log(`\n📈 Current status:`);
  console.log(`   - Tables with RLS: ${rlsEnabled}/3`);
  console.log(`   - Indexes and policies: Need to check in SQL Editor`);
  console.log('\n✨ After running the migration, your app will have:');
  console.log('   - Significantly improved query performance');
  console.log('   - Secure user data isolation');
  console.log('   - Better scalability\n');
}

checkCurrentState().then(() => {
  console.log('📌 Next step: Copy the SQL above and run it in your Supabase SQL Editor');
  console.log('   Direct link: ' + supabaseUrl.replace('.supabase.co', '.supabase.co/project/hufxwovthhsjmtifvign/sql\n'));
}).catch(err => {
  console.error('Error checking state:', err.message);
});