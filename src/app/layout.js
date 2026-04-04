import './globals.css'
import NextAuthProvider from '@/components/NextAuthProvider' // Adjust path as necessary
import { SupabaseProvider } from '@/contexts/SupabaseContext'
import ErrorBoundary from '@/components/ErrorBoundary'
import AppShell from '@/components/layout/AppShell'

export const metadata = {
  title: 'Planner App',
  description: 'A simple productivity tool for projects and tasks',
}

import { Inter } from 'next/font/google'

const inter = Inter({ subsets: ['latin'] })

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body className={inter.className}>
        <ErrorBoundary>
          <NextAuthProvider>
            <SupabaseProvider>
              <AppShell>
                {children}
              </AppShell>
            </SupabaseProvider>
          </NextAuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
