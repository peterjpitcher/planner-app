import './globals.css'
import NextAuthProvider from '@/components/NextAuthProvider' // Adjust path as necessary
import { TargetProjectProvider } from '@/contexts/TargetProjectContext'
import { SupabaseProvider } from '@/contexts/SupabaseContext'
import ErrorBoundary from '@/components/ErrorBoundary'

export const metadata = {
  title: 'Planner App',
  description: 'A simple productivity tool for projects and tasks',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <ErrorBoundary>
          <NextAuthProvider>
            <SupabaseProvider>
              <TargetProjectProvider>
                {children}
              </TargetProjectProvider>
            </SupabaseProvider>
          </NextAuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
