# Environment Variables Setup

This document outlines all required environment variables for the Planner application.

## Required Environment Variables

### 1. Authentication Variables

#### NEXTAUTH_URL
- **Description**: The canonical URL of your site
- **Production Value**: `https://planner.orangejelly.co.uk`
- **Local Development**: `http://localhost:3000`
- **Important**: Do NOT include `/api/auth` or any path suffix
- **Vercel Note**: This should be set in the Vercel dashboard, not in `.env` files

#### NEXTAUTH_SECRET
- **Description**: A random string used to encrypt JWT tokens
- **How to Generate**: Run `openssl rand -base64 32`
- **Example**: `K7gNU3sdo+OL0wNhqoVWhr3g6s1xYv72ol/pe/Unols=`
- **Important**: Must be the same across all deployments and rebuilds

### 2. Supabase Variables

#### NEXT_PUBLIC_SUPABASE_URL
- **Description**: Your Supabase project URL
- **Format**: `https://[PROJECT_ID].supabase.co`
- **Where to Find**: Supabase Dashboard > Settings > API

#### NEXT_PUBLIC_SUPABASE_ANON_KEY
- **Description**: Your Supabase anonymous/public key
- **Where to Find**: Supabase Dashboard > Settings > API > anon/public key
- **Note**: This is safe to expose in client-side code

### 3. Daily Task Digest Email (Office 365)

These are required to send the daily 09:30 (Europe/London) digest email via Microsoft Graph.

#### MICROSOFT_CLIENT_ID
- **Description**: Azure App Registration client ID

#### MICROSOFT_CLIENT_SECRET
- **Description**: Azure App Registration client secret

#### MICROSOFT_TENANT_ID
- **Description**: Microsoft Entra tenant ID (directory/tenant ID)

#### MICROSOFT_USER_EMAIL
- **Description**: The mailbox to send from and to (daily digest is sent to this address)
- **Note**: The Azure app must have Microsoft Graph `Mail.Send` **application** permission with admin consent.

#### Optional Digest Variables
- `DIGEST_USER_ID` - Explicit Supabase `auth.users.id` to fetch tasks for (skips user lookup).
- `DIGEST_USER_EMAIL` - Email to find the Supabase user for (defaults to `MICROSOFT_USER_EMAIL`).
- `DIGEST_DASHBOARD_URL` - Link included in the email (defaults to `NEXTAUTH_URL`).
- `DAILY_TASK_EMAIL_WINDOW_MINUTES` - Minute window for sending (default `5`).
- `CRON_MANUAL_TOKEN` - Allows manual triggering in production via `?token=...`.

## Setting Environment Variables

### For Local Development

Create a `.env.local` file in your project root:

```bash
# Authentication
NEXTAUTH_URL=http://localhost:3000
NEXTAUTH_SECRET=your-generated-secret-here

# Supabase
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

### For Vercel Production

1. Go to your Vercel project dashboard
2. Navigate to Settings > Environment Variables
3. Add each variable with these exact values:

```
NEXTAUTH_URL = https://planner.orangejelly.co.uk
NEXTAUTH_SECRET = [your-generated-secret]
NEXT_PUBLIC_SUPABASE_URL = [your-supabase-url]
NEXT_PUBLIC_SUPABASE_ANON_KEY = [your-anon-key]
SUPABASE_SERVICE_KEY = [your-service-role-key]

# Daily task digest email (Office 365 / Microsoft Graph)
MICROSOFT_CLIENT_ID = [your-azure-app-client-id]
MICROSOFT_CLIENT_SECRET = [your-azure-app-client-secret]
MICROSOFT_TENANT_ID = [your-tenant-id]
MICROSOFT_USER_EMAIL = peter@orangejelly.co.uk
```

**Important Notes for Vercel:**
- Do NOT quote the values
- Do NOT add trailing slashes to URLs
- Ensure variables are set for Production environment
- After setting variables, redeploy your application

## Verification

After setting up environment variables, you can verify the configuration:

1. **Local Development**: Visit `http://localhost:3000/api/auth/verify-config`
2. **Production**: Visit `https://planner.orangejelly.co.uk/api/auth/verify-config`

This endpoint will show:
- Which variables are set/missing
- Any configuration warnings
- Recommendations for fixes

## Common Issues

### Login Redirect Loop
**Symptoms**: After successful login, redirected back to login page
**Causes**:
- `NEXTAUTH_URL` is missing or incorrect
- `NEXTAUTH_URL` contains `localhost` in production
- `NEXTAUTH_SECRET` is missing

**Fix**: Ensure all environment variables are correctly set in Vercel

### "Logging In..." Button Stuck
**Symptoms**: Login button shows "Logging In..." but nothing happens
**Causes**:
- Missing Supabase environment variables
- Incorrect Supabase credentials

**Fix**: Verify Supabase URL and anon key are correct

### Session Not Persisting
**Symptoms**: Have to login again after page refresh
**Causes**:
- `NEXTAUTH_SECRET` mismatch between builds
- Cookie domain issues

**Fix**: Ensure `NEXTAUTH_SECRET` is consistent across all deployments

## Testing Authentication

1. Clear all cookies for your domain
2. Try logging in with valid credentials
3. Check browser DevTools:
   - Network tab: Look for `/api/auth/session` calls
   - Application tab: Check for `next-auth.session-token` cookie
4. If issues persist, check `/api/auth/verify-config` endpoint

## Security Notes

- Never commit `.env` files to version control
- Always use HTTPS in production
- Rotate `NEXTAUTH_SECRET` periodically (requires all users to re-login)
- Keep Supabase RLS (Row Level Security) policies updated
