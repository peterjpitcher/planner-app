'use client';

import LoginForm from '@/components/Auth/LoginForm';
import Link from 'next/link';
import { Suspense } from 'react';

function LoginContent() {
  return (
    <div className="flex flex-col items-center justify-center min-h-screen py-2 bg-gray-50">
      <div className="w-full max-w-md p-6 sm:p-8 space-y-8 bg-white shadow-md rounded-lg">
        <div className="text-center">
          <h1 className="text-3xl font-bold text-gray-900">Welcome Back!</h1>
          <p className="mt-2 text-sm text-gray-600">
            Log in to manage your projects and tasks.
          </p>
        </div>
        <LoginForm />
        {/* Optional: Link to sign-up or password reset if needed in the future */}
        {/* <div className="text-sm text-center">
          <p className="text-gray-600">Don't have an account? <Link href="/signup" className="font-medium text-indigo-600 hover:text-indigo-500">Sign up</Link></p>
        </div> */}
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex flex-col items-center justify-center min-h-screen py-2 bg-gray-50">
        <div className="w-full max-w-md p-8 space-y-8 bg-white shadow-md rounded-lg">
          <div className="text-center">
            <h1 className="text-3xl font-bold text-gray-900">Loading...</h1>
          </div>
        </div>
      </div>
    }>
      <LoginContent />
    </Suspense>
  );
} 