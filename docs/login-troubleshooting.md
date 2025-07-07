# Login Troubleshooting Guide

## Issue: Login button stuck on "Logging in..."

### Immediate Actions:

1. **Check Browser Console**
   - Open Developer Tools (F12)
   - Look for error messages in Console tab
   - Check Network tab for failed requests

2. **Verify Vercel Environment Variables**
   ```
   NEXTAUTH_URL=https://your-actual-domain.vercel.app
   NEXTAUTH_SECRET=your-production-secret
   NEXT_PUBLIC_SUPABASE_URL=your-supabase-url
   NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
   ```

3. **Common Fixes:**
   - NEXTAUTH_URL must match your exact deployment URL (no trailing slash)
   - Generate a new NEXTAUTH_SECRET for production
   - Ensure all environment variables are set in Vercel dashboard
   - Redeploy after setting environment variables

### Debug Information Added:

The login form now includes:
- Better error messages for different failure types
- Console logging for debugging
- 5-second timeout safety to reset the button
- More specific error handling

### Testing Checklist:

1. ✓ Environment variables set in Vercel?
2. ✓ NEXTAUTH_URL matches your domain exactly?
3. ✓ Supabase allows your domain in URL configuration?
4. ✓ Browser console shows specific errors?
5. ✓ Network tab shows the callback URL?

### If Still Not Working:

1. Check Vercel Function logs:
   - Go to Vercel Dashboard → Functions tab
   - Look for errors in api/auth/[...nextauth]

2. Test locally with production values:
   - Update .env.local with production URL temporarily
   - See if issue reproduces locally

3. Verify Supabase:
   - Check if user exists in Supabase
   - Verify password is correct
   - Check Supabase logs for auth errors