import { createClient } from '@supabase/supabase-js';

/**
 * Creates a server-side Supabase client with proper authentication
 * @param {string} accessToken - The user's access token from NextAuth session
 * @returns {Object} Configured Supabase client
 */
export function getSupabaseServer(accessToken, options = {}) {
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
  const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { useServiceRole = false } = options;

  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  }

  // Prefer anon key unless service role is explicitly requested
  const supabaseKey = useServiceRole ? supabaseServiceKey : supabaseAnonKey;
  
  if (!supabaseKey) {
    throw new Error(useServiceRole
      ? 'Missing SUPABASE_SERVICE_KEY environment variable'
      : 'Missing NEXT_PUBLIC_SUPABASE_ANON_KEY environment variable');
  }

  // Configure client options
  const clientOptions = {
    auth: {
      persistSession: false, // Server-side should never persist sessions
      autoRefreshToken: false, // Server-side should not auto-refresh tokens
    }
  };

  // If using anon key and we have an access token, set the authorization header
  if (!useServiceRole && accessToken) {
    clientOptions.global = {
      headers: {
        Authorization: `Bearer ${accessToken}`
      }
    };
  }

  return createClient(supabaseUrl, supabaseKey, clientOptions);
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
