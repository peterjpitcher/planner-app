'use client';

import Link from 'next/link';
import Button from '@/components/ui/Button';
import { GlassPanel } from '@/components/ui/Card';

function cn(...inputs) {
  return inputs.filter(Boolean).join(' ');
}

export default function AppShell({
  user,
  title,
  subtitle,
  actions = [],
  sidebar,
  children,
  sideContent,
}) {
  let gridClassName = 'flex flex-col gap-8 pb-10';
  if (sidebar && sideContent) {
    gridClassName += ' lg:grid lg:grid-cols-[300px_minmax(0,1fr)_360px] xl:grid-cols-[320px_minmax(0,1fr)_360px]';
  } else if (sidebar) {
    gridClassName += ' lg:grid lg:grid-cols-[300px_minmax(0,1fr)]';
  } else if (sideContent) {
    gridClassName += ' lg:grid lg:grid-cols-[minmax(0,1fr)_360px]';
  }

  // Map old variant names to new component variants
  const getActionVariant = (v) => {
    if (v === 'subtle') return 'outline';
    return v || 'primary';
  };

  return (
    <div className="relative min-h-screen pb-16 text-[var(--text-primary)]">
      <div className="relative">
        <header className="px-4 pt-4 sm:px-6 lg:px-8 sm:pt-6">
          <GlassPanel className="flex flex-col gap-5 px-4 py-4 sm:gap-6 sm:px-6 sm:py-6 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-[var(--brand-primary)] opacity-80">Planner</p>
              <h1 className="mt-2 text-2xl font-semibold text-[var(--text-primary)] sm:text-3xl md:text-4xl">{title}</h1>
              {subtitle && <p className="mt-2 hidden max-w-3xl text-sm text-[var(--text-secondary)] sm:block md:text-base">{subtitle}</p>}
            </div>
            <div className="flex flex-col items-stretch gap-3 text-xs text-[var(--text-secondary)] sm:flex-row sm:items-center sm:text-sm">
              {user?.email && (
                <div className="bg-[var(--surface-overlay)] border border-[var(--brand-primary)]/10 hidden items-center justify-center rounded-full px-4 py-2 text-xs uppercase tracking-wide text-[var(--text-secondary)] sm:flex backdrop-blur-sm">
                  <span className="mr-2 inline-flex h-2 w-2 rounded-full bg-[var(--success)]" />
                  Signed in as {user.email}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
                <div className="flex items-center gap-1 mr-4 border-r border-[var(--text-secondary)]/20 pr-4">
                  <Link
                    href="/dashboard"
                    className="px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--brand-primary)] transition-colors rounded-lg hover:bg-[var(--brand-primary)]/5"
                  >
                    Dashboard
                  </Link>
                  <Link
                    href="/journal"
                    className="px-3 py-1.5 text-sm font-medium text-[var(--text-secondary)] hover:text-[var(--brand-primary)] transition-colors rounded-lg hover:bg-[var(--brand-primary)]/5"
                  >
                    Journal
                  </Link>
                </div>
                {actions.map((action) => (
                  <Button
                    key={action.key ?? action.label}
                    href={action.href}
                    onClick={action.onClick}
                    icon={action.icon}
                    variant={getActionVariant(action.variant)}
                    size="sm"
                  >
                    {action.label}
                  </Button>
                ))}
              </div>
            </div>
          </GlassPanel>
        </header>

        <main className="relative z-10 px-4 pt-8 sm:px-6 lg:px-8">
          <div className={gridClassName}>
            {sidebar && (
              <GlassPanel className="hidden h-fit flex-col gap-6 p-6 lg:flex">
                {sidebar}
              </GlassPanel>
            )}
            <section className="space-y-0 md:space-y-6">
              {sidebar && (
                <GlassPanel className="hidden flex-col gap-6 p-6 md:flex lg:hidden">
                  {sidebar}
                </GlassPanel>
              )}
              <div>{children}</div>
              {sideContent && (
                <GlassPanel
                  className="flex flex-col gap-6 p-6 lg:hidden w-full sm:mx-auto sm:max-w-[28rem]"
                >
                  {sideContent}
                </GlassPanel>
              )}
            </section>
            {sideContent && (
              <GlassPanel className="hidden h-fit min-h-[400px] flex-col gap-6 p-6 lg:flex">
                {sideContent}
              </GlassPanel>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
