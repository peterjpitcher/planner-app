'use client';

import Link from 'next/link';

function cn(...inputs) {
  return inputs.filter(Boolean).join(' ');
}

const variantClassMap = {
  primary: 'bg-[#0496c7] hover:bg-[#0382ac] text-white shadow-lg shadow-[#0496c7]/35',
  secondary: 'bg-white hover:bg-white/90 text-[#0496c7] border border-[#0496c7]/30',
  subtle: 'bg-[#0496c7]/12 hover:bg-[#0496c7]/18 text-[#036586] border border-[#0496c7]/20',
  destructive: 'bg-red-500 hover:bg-red-400 text-white shadow-lg shadow-red-500/25',
};

function ActionButton({ action }) {
  const { label, onClick, href, icon: Icon, variant = 'primary' } = action;
  const className = cn(
    'inline-flex items-center gap-2 rounded-full px-4 py-2 text-sm font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400',
    variantClassMap[variant] || variantClassMap.primary
  );

  if (href) {
    return (
      <Link href={href} onClick={onClick} className={className}>
        {Icon && <Icon className="h-4 w-4" />}
        <span>{label}</span>
      </Link>
    );
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {Icon && <Icon className="h-4 w-4" />}
      <span>{label}</span>
    </button>
  );
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
  let gridClassName = 'grid gap-8 pb-10';
  if (sidebar && sideContent) {
    gridClassName += ' lg:grid-cols-[300px_minmax(0,1fr)_360px] xl:grid-cols-[320px_minmax(0,1fr)_360px]';
  } else if (sidebar) {
    gridClassName += ' lg:grid-cols-[300px_minmax(0,1fr)]';
  } else if (sideContent) {
    gridClassName += ' lg:grid-cols-[minmax(0,1fr)_360px]';
  }
  const hideMainContentOnSmallScreens = Boolean(sideContent);
  const collapseBreakpointClass = hideMainContentOnSmallScreens ? 'max-[480px]:hidden' : '';

  return (
    <div className="relative min-h-screen pb-16 text-[#052a3b]">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-96 bg-gradient-to-b from-[#0496c7]/35 via-transparent to-transparent blur-3xl" />
        <div className="absolute left-1/2 top-36 h-72 w-72 -translate-x-1/2 rounded-full bg-[#6ad0ff]/35 blur-3xl" />
        <div className="absolute right-16 top-28 h-52 w-52 rounded-full bg-[#5bd2c1]/35 blur-[70px]" />
      </div>

      <div className="relative">
        <header className={cn('px-6 pt-6 lg:px-10', collapseBreakpointClass)}>
          <div className="backdrop-card flex flex-col gap-6 rounded-2xl border border-[#0496c7]/25 px-6 py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-[#036586]/80">Planner</p>
              <h1 className="mt-2 text-3xl font-semibold text-[#052a3b] md:text-4xl">{title}</h1>
              {subtitle && <p className="mt-2 max-w-3xl text-sm text-[#2f617a] md:text-base">{subtitle}</p>}
            </div>
            <div className="flex flex-col items-stretch gap-3 text-sm text-[#2f617a] sm:flex-row sm:items-center">
              {user?.email && (
                <div className="glass-panel hidden items-center justify-center rounded-full px-4 py-2 text-xs uppercase tracking-wide text-[#036586]/80 sm:flex">
                  <span className="mr-2 inline-flex h-2 w-2 rounded-full bg-[#0e9f6e]" />
                  Signed in as {user.email}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-3">
                {actions.map((action) => (
                  <ActionButton key={action.key ?? action.label} action={action} />
                ))}
              </div>
            </div>
          </div>
        </header>

        <main className="relative z-10 px-6 pt-8 lg:px-10">
          <div className={gridClassName}>
            {sidebar && (
              <aside className={cn('glass-panel hidden h-fit flex-col gap-6 rounded-3xl border border-[#0496c7]/25 p-6 text-[#052a3b] lg:flex', collapseBreakpointClass)}>
                {sidebar}
              </aside>
            )}
            <section className="space-y-6">
              {sidebar && (
                <div className={cn(
                  'glass-panel flex flex-col gap-6 rounded-3xl border border-[#0496c7]/25 p-6 text-[#052a3b] lg:hidden',
                  collapseBreakpointClass
                )}>
                  {sidebar}
                </div>
              )}
              <div className={cn(hideMainContentOnSmallScreens && collapseBreakpointClass)}>
                {children}
              </div>
              {sideContent && (
                <div
                  className={cn(
                    'glass-panel flex flex-col gap-6 rounded-3xl border border-[#0496c7]/25 p-6 text-[#052a3b] lg:hidden',
                    'w-full sm:max-w-[28rem] sm:mx-auto'
                  )}
                >
                  {sideContent}
                </div>
              )}
            </section>
            {sideContent && (
              <aside className="glass-panel hidden h-fit min-h-[400px] flex-col gap-6 rounded-3xl border border-[#0496c7]/25 p-6 text-[#052a3b] lg:flex">
                {sideContent}
              </aside>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
