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
     * - /api/debug-env (debug endpoint)
     * - /_next/static (static files)
     * - /_next/image (image optimization files)
     * - /favicon.ico (favicon file)
     * - /public/* (public files)
     */
    "/((?!login|api/auth|api/debug-env|api/health|_next/static|_next/image|favicon.ico|public).*)",
  ],
};
