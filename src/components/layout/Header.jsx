'use client';

import { Search, Bell, Menu, X } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Header({ className, isMobileMenuOpen = false, onToggleMobileMenu }) {
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
                    <span className="text-foreground">Dashboard</span>
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
