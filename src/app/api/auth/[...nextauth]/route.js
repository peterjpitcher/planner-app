import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { createClient } from '@supabase/supabase-js';

// Create a server-side Supabase client for auth
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseAnonKey) {
  throw new Error('Missing Supabase environment variables');
}

// Create a new client for each auth request to avoid token conflicts
const createSupabaseClient = () => {
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    }
  });
};

// Determine the correct URL for callbacks
const getUrl = () => {
  // In production, use the actual domain
  if (process.env.NODE_ENV === 'production') {
    // First check for explicitly set NEXTAUTH_URL
    if (process.env.NEXTAUTH_URL) return process.env.NEXTAUTH_URL;
    // Then check for Vercel URL
    if (process.env.VERCEL_URL) return `https://${process.env.VERCEL_URL}`;
    // Fallback to hardcoded production domain if needed
    return 'https://planner.orangejelly.co.uk';
  }
  // In development, use localhost
  return process.env.NEXTAUTH_URL || 'http://localhost:3000';
};

const authUrl = getUrl();

// Only log in development
if (process.env.NODE_ENV === 'development') {
  console.log('NextAuth Config:', {
    NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'NOT SET',
    COMPUTED_URL: authUrl,
    NEXTAUTH_SECRET: process.env.NEXTAUTH_SECRET ? 'SET' : 'NOT SET',
    NODE_ENV: process.env.NODE_ENV,
    SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL ? 'SET' : 'NOT SET',
  });
}

export const authOptions = {
  // Configure the base URL for production
  url: authUrl,
  
  // 1. Choose your sign-in methods
  providers: [
    CredentialsProvider({
      name: 'Email + Password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      authorize: async (credentials) => {
        if (!credentials?.email || !credentials.password) {
          console.error('NextAuth: Missing credentials');
          return null;
        }

        try {
          if (process.env.NODE_ENV === 'development') {
            console.log('NextAuth: Attempting Supabase login for:', credentials.email);
          }
          
          // Create a fresh Supabase client for this auth attempt
          const supabase = createSupabaseClient();
          
          const { data, error } = await supabase.auth.signInWithPassword({
            email: credentials.email,
            password: credentials.password,
          });

          if (error) {
            if (process.env.NODE_ENV === 'development') {
              console.error('NextAuth: Supabase auth error:', error.message);
            }
            return null; // Returning null will trigger a failed login
          }

          if (data.user && data.session) {
            if (process.env.NODE_ENV === 'development') {
              console.log('NextAuth: Login successful for user:', data.user.id);
            }
            // You can return a custom object here.
            // The `user` object will be encoded in the JWT.
            return {
              id: data.user.id,
              email: data.user.email,
              accessToken: data.session.access_token,
              // You can add other properties from your user table here
              // e.g. name: data.user.user_metadata.full_name
            };
          }

          console.error('NextAuth: No user or session data returned');
          return null;
        } catch (err) {
          console.error('NextAuth: Unexpected error during authorization:', err);
          return null;
        }
      },
    }),
    // …or add OAuth providers (Google, GitHub, etc.)
  ],

  // 2. Use JSON-Web-Token sessions (no DB lookup per request)
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // keep session alive for 30 days
    updateAge: 24 * 60 * 60, // extend JWT every 24 hours
  },

  // 3. JWT settings
  jwt: {
    secret: process.env.NEXTAUTH_SECRET,
    // you can optionally enable encryption:
    // encryption: true
  },

  // 4. Custom cookie configuration for maximum security
  cookies: {
    sessionToken: {
      name: `next-auth.session-token`,
      options: {
        httpOnly: true, // not accessible from JS
        secure: process.env.NODE_ENV === 'production',
        sameSite: 'lax', // protects against CSRF
        path: '/', // valid on all routes
        maxAge: 30 * 24 * 60 * 60, // 30 days
      },
    },
    // you can override other cookies (e.g. csrfToken) similarly if needed
  },

  // 5. Optional callbacks (e.g. to add roles, extra props)
  callbacks: {
    async jwt({ token, user }) {
      // The `user` object is only passed on the first login.
      // We can add properties to the token here, and they will be available on subsequent requests.
      if (user) {
        token.id = user.id;
        token.accessToken = user.accessToken;
        // token.role = user.role // Example of adding a role
      }
      return token;
    },
    async session({ session, token }) {
      // The session callback is called whenever a session is checked.
      // We can add properties to the session object here.
      if (session.user) {
        session.user.id = token.id;
        // SECURITY: Do not expose accessToken to client-side
        // The token is available server-side via getServerSession
        // session.user.role = token.role; // Pass role to session
      }
      return session;
    },
  },

  pages: {
    signIn: '/login',
    error: '/login', // Redirect errors back to login page with error params
  },
  
  // Enable debug mode in development
  debug: process.env.NODE_ENV === 'development',
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }; 