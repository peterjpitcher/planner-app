# Vercel Environment Variables Setup

To fix the login issue in production, you need to set the following environment variables in your Vercel dashboard:

## Required Environment Variables

1. **NEXTAUTH_URL**
   - Set this to your actual deployment URL
   - Example: `https://your-app-name.vercel.app` (without trailing slash)
   - This MUST match your actual domain

2. **NEXTAUTH_SECRET**
   - Generate a new secret for production using: `openssl rand -base64 32`
   - Never use the same secret as development

3. **NEXT_PUBLIC_SUPABASE_URL**
   - Your Supabase project URL
   - Example: `https://hufxwovthhsjmtifvign.supabase.co`

4. **NEXT_PUBLIC_SUPABASE_ANON_KEY**
   - Your Supabase anonymous key
   - This is safe to expose as it's meant for client-side use

## How to Set in Vercel

1. Go to your Vercel project dashboard
2. Navigate to Settings → Environment Variables
3. Add each variable with the correct production values
4. Make sure they're available for Production environment
5. Redeploy your application

## Common Issues

### Login Button Stuck on "Logging In..."
This usually means:
- `NEXTAUTH_URL` doesn't match your actual deployment URL
- Missing or incorrect `NEXTAUTH_SECRET`
- CORS issues with Supabase (check Supabase dashboard settings)

### Debug Steps
1. Check browser console for errors
2. Check Network tab for failed requests
3. Verify the callback URL in the network request matches your domain
4. Check Vercel Function logs for server-side errors

## Example Production Values
```
NEXTAUTH_URL=https://planner-app.vercel.app
NEXTAUTH_SECRET=your-generated-secret-here
NEXT_PUBLIC_SUPABASE_URL=https://hufxwovthhsjmtifvign.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key-here
```

## Important Notes
- Never commit production secrets to Git
- The `NEXTAUTH_URL` should NOT have a trailing slash
- In production, this should be HTTPS, not HTTP
- Make sure your Supabase project allows your domain in the URL configuration