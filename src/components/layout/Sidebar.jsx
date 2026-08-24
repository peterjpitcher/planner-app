'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
    CalendarCheck,
    Calendar,
    Clock,
    Columns3,
    FolderOpen,
    Lightbulb,
    PieChart,
    Plug,
    LogOut,
    X
} from 'lucide-react';
import { signOut } from 'next-auth/react';

const navigation = [
    { name: 'Today', href: '/today', icon: CalendarCheck },
    { name: 'Plan', href: '/plan', icon: Columns3 },
    { name: 'Calendar', href: '/calendar', icon: Calendar },
    { name: 'Projects', href: '/projects', icon: FolderOpen },
    { name: 'Ideas', href: '/ideas', icon: Lightbulb },
    { name: 'Reports', href: '/completed-report', icon: PieChart },
    { name: 'Integrations', href: '/settings/integrations', icon: Plug },
    { name: 'Planning', href: '/settings/planning', icon: Clock },
];

// Tailwind's lg breakpoint. The drawer is permanently visible above it and a
// slide-away panel below it, and only the panel should leave the tab order.
const DESKTOP_QUERY = '(min-width: 1024px)';

function useIsDesktop() {
    // Defaults to true so the nav is never inert during SSR or the first paint.
    // Wrongly inerting a visible sidebar is far worse than a frame of the old
    // behaviour on mobile.
    const [isDesktop, setIsDesktop] = useState(true);

    useEffect(() => {
        if (typeof window === 'undefined' || !window.matchMedia) return undefined;
        const query = window.matchMedia(DESKTOP_QUERY);
        const sync = () => setIsDesktop(query.matches);
        sync();
        query.addEventListener('change', sync);
        return () => query.removeEventListener('change', sync);
    }, []);

    return isDesktop;
}

export function Sidebar({ isMobileMenuOpen = false, onCloseMobileMenu }) {
    const pathname = usePathname();
    const isDesktop = useIsDesktop();

    return (
        <aside
            id="app-navigation"
            aria-label="Main navigation"
            // The closed drawer is hidden by transform alone, which does not
            // remove it from the tab order or the accessibility tree: a keyboard
            // user tabbed through ten invisible controls at the top of every
            // mobile page, and a screen reader read the nav twice (once here,
            // once in the bottom TabBar). inert is ignored at desktop widths,
            // where the sidebar is genuinely visible.
            inert={!isMobileMenuOpen && !isDesktop ? '' : undefined}
            className={cn(
                // z-[60] on mobile: the fixed bottom TabBar is z-50 and renders later in the
                // tree, so at z-50 it painted over the drawer footer and swallowed taps on
                // Sign out. Desktop drops back to z-40, below the header.
                "fixed left-0 top-0 z-[60] flex min-h-screen w-[280px] max-w-[85vw] flex-col border-r border-[hsl(var(--sidebar-border))] bg-[hsl(var(--sidebar-background))] transition-transform duration-200 ease-out lg:z-40 lg:w-[240px] lg:max-w-none",
                isMobileMenuOpen ? "translate-x-0" : "-translate-x-full lg:translate-x-0"
            )}
        >
            {/* Brand Header */}
            <div className="flex h-14 items-center justify-between border-b border-[hsl(var(--sidebar-border))] px-4">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
                        <span className="text-primary-foreground font-bold text-xs">P</span>
                    </div>
                    <span className="text-[hsl(var(--sidebar-foreground))] font-semibold text-sm tracking-tight">
                        Planner 2.0
                    </span>
                </div>
                <button
                    type="button"
                    onClick={onCloseMobileMenu}
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md text-[hsl(var(--sidebar-foreground))] opacity-80 hover:bg-[hsl(var(--sidebar-accent))] hover:opacity-100 lg:hidden"
                    aria-label="Close navigation menu"
                >
                    <X className="h-5 w-5" />
                </button>
            </div>

            {/* Main Navigation */}
            <div className="flex-1 flex flex-col gap-1 p-2 overflow-y-auto">
                <div className="px-2 py-1.5 text-xs font-semibold text-[hsl(var(--sidebar-foreground))] opacity-50 uppercase tracking-wider">
                    Workspace
                </div>
                {navigation.map((item) => {
                    const isActive = pathname === item.href || (item.href !== '/' && pathname?.startsWith(item.href));
                    return (
                        <Link
                            key={item.name}
                            href={item.href}
                            onClick={onCloseMobileMenu}
                            className={cn(
                                "group flex min-h-11 items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-all duration-150",
                                isActive
                                    ? "bg-[hsl(var(--sidebar-accent))] text-white"
                                    : "text-[hsl(var(--sidebar-foreground))] hover:bg-[hsl(var(--sidebar-accent))] hover:text-white"
                            )}
                        >
                            <item.icon className={cn("w-4 h-4", isActive ? "text-primary" : "text-gray-400 group-hover:text-white")} />
                            {item.name}
                        </Link>
                    );
                })}
            </div>

            {/* Footer Actions */}
            <div className="p-2 border-t border-[hsl(var(--sidebar-border))]">
                <button
                    onClick={() => {
                        onCloseMobileMenu?.();
                        signOut();
                    }}
                    // --danger is not defined anywhere, so this rendered in the inherited
                    // foreground colour, which is exactly the sidebar background: an
                    // invisible button, and the only sign-out control in the app.
                    className="mt-1 flex min-h-11 w-full items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-[hsl(var(--sidebar-foreground))] transition-all duration-150 hover:bg-[hsl(var(--destructive))] hover:text-[hsl(var(--destructive-foreground))] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[hsl(var(--sidebar-ring))]"
                >
                    <LogOut className="w-4 h-4" />
                    Sign out
                </button>
            </div>
        </aside>
    );
}
