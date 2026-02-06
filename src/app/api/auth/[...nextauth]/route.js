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

// Configuration logging disabled for cleaner output

// Override NEXTAUTH_URL environment variable in production
if (process.env.NODE_ENV === 'production') {
  process.env.NEXTAUTH_URL = 'https://planner.orangejelly.co.uk';
}

// Ensure NEXTAUTH_URL matches the actual port in development
if (process.env.NODE_ENV === 'development' && process.env.PORT) {
  process.env.NEXTAUTH_URL = `http://localhost:${process.env.PORT}`;
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
          // Create a fresh Supabase client for this auth attempt
          const supabase = createSupabaseClient();
          
          const { data, error } = await supabase.auth.signInWithPassword({
            email: credentials.email,
            password: credentials.password,
          });

          if (error) {
            return null; // Returning null will trigger a failed login
          }

          if (data.user && data.session) {
            // Return user object with all necessary fields, including refresh details
            return {
              id: data.user.id,
              email: data.user.email || credentials.email, // Fallback to input email
              accessToken: data.session.access_token,
              refreshToken: data.session.refresh_token,
              accessTokenExpires: data.session.expires_at
                ? data.session.expires_at * 1000
                : Date.now() + 55 * 60 * 1000, // fallback ~55m
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
    maxAge: 90 * 24 * 60 * 60, // keep session alive for 90 days
    updateAge: 12 * 60 * 60, // extend JWT every 12 hours
  },

  // 3. JWT settings
  jwt: {
    secret: process.env.NEXTAUTH_SECRET,
    // you can optionally enable encryption:
    // encryption: true
  },

  // 4. Use default cookie names in production (no custom configuration needed)
  // NextAuth will handle cookie configuration automatically

  // 5. Callbacks with proper error handling
  callbacks: {
    async jwt({ token, user, account, trigger, session }) {
      
      // The `user` object is only passed on the first login.
      // We can add properties to the token here, and they will be available on subsequent requests.
      if (user) {
        // Store all necessary user data in the token
        token.id = user.id;
        token.email = user.email;
        token.accessToken = user.accessToken;
        token.refreshToken = user.refreshToken;
        token.accessTokenExpires = user.accessTokenExpires;
      }
      
      // Handle session updates
      if (trigger === 'update' && session) {
        token = { ...token, ...session };
      }
      
      // Proactively refresh Supabase access token if expiring in < 1 minute
      try {
        const willExpireSoon =
          token?.accessToken && token?.accessTokenExpires &&
          Date.now() > (token.accessTokenExpires - 60 * 1000);

        if (willExpireSoon && token.refreshToken) {
          const supabase = createClient(supabaseUrl, supabaseAnonKey, {
            auth: { persistSession: false, autoRefreshToken: false },
          });
          const { data, error } = await supabase.auth.refreshSession({
            refresh_token: token.refreshToken,
          });
          if (error) {
            console.error('NextAuth: Failed to refresh Supabase session', error);
          } else if (data?.session) {
            token.accessToken = data.session.access_token;
            token.refreshToken = data.session.refresh_token || token.refreshToken;
            token.accessTokenExpires = data.session.expires_at
              ? data.session.expires_at * 1000
              : Date.now() + 55 * 60 * 1000;
          }
        }
      } catch (err) {
        console.error('NextAuth: Unexpected error attempting token refresh', err);
      }

      return token;
    },
    async session({ session, token }) {
      
      // CRITICAL: Always return a properly structured session with user data from token
      if (token) {
        // Ensure we return a complete session structure without exposing tokens to the client
        return {
          user: {
            id: token.id || token.sub, // Use sub as fallback
            email: token.email || '',
          },
          // Do not expose access or refresh tokens to the client.
          expires: session?.expires || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
        };
      }
      
      // This should never happen if authentication is working
      console.error('Session callback - No token provided!');
      return {
        user: null,
        expires: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(),
      };
    },
    async redirect({ url, baseUrl }) {
      // Allows relative callback URLs
      if (url.startsWith("/")) return `${baseUrl}${url}`;
      // Allows callback URLs on the same origin
      else if (new URL(url).origin === baseUrl) return url;
      return baseUrl;
    },
  },

  pages: {
    signIn: '/login',
    error: '/login', // Redirect errors back to login page with error params
  },
  
  // 6. Environment-specific settings
  // When `.env.local` is pulled from Vercel it often contains the production
  // `NEXTAUTH_URL` (https://...). In local development (http://localhost) that
  // would make NextAuth default to secure cookies, which the browser will not
  // store over HTTP — resulting in a “login works but you stay on /login” loop.
  useSecureCookies: process.env.NODE_ENV === 'production',
  secret: process.env.NEXTAUTH_SECRET, // Explicitly set the secret
  debug: false, // Disable debug logging
  
  // 7. Trust the host in production (critical for Vercel deployments)
  trustHost: true,
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }; 
