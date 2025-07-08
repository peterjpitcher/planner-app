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
  // In production, ALWAYS use the production domain
  if (process.env.NODE_ENV === 'production') {
    // Force production URL regardless of environment variable
    return 'https://planner.orangejelly.co.uk';
  }
  // In development, use localhost
  return process.env.NEXTAUTH_URL || 'http://localhost:3000';
};

const authUrl = getUrl();

// Log configuration issues
console.log('NextAuth Config:', {
  NEXTAUTH_URL: process.env.NEXTAUTH_URL || 'NOT SET',
  COMPUTED_URL: authUrl,
  NODE_ENV: process.env.NODE_ENV,
  WARNING: process.env.NODE_ENV === 'production' && process.env.NEXTAUTH_URL?.includes('localhost') 
    ? 'NEXTAUTH_URL is set to localhost in production!' 
    : null
});

// Override NEXTAUTH_URL environment variable in production
if (process.env.NODE_ENV === 'production') {
  process.env.NEXTAUTH_URL = 'https://planner.orangejelly.co.uk';
}

export const authOptions = {
  
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
            // Return user object with all necessary fields
            return {
              id: data.user.id,
              email: data.user.email || credentials.email, // Fallback to input email
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

  // 4. Use default cookie settings for better compatibility
  // NextAuth will handle cookie configuration automatically

  // 5. Optional callbacks (e.g. to add roles, extra props)
  callbacks: {
    async jwt({ token, user }) {
      // The `user` object is only passed on the first login.
      // We can add properties to the token here, and they will be available on subsequent requests.
      if (user) {
        token.id = user.id;
        token.email = user.email;
        token.accessToken = user.accessToken;
      }
      return token;
    },
    async session({ session, token }) {
      // The session callback is called whenever a session is checked.
      // Ensure session.user exists and populate it with token data
      if (token) {
        session.user = {
          id: token.id,
          email: token.email,
        };
      }
      return session;
    },
  },

  pages: {
    signIn: '/login',
    error: '/login', // Redirect errors back to login page with error params
  },
  
  // Enable debug logs to troubleshoot
  debug: true,
  
  // Ensure cookies work properly
  useSecureCookies: process.env.NODE_ENV === 'production',
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }; 