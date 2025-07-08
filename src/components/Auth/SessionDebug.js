'use client';

import { useSession } from 'next-auth/react';

export default function SessionDebug() {
  const { data: session, status } = useSession();
  
  // Only show in development
  if (process.env.NODE_ENV !== 'development') {
    return null;
  }
  
  return (
    <div className="fixed bottom-4 right-4 p-4 bg-gray-900 text-white rounded-lg shadow-lg max-w-md z-50">
      <h3 className="text-sm font-bold mb-2">Session Debug Info</h3>
      <div className="text-xs space-y-1">
        <p><strong>Status:</strong> {status}</p>
        <p><strong>Session:</strong> {session ? 'Exists' : 'None'}</p>
        {session && (
          <>
            <p><strong>User ID:</strong> {session.user?.id || 'Not set'}</p>
            <p><strong>Email:</strong> {session.user?.email || 'Not set'}</p>
            <p><strong>Expires:</strong> {session.expires || 'Not set'}</p>
          </>
        )}
      </div>
    </div>
  );
}