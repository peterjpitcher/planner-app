'use client';

import { SessionProvider } from 'next-auth/react';

export default function NextAuthProvider({ children, session }) {
  return (
    <SessionProvider 
      session={session} 
      refetchOnWindowFocus={false} // Disable auto-refetch on focus to prevent issues
      refetchInterval={5 * 60} // Refetch session every 5 minutes
    >
      {children}
    </SessionProvider>
  );
} 