import NextAuth from 'next-auth';
import CredentialsProvider from 'next-auth/providers/credentials';
import { supabase } from '@/lib/supabaseClient';

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
          return null;
        }

        const { data, error } = await supabase.auth.signInWithPassword({
          email: credentials.email,
          password: credentials.password,
        });

        if (error) {
          console.error('Supabase login error:', error.message);
          return null; // Returning null will trigger a failed login
        }

        if (data.user) {
          // You can return a custom object here.
          // The `user` object will be encoded in the JWT.
          return {
            id: data.user.id,
            email: data.user.email,
            // You can add other properties from your user table here
            // e.g. name: data.user.user_metadata.full_name
          };
        }

        return null;
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
      name: `__Host-next-auth.session-token`,
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
        // token.role = user.role // Example of adding a role
      }
      return token;
    },
    async session({ session, token }) {
      // The session callback is called whenever a session is checked.
      // We can add properties to the session object here.
      if (session.user) {
        session.user.id = token.id;
        // session.user.role = token.role; // Pass role to session
      }
      return session;
    },
  },

  pages: {
    signIn: '/login',
    // error: '/auth/error', // You can specify a custom error page
  },
};

const handler = NextAuth(authOptions);

export { handler as GET, handler as POST }; 