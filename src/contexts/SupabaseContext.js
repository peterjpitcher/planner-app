'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { useSession } from 'next-auth/react';
import { createClient } from '@supabase/supabase-js';

const SupabaseContext = createContext(null);

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

// Create a single instance
let supabaseInstance = null;

function getSupabaseInstance() {
  if (!supabaseInstance && supabaseUrl && supabaseAnonKey) {
    supabaseInstance = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      }
    });
  }
  return supabaseInstance;
}

export function SupabaseProvider({ children }) {
  const { data: session } = useSession();
  const [supabase] = useState(() => getSupabaseInstance());

  useEffect(() => {
    // Note: Access token is no longer exposed to client for security
    // All authenticated requests should go through API routes
    // This context now provides unauthenticated Supabase client only
    if (supabase && session) {
      console.warn('Direct Supabase calls from client should be migrated to API routes for security');
    }
  }, [session, supabase]);

  if (!supabase) {
    throw new Error('Missing Supabase environment variables');
  }

  return (
    <SupabaseContext.Provider value={supabase}>
      {children}
    </SupabaseContext.Provider>
  );
}

export function useSupabase() {
  const context = useContext(SupabaseContext);
  if (!context) {
    throw new Error('useSupabase must be used within SupabaseProvider');
  }
  return context;
}