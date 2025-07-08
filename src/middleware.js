import { withAuth } from "next-auth/middleware";
import { NextResponse } from "next/server";

export default withAuth(
  function middleware(req) {
    // Custom logic can go here if needed
    console.log('Middleware: Path:', req.nextUrl.pathname, 'Has token:', !!req.nextauth?.token);
    return NextResponse.next();
  },
  {
    callbacks: {
      authorized: ({ token, req }) => {
        const isAuthorized = !!token;
        console.log('Middleware authorized check:', req.nextUrl.pathname, 'authorized:', isAuthorized);
        return isAuthorized;
      },
    },
    pages: {
      signIn: "/login",
    },
  }
);

// Protect all routes except public ones
export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - /login (authentication page)
     * - /api/auth/* (NextAuth.js routes)
     * - /_next/static (static files)
     * - /_next/image (image optimization files)
     * - /favicon.ico (favicon file)
     * - /public/* (public files)
     */
    "/((?!login|api/auth|_next/static|_next/image|favicon.ico|public).*)",
  ],
};