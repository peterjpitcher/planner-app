'use client';

import { SessionProvider } from 'next-auth/react';

export default function NextAuthProvider({ children, session }) {
  return (
    <SessionProvider 
      session={session} 
      refetchOnWindowFocus={true}
      refetchInterval={5 * 60} // Refetch session every 5 minutes
    >
      {children}
    </SessionProvider>
  );
} 