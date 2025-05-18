'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext'; // Adjust path as necessary

export default function HomePage() {
  const { user, session, loading } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (!loading) { // Only redirect once loading is complete
      if (user && session) {
        router.replace('/dashboard');
      } else {
        router.replace('/login');
      }
    }
  }, [user, session, loading, router]);

  // Optional: Show a loading indicator while checking auth state
  if (loading) {
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
