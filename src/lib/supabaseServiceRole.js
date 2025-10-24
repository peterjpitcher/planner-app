import { createClient } from '@supabase/supabase-js';

let serviceClient = null;

export function getSupabaseServiceRole() {
  if (serviceClient) {
    return serviceClient;
  }

  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_KEY;

  if (!supabaseUrl) {
    throw new Error('Missing NEXT_PUBLIC_SUPABASE_URL environment variable');
  }

  if (!serviceKey) {
    throw new Error('Missing SUPABASE_SERVICE_KEY environment variable');
  }

  serviceClient = createClient(supabaseUrl, serviceKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false
    }
  });

  return serviceClient;
}
