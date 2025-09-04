# Release Notes

## Session Date: $(date +%Y-%m-%d)

### Authentication System Overhaul & Session Persistence Fix

This release resolves a critical session persistence issue and modernises the application's authentication system by migrating from a custom React Context-based solution to NextAuth.js.

**Key Enhancements:**

*   **Persistent Logins:** The primary goal of this update was to fix an issue where users were required to log in after every browser session. By implementing NextAuth.js with a 30-day JWT session `maxAge`, users now remain securely logged in across browser restarts, providing a much smoother user experience.
*   **Robust Session Management:** Replaced the manual `AuthContext` with the industry-standard `SessionProvider` from `next-auth/react`. Session state is now handled reliably and is available throughout the application.
*   **Enhanced Security:**
    *   The session is managed via a secure, `httpOnly` JWT cookie, preventing access from client-side JavaScript.
    *   Utilises the `__Host-` cookie prefix, a security best practice that restricts the cookie to the host and ensures it's sent only over HTTPS.
    *   All authentication logic is centralized in the `src/app/api/auth/[...nextauth]/route.js` API endpoint, which uses the required `NEXTAUTH_SECRET` to sign and encrypt session tokens.
*   **Code Modernization & Cleanup:**
    *   Refactored all components and pages to use the `useSession()` hook instead of the custom `useAuth()` hook.
    *   Removed the now-redundant `src/contexts/AuthContext.js` file, simplifying the codebase.
    *   The `LoginForm` now uses the `signIn()` and `signOut()` methods from `next-auth/react`, standardizing the authentication flow.

**Action Required by Developer:**

*   As part of this update, a `.env.local` file is required at the project root with the `NEXTAUTH_SECRET` and `NEXTAUTH_URL` variables. These were provided during the session. 