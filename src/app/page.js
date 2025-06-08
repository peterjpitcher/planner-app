'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useSession } from 'next-auth/react';

export default function HomePage() {
  const { data: session, status } = useSession();
  const router = useRouter();

  useEffect(() => {
    if (status !== 'loading') { // Only redirect once loading is complete
      if (status === 'authenticated') {
        router.replace('/dashboard');
      } else {
        router.replace('/login');
      }
    }
  }, [status, router]);

  // Optional: Show a loading indicator while checking auth state
  if (status === 'loading') {
    return (
      <div className="flex min-h-screen flex-col items-center justify-center p-24">
        <p>Loading...</p>
      </div>
    );
  }

  // This content will briefly show if not loading and before redirect, or if something goes wrong.
  // Ideally, redirects happen so fast this isn't seen, or a more robust loading state is used.
  return (
    <main className="flex min-h-screen flex-col items-center justify-center p-24">
      <h1 className="text-2xl font-bold">Planner App</h1>
      <p>Redirecting...</p>
    </main>
  );
}
