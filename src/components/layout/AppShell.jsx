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
    'inline-flex items-center gap-2 rounded-full px-3 py-2 text-xs font-medium transition-all focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-indigo-400 sm:px-4 sm:text-sm',
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
  let gridClassName = 'flex flex-col gap-8 pb-10';
  if (sidebar && sideContent) {
    gridClassName += ' lg:grid lg:grid-cols-[300px_minmax(0,1fr)_360px] xl:grid-cols-[320px_minmax(0,1fr)_360px]';
  } else if (sidebar) {
    gridClassName += ' lg:grid lg:grid-cols-[300px_minmax(0,1fr)]';
  } else if (sideContent) {
    gridClassName += ' lg:grid lg:grid-cols-[minmax(0,1fr)_360px]';
  }

  return (
    <div className="relative min-h-screen pb-16 text-[#052a3b]">
      <div className="pointer-events-none absolute inset-0 opacity-80">
        <div className="absolute inset-x-0 top-0 h-64 bg-gradient-to-b from-[#0496c7]/35 via-transparent to-transparent blur-3xl sm:h-80 lg:h-96" />
        <div className="absolute left-1/2 top-24 h-48 w-48 -translate-x-1/2 rounded-full bg-[#6ad0ff]/35 blur-3xl sm:top-36 sm:h-72 sm:w-72" />
        <div className="absolute right-8 top-20 h-40 w-40 rounded-full bg-[#5bd2c1]/35 blur-[70px] sm:right-16 sm:top-28 sm:h-52 sm:w-52" />
      </div>

      <div className="relative">
        <header className="px-4 pt-4 sm:px-6 lg:px-10 sm:pt-6">
          <div className="backdrop-card flex flex-col gap-5 rounded-2xl border border-[#0496c7]/25 px-5 py-4 sm:gap-6 sm:px-6 sm:py-5 lg:flex-row lg:items-center lg:justify-between">
            <div>
              <p className="text-xs uppercase tracking-[0.35em] text-[#036586]/80">Planner</p>
              <h1 className="mt-2 text-2xl font-semibold text-[#052a3b] sm:text-3xl md:text-4xl">{title}</h1>
              {subtitle && <p className="mt-2 hidden max-w-3xl text-sm text-[#2f617a] sm:block md:text-base">{subtitle}</p>}
            </div>
            <div className="flex flex-col items-stretch gap-3 text-xs text-[#2f617a] sm:flex-row sm:items-center sm:text-sm">
              {user?.email && (
                <div className="glass-panel hidden items-center justify-center rounded-full px-4 py-2 text-xs uppercase tracking-wide text-[#036586]/80 sm:flex">
                  <span className="mr-2 inline-flex h-2 w-2 rounded-full bg-[#0e9f6e]" />
                  Signed in as {user.email}
                </div>
              )}
              <div className="flex flex-wrap items-center justify-end gap-2 sm:gap-3">
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
              <aside className="glass-panel hidden h-fit flex-col gap-6 rounded-3xl border border-[#0496c7]/25 p-6 text-[#052a3b] lg:flex">
                {sidebar}
              </aside>
            )}
            <section className="space-y-0 md:space-y-6">
              {sidebar && (
                <div className="glass-panel hidden flex-col gap-6 rounded-3xl border border-[#0496c7]/25 p-6 text-[#052a3b] md:flex lg:hidden">
                  {sidebar}
                </div>
              )}
              <div>{children}</div>
              {sideContent && (
                <div
                  className="glass-panel flex flex-col gap-6 rounded-3xl border border-[#0496c7]/25 p-6 text-[#052a3b] lg:hidden w-full sm:mx-auto sm:max-w-[28rem]"
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
