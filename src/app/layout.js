import './globals.css'
import NextAuthProvider from '@/components/NextAuthProvider' // Adjust path as necessary
import { TargetProjectProvider } from '@/contexts/TargetProjectContext'

export const metadata = {
  title: 'Planner App',
  description: 'A simple productivity tool for projects and tasks',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <NextAuthProvider>
          <TargetProjectProvider>
            {children}
          </TargetProjectProvider>
        </NextAuthProvider>
      </body>
    </html>
  )
}
