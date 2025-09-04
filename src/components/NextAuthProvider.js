'use client';

import { SessionProvider } from 'next-auth/react';

export default function NextAuthProvider({ children, session }) {
  return (
    <SessionProvider 
      session={session} 
      refetchOnWindowFocus={false} // Disable auto-refetch on focus to prevent session flips
      refetchInterval={0} // Disable periodic refetch to prevent unexpected logouts
    >
      {children}
    </SessionProvider>
  );
} 