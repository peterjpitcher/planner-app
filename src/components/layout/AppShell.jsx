'use client';

import { useEffect, useState } from 'react';
import { usePathname } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { TabBar } from './TabBar';
import QuickCapture from '@/components/shared/QuickCapture';
import { usePlanningPrompt } from '@/hooks/usePlanningPrompt';
import PlanningModal from '@/components/planning/PlanningModal';
import PlanningBanner from '@/components/planning/PlanningBanner';

const TAB_ROUTES = ['/today', '/plan', '/projects', '/ideas', '/calendar'];
const PLANNING_BANNER_ROUTES = ['/today', '/plan', '/calendar'];

export default function AppShell({ children }) {
  const pathname = usePathname();
  const isAuthRoute = pathname === '/login';
  const isTabRoute = TAB_ROUTES.some(
    (route) => pathname === route || pathname?.startsWith(route + '/')
  );
  const showPlanningBanner = PLANNING_BANNER_ROUTES.some(
    (route) => pathname === route || pathname?.startsWith(route + '/')
  );
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const planning = usePlanningPrompt();

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
        onPlanTomorrow={() => planning.triggerManualPlanning('daily')}
        onPlanWeek={() => planning.triggerManualPlanning('weekly')}
      />
      <main className="min-h-screen pl-0 pt-14 lg:pl-[240px]">
        {isTabRoute && <TabBar />}
        {showPlanningBanner && planning.isActive && !planning.isLoading && (
          <div className="mb-4 px-4 sm:px-6 pt-4">
            <PlanningBanner
              isPlanned={planning.isPlanned}
              hasNewTasks={planning.hasNewTasks}
              totalCandidates={planning.totalCandidates}
              windowType={planning.windowType}
              onPlanNow={planning.openModal}
            />
          </div>
        )}
        <div className={isTabRoute ? 'w-full p-4 sm:p-6 pb-20 lg:pb-6' : 'w-full p-4 sm:p-6'}>
          {children}
        </div>
      </main>
      {(planning.isActive || planning.showModal) && !planning.isLoading && (
        <PlanningModal
          isOpen={planning.showModal}
          onClose={planning.closeModal}
          onComplete={planning.onPlanningComplete}
          windowType={planning.windowType}
          windowDate={planning.windowDate}
          tasks={planning.tasks}
          isManual={planning.isManual}
        />
      )}
      {isTabRoute && <QuickCapture />}
    </div>
  );
}
