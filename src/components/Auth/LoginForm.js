'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { signIn } from 'next-auth/react';

export default function LoginForm() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    try {
      const result = await signIn('credentials', {
        redirect: false, // Don't redirect automatically, handle it manually
        email,
        password,
      });

      if (result?.error) {
        // Log error for debugging in production
        console.error('Login error:', result.error);
        
        // Provide more specific error messages
        if (result.error === 'CredentialsSignin') {
          setError('Invalid email or password. Please try again.');
        } else if (result.error === 'Configuration') {
          setError('Server configuration error. Please contact support.');
        } else {
          setError(`Login failed: ${result.error}`);
        }
        setLoading(false);
        return;
      }

      if (result.ok) {
        // On successful login, redirect to the dashboard.
        router.push('/dashboard');
        // Or use router.refresh() if you want to stay on the same page
        // and let a server component handle the redirect logic.
      }
    } catch (err) {
      // Log the full error for debugging
      console.error('Unexpected login error:', err);
      setError('An unexpected error occurred. Please try again later.');
      setLoading(false);
    } finally {
      // Always reset loading state if we're still on the page
      setTimeout(() => {
        if (document.querySelector('[type="submit"]')) {
          setLoading(false);
        }
      }, 5000); // Timeout after 5 seconds as a safety measure
    }
  };

  return (
    <form onSubmit={handleLogin} className="space-y-4 w-full max-w-sm">
      <div>
        <label htmlFor="email" className="block text-sm font-medium text-gray-700">
          Email address
        </label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
      </div>

      <div>
        <label htmlFor="password" className="block text-sm font-medium text-gray-700">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="mt-1 block w-full px-3 py-2 border border-gray-300 rounded-md shadow-sm placeholder-gray-400 focus:outline-none focus:ring-indigo-500 focus:border-indigo-500 sm:text-sm"
        />
      </div>

      {error && <p className="text-sm text-red-600">{error}</p>}

      <div>
        <button
          type="submit"
          disabled={loading}
          className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-indigo-600 hover:bg-indigo-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-indigo-500 disabled:opacity-50"
        >
          {loading ? 'Logging in...' : 'Log in'}
        </button>
      </div>
    </form>
  );
} 