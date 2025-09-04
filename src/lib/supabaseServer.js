import { createClient } from '@supabase/supabase-js';

/**
 * Creates a server-side Supabase client with proper authentication
 * @param {string} accessToken - The user's access token from NextAuth session
 * @returns {Object} Configured Supabase client
 */
export function getSupabaseServer(accessToken) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  }

  // Prefer service key for server-side operations
  const supabaseKey = supabaseServiceKey || supabaseAnonKey;
  
  if (!supabaseKey) {
    throw new Error('Missing Supabase key (SUPABASE_SERVICE_KEY or NEXT_PUBLIC_SUPABASE_ANON_KEY)');
  }

  // Configure client options
  const options = {
    auth: {
      persistSession: false, // Server-side should never persist sessions
      autoRefreshToken: false, // Server-side should not auto-refresh tokens
    }
  };

  // If using anon key and we have an access token, set the authorization header
  if (!supabaseServiceKey && accessToken) {
    options.global = {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    };
  }

  return createClient(supabaseUrl, supabaseKey, options);
}

/**
 * Helper function to extract access token from request headers
 * @param {Request} request - The incoming request object
 * @returns {string|null} The access token if found
 */
export function getAccessTokenFromRequest(request) {
  const authHeader = request.headers.get('authorization');
  if (authHeader && authHeader.startsWith('Bearer ')) {
    return authHeader.slice(7);
  }
  return null;
}