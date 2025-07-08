import './globals.css'
import NextAuthProvider from '@/components/NextAuthProvider' // Adjust path as necessary
import { TargetProjectProvider } from '@/contexts/TargetProjectContext'
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
            <TargetProjectProvider>
              {children}
            </TargetProjectProvider>
          </NextAuthProvider>
        </ErrorBoundary>
      </body>
    </html>
  )
}
