'use client';

import { useState, useRef, useEffect } from 'react';
import { Search, Bell, Menu, X, CalendarCheck } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Header({ className, isMobileMenuOpen = false, onToggleMobileMenu, onPlanTomorrow, onPlanWeek }) {
    const [showPlanMenu, setShowPlanMenu] = useState(false);
    const planMenuRef = useRef(null);

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
                {/* Search */}
                <div className="relative hidden sm:block">
                    <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search..."
                        className="h-9 w-44 rounded-md border-0 bg-secondary/50 pl-9 pr-4 text-sm transition-all placeholder:text-muted-foreground focus:bg-white focus:ring-1 focus:ring-ring md:w-64"
                    />
                </div>

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
                                Plan Tomorrow
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

                {/* Notifications */}
                <button className="relative flex h-10 w-10 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-secondary">
                    <Bell className="w-4 h-4" />
                    <span className="absolute top-2.5 right-2.5 w-1.5 h-1.5 rounded-full bg-primary border border-white"></span>
                </button>

                {/* User Avatar */}
                <div className="w-8 h-8 rounded bg-primary/10 flex items-center justify-center border border-primary/20">
                    <span className="text-xs font-bold text-primary">JD</span>
                </div>
            </div>
        </header>
    );
}
