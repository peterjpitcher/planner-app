'use client';

import { useState, useRef, useEffect } from 'react';
import { useSession } from 'next-auth/react';
import { Menu, X, CalendarCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

/** Derive avatar initials from the signed-in user's name, falling back to their email. */
function getInitials(user) {
    if (!user) return '';
    const name = user.name?.trim();
    if (name) {
        const parts = name.split(/\s+/);
        return parts.length === 1
            ? parts[0].slice(0, 2).toUpperCase()
            : (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
    }
    const email = user.email?.trim();
    return email ? email.slice(0, 2).toUpperCase() : '';
}

export function Header({ className, isMobileMenuOpen = false, onToggleMobileMenu, onPlanTomorrow, onPlanWeek }) {
    const { data: session } = useSession();
    const [showPlanMenu, setShowPlanMenu] = useState(false);
    const planMenuRef = useRef(null);
    const initials = getInitials(session?.user);
    const identityLabel = session?.user?.name || session?.user?.email || 'Signed in user';

    useEffect(() => {
        if (!showPlanMenu) return;
        const handleClick = (e) => {
            if (planMenuRef.current && !planMenuRef.current.contains(e.target)) {
                setShowPlanMenu(false);
            }
        };
        document.addEventListener('mousedown', handleClick);
        return () => document.removeEventListener('mousedown', handleClick);
    }, [showPlanMenu]);
    return (
        <header className={cn("fixed top-0 right-0 left-0 z-30 flex h-14 items-center justify-between border-b border-border bg-white px-3 sm:px-4 lg:left-[240px]", className)}>
            {/* Left: Breadcrumbs / Page Title (Placeholder) */}
            <div className="flex items-center gap-4">
                <button
                    type="button"
                    className="inline-flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground lg:hidden"
                    onClick={onToggleMobileMenu}
                    aria-expanded={isMobileMenuOpen}
                    aria-controls="app-navigation"
                    aria-label={isMobileMenuOpen ? 'Close navigation menu' : 'Open navigation menu'}
                >
                    {isMobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
                </button>
                <div className="hidden md:flex items-center text-sm font-medium text-muted-foreground">
                    <span className="text-foreground">Planner</span>
                </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-2 sm:gap-3">
                {/* Plan button */}
                <div className="relative" ref={planMenuRef}>
                    <button
                        type="button"
                        onClick={() => setShowPlanMenu((v) => !v)}
                        className="flex h-10 items-center gap-1.5 rounded-md px-2.5 text-muted-foreground transition-colors hover:bg-secondary hover:text-foreground"
                        aria-label="Plan"
                    >
                        <CalendarCheck className="w-4 h-4" />
                        <span className="hidden text-sm font-medium sm:inline">Plan</span>
                    </button>
                    {showPlanMenu && (
                        <div className="absolute right-0 top-full mt-1 w-44 rounded-lg border border-border bg-card py-1 shadow-lg">
                            <button
                                type="button"
                                onClick={() => { setShowPlanMenu(false); onPlanTomorrow?.(); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                            >
                                Plan Today
                            </button>
                            <button
                                type="button"
                                onClick={() => { setShowPlanMenu(false); onPlanWeek?.(); }}
                                className="flex w-full items-center gap-2 px-3 py-2 text-sm text-foreground hover:bg-muted"
                            >
                                Plan This Week
                            </button>
                        </div>
                    )}
                </div>

                {/* User Avatar */}
                <div
                    className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center border border-primary/20"
                    role="img"
                    aria-label={`Signed in as ${identityLabel}`}
                    title={identityLabel}
                >
                    <span className="text-xs font-bold text-primary">{initials}</span>
                </div>
            </div>
        </header>
    );
}
