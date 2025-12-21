import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl) {
  console.error("Missing env.NEXT_PUBLIC_SUPABASE_URL");
  throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_URL");
}

if (!supabaseAnonKey) {
  console.error("Missing env.NEXT_PUBLIC_SUPABASE_ANON_KEY");
  throw new Error("Missing env.NEXT_PUBLIC_SUPABASE_ANON_KEY");
}

console.log('Supabase Client initialized with URL:', supabaseUrl);

const createSupabaseClient = () => createClient(supabaseUrl, supabaseAnonKey);

// Use a global variable to store the client in development to prevent multiple instances during HMR
const client = global.supabase ?? createSupabaseClient();

if (process.env.NODE_ENV !== 'production') {
  global.supabase = client;
}

export const supabase = client; 