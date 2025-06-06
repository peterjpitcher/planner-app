'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabaseClient'; // Adjust path as necessary

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    setLoading(true);

    // Function to fetch the current session
    const getInitialSession = async () => {
      const { data: { session: initialSession }, error } = await supabase.auth.getSession();
      if (error) {
        console.error('Error getting initial session:', error);
      }
      setSession(initialSession);
      setUser(initialSession?.user ?? null);
      // Set loading to false here initially, onAuthStateChange will handle subsequent updates
      // setLoading(false); // We'll set loading to false after the listener is also processed
    };

    getInitialSession(); // Call it once on mount

    const { data: authListener } = supabase.auth.onAuthStateChange(
      async (_event, currentSession) => {
        // This listener will also fire initially,
        // and then for any subsequent auth events
        setSession(currentSession);
        setUser(currentSession?.user ?? null);
        setLoading(false); // Loading is false once we have definite auth state
      }
    );

    return () => {
      authListener?.subscription?.unsubscribe();
    };
  }, []);

  // We will add login, logout, etc. functions here later
  const value = {
    session,
    user,
    signOut: () => supabase.auth.signOut(),
    // signIn: async (email, password) => { /* Supabase login logic */ }, // Placeholder
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
} 