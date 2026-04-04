'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { TabBar } from './TabBar';
import QuickCapture from '@/components/shared/QuickCapture';

const TAB_ROUTES = ['/today', '/plan', '/projects', '/ideas'];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login';
  const isTabRoute = TAB_ROUTES.some(
    (route) => pathname === route || pathname?.startsWith(route + '/')
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);

  useEffect(() => {
    setIsMobileMenuOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!isMobileMenuOpen) {
      return undefined;
    }

    const originalOverflow = document.body.style.overflow;
    const handleEscape = (event) => {
      if (event.key === 'Escape') {
        setIsMobileMenuOpen(false);
      }
    };

    document.body.style.overflow = 'hidden';
    window.addEventListener('keydown', handleEscape);

    return () => {
      document.body.style.overflow = originalOverflow;
      window.removeEventListener('keydown', handleEscape);
    };
  }, [isMobileMenuOpen]);

  if (isAuthRoute) {
    return (
      <div className="min-h-screen bg-background text-foreground font-sans antialiased">
        {children}
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background text-foreground font-sans antialiased">
      <Sidebar
        isMobileMenuOpen={isMobileMenuOpen}
        onCloseMobileMenu={() => setIsMobileMenuOpen(false)}
      />
      {isMobileMenuOpen && (
        <button
          type="button"
          aria-label="Close navigation menu"
          className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px] lg:hidden"
          onClick={() => setIsMobileMenuOpen(false)}
        />
      )}
      <Header
        isMobileMenuOpen={isMobileMenuOpen}
        onToggleMobileMenu={() => setIsMobileMenuOpen((open) => !open)}
      />
      <main className="min-h-screen pl-0 pt-14 lg:pl-[240px]">
        {isTabRoute && <TabBar />}
        <div className={isTabRoute ? 'w-full p-4 sm:p-6 pb-20 lg:pb-6' : 'w-full p-4 sm:p-6'}>
          {children}
        </div>
      </main>
      {isTabRoute && <QuickCapture />}
    </div>
  );
}
