'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { CalendarIcon, CalendarDaysIcon, ViewColumnsIcon, FolderOpenIcon, LightBulbIcon } from '@heroicons/react/24/outline';
import { cn } from '@/lib/utils';

const tabs = [
  { name: 'Today', href: '/today', icon: CalendarIcon },
  { name: 'Plan', href: '/plan', icon: ViewColumnsIcon },
  { name: 'Calendar', href: '/calendar', icon: CalendarDaysIcon },
  { name: 'Projects', href: '/projects', icon: FolderOpenIcon },
  { name: 'Ideas', href: '/ideas', icon: LightBulbIcon },
];

export function TabBar() {
  const pathname = usePathname();

  return (
    <>
      {/* Desktop: horizontal tabs at top of content area */}
      <nav
        aria-label="Main tabs"
        className="hidden lg:flex items-center gap-1 border-b border-border bg-background px-4"
      >
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname?.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.name}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex items-center gap-2 px-3 py-3 text-sm font-medium border-b-2 transition-colors',
                isActive
                  ? 'border-primary text-primary'
                  : 'border-transparent text-muted-foreground hover:text-foreground hover:border-border'
              )}
            >
              <tab.icon className="h-4 w-4" />
              {tab.name}
            </Link>
          );
        })}
      </nav>

      {/* Mobile: fixed bottom tab bar */}
      <nav
        aria-label="Main tabs"
        className="fixed bottom-0 left-0 right-0 z-50 flex lg:hidden border-t border-border bg-background"
      >
        {tabs.map((tab) => {
          const isActive = pathname === tab.href || pathname?.startsWith(tab.href + '/');
          return (
            <Link
              key={tab.name}
              href={tab.href}
              aria-current={isActive ? 'page' : undefined}
              className={cn(
                'flex flex-1 flex-col items-center justify-center gap-1 py-2 text-xs font-medium transition-colors',
                isActive
                  ? 'text-primary'
                  : 'text-muted-foreground hover:text-foreground'
              )}
            >
              <tab.icon
                className={cn(
                  'h-5 w-5',
                  isActive ? 'text-primary' : 'text-muted-foreground'
                )}
              />
              {tab.name}
            </Link>
          );
        })}
      </nav>
    </>
  );
}
