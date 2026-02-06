'use client';

import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';

export default function AppShell({ children }) {
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login';

  if (isAuthRoute) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans antialiased">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <Sidebar />
      <Header />
      <main className="pl-[240px] pt-14 min-h-screen">
        <div className="w-full p-6">
          {children}
        </div>
      </main>
    </div>
  );
}
