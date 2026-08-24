import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    // The token exists if we reach here
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Allow the request if there's a valid token
        return !!token;
      },
    },
    pages: {
      signIn: "/login",
    },
    cookies: {
      sessionToken: {
        name:
          process.env.NODE_ENV === "production"
            ? "__Secure-next-auth.session-token"
            : "next-auth.session-token",
      },
    },
    secret: process.env.NEXTAUTH_SECRET, // Explicitly pass the secret
  }
);

// Protect all routes except public ones
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /login (authentication page)
     * - /api/auth/* (NextAuth.js routes)
     * - /api/actions/* (signed one-click links from the daily digest email.
     *   They carry their own HMAC, expiry, action allow-list and single-use jti,
     *   and are opened from an email client's browser that usually holds no
     *   session cookie. Gating them here redirected the tap to /login and left
     *   the single-use token sitting in the login URL, so in browser history)
     * - /api/cron/* (shared-secret guarded)
     * - /api/debug-env (debug endpoint)
     * - /_next/static (static files)
     * - /_next/image (image optimization files)
     * - /favicon.ico (favicon file)
     * - /public/* (public files)
     */
    "/((?!login|api/auth|api/actions|api/cron|api/debug-env|api/health|api/integrations/office365/callback|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
