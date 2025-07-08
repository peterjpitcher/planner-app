import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    // Log for debugging in development
    if (process.env.NODE_ENV === 'development') {
      console.log('Middleware - path:', req.nextUrl.pathname, 'token:', !!req.nextauth.token);
    }
    
    // The token exists if we reach here
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        // Log authorization attempts in development
        if (process.env.NODE_ENV === 'development') {
          console.log('Middleware authorized callback - path:', req.nextUrl.pathname, 'token exists:', !!token);
        }
        
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
    "/((?!login|api/auth|api/debug-env|_next/static|_next/image|favicon.ico|public).*)",
  ],
};