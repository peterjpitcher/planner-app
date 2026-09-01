// src/lib/supabaseBrowser.js
//
// A browser Supabase client, used for exactly one thing: sending an attachment
// to a signed upload URL.
//
// This app has no other browser-side Supabase usage. Auth is NextAuth and every
// read and write goes through an API route with the service-role client, which
// is the arrangement the whole security model rests on. This file does not
// change that, and it must not become a general-purpose client.
//
// Why it is safe:
//
//   * The bucket is private and has NO storage policies for anon or
//     authenticated. The anon key therefore grants no access to it at all.
//   * What authorises the upload is the one-time token in the signed URL, which
//     the server mints only after checking the NextAuth session, verifying the
//     caller owns the parent row, and creating the pending attachment row that
//     fixes the destination path.
//   * The token is scoped to that single path and expires.
//
// So the anon key here is transport, not authority. The alternative, sending
// the file through a route, is not available: Vercel caps request bodies at
// 4.5 MB and returns 413 above it, and that cannot be raised in vercel.json.

import { createClient } from '@supabase/supabase-js';

let browserClient = null;

export function getSupabaseBrowserClient() {
  if (browserClient) return browserClient;

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

  if (!supabaseUrl || !anonKey) {
    throw new Error('Supabase browser client is not configured');
  }

  browserClient = createClient(supabaseUrl, anonKey, {
    auth: {
      // There is no Supabase session to persist: the user is authenticated by
      // NextAuth. Persisting one would put a second, meaningless session in
      // local storage.
      persistSession: false,
      autoRefreshToken: false,
    },
  });

  return browserClient;
}
