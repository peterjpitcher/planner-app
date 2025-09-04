# Troubleshooting Guide

## Session/Authentication Issues

### Problem: "Loading user data..." stuck on dashboard

**Symptoms:**
- Dashboard shows "Loading user data..." indefinitely
- Console shows `authenticated` status but `user: undefined`
- Session exists but user object is not populated

**Root Causes:**
1. **Port Mismatch**: App running on different port than NEXTAUTH_URL
2. **Cookie Domain Issues**: Session cookie set for wrong domain/port
3. **Session Callback Not Working**: User data not being extracted from JWT

**Solutions:**

1. **Clear All Cookies**
   - Open DevTools > Application > Cookies
   - Clear all cookies for localhost
   - Clear cookies for all ports (3000, 3001, 3002, etc.)

2. **Ensure Correct Port**
   ```bash
   # Kill any existing processes
   lsof -ti:3000 | xargs kill -9
   lsof -ti:3002 | xargs kill -9
   
   # Start on correct port
   npm run dev
   ```

3. **Check Environment Variables**
   ```bash
   # .env.local should have:
   NEXTAUTH_URL=http://localhost:3000
   ```

4. **Debug Session Structure**
   - Visit: http://localhost:3000/api/auth/debug-session
   - Visit: http://localhost:3000/api/auth/session-test
   - Check if session exists server-side

5. **Force Fresh Login**
   ```bash
   # 1. Clear all cookies
   # 2. Visit /api/auth/signout
   # 3. Login again at /login
   ```

### Problem: Login redirect loop in production

**Symptoms:**
- After login, redirected back to login page
- URL shows: `/login?callbackUrl=%2F`

**Solutions:**

1. **Verify Vercel Environment Variables**
   ```
   NEXTAUTH_URL = https://planner.orangejelly.co.uk
   NEXTAUTH_SECRET = [your-secret]
   ```

2. **Check Cookie Settings**
   - Ensure `trustHost: true` in authOptions
   - Don't use custom cookie names with prefixes

3. **Verify Configuration**
   - Visit: https://planner.orangejelly.co.uk/api/auth/verify-config

### Problem: Session not persisting between page refreshes

**Root Cause:** JWT token not being properly stored or read

**Solutions:**

1. **Check Browser DevTools**
   - Look for `next-auth.session-token` cookie
   - Verify it's set with correct domain and path

2. **Ensure Consistent NEXTAUTH_SECRET**
   - Must be the same in all environments
   - Generate new one: `openssl rand -base64 32`

## Common Fixes Checklist

- [ ] Clear all browser cookies
- [ ] Ensure app runs on port matching NEXTAUTH_URL
- [ ] Verify all environment variables are set
- [ ] Check session callback returns user object
- [ ] Confirm middleware isn't blocking auth routes
- [ ] Test with incognito/private browsing mode