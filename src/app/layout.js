import './globals.css'
import { AuthProvider } from '@/contexts/AuthContext' // Adjust path as necessary

export const metadata = {
  title: 'Planner App',
  description: 'A simple productivity tool for projects and tasks',
}

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>
        <AuthProvider>
          {children}
        </AuthProvider>
      </body>
    </html>
  )
}
