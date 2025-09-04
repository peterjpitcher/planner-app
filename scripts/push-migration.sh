#!/bin/bash

# Script to push migrations to Supabase
echo "🚀 Supabase Migration Push Script"
echo "=================================="
echo ""

# Check if SUPABASE_ACCESS_TOKEN is set
if [ -z "$SUPABASE_ACCESS_TOKEN" ]; then
    echo "⚠️  SUPABASE_ACCESS_TOKEN is not set"
    echo ""
    echo "To push migrations, you need to:"
    echo "1. Go to https://supabase.com/dashboard/account/tokens"
    echo "2. Generate a new access token"
    echo "3. Run: export SUPABASE_ACCESS_TOKEN='your-token-here'"
    echo "4. Then run this script again"
    exit 1
fi

echo "✅ Access token found"
echo ""

# Login to Supabase
echo "🔐 Logging in to Supabase..."
supabase login --token "$SUPABASE_ACCESS_TOKEN"

if [ $? -ne 0 ]; then
    echo "❌ Login failed"
    exit 1
fi

echo "✅ Logged in successfully"
echo ""

# Link the project
echo "🔗 Linking to project hufxwovthhsjmtifvign..."
supabase link --project-ref hufxwovthhsjmtifvign

if [ $? -ne 0 ]; then
    echo "❌ Project linking failed"
    exit 1
fi

echo "✅ Project linked successfully"
echo ""

# Push migrations
echo "📤 Pushing migrations to remote database..."
supabase db push

if [ $? -eq 0 ]; then
    echo ""
    echo "✅ Migrations pushed successfully!"
    echo ""
    echo "You can verify the migration by:"
    echo "1. Going to your Supabase Dashboard"
    echo "2. Navigate to Table Editor"
    echo "3. Check that RLS is enabled on projects, tasks, and notes tables"
    echo ""
else
    echo ""
    echo "❌ Migration push failed"
    echo "You may need to run the migration manually in the SQL Editor"
fi