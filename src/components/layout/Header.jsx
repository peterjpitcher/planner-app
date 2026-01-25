'use client';

import { Search, Bell, Menu } from 'lucide-react';
import { cn } from '@/lib/utils';

export function Header({ className }) {
    return (
        <header className={cn("h-14 bg-white border-b border-border flex items-center justify-between px-4 fixed top-0 right-0 left-[240px] z-30", className)}>
            {/* Left: Breadcrumbs / Page Title (Placeholder) */}
            <div className="flex items-center gap-4">
                <button className="lg:hidden p-2 -ml-2 text-muted-foreground hover:text-foreground">
                    <Menu className="w-5 h-5" />
                </button>
                <div className="hidden md:flex items-center text-sm font-medium text-muted-foreground">
                    <span className="text-foreground">Dashboard</span>
                </div>
            </div>

            {/* Right: Actions */}
            <div className="flex items-center gap-3">
                {/* Search */}
                <div className="relative">
                    <Search className="absolute left-2.5 top-2.5 w-4 h-4 text-muted-foreground" />
                    <input
                        type="text"
                        placeholder="Search..."
                        className="h-9 w-64 pl-9 pr-4 rounded-md bg-secondary/50 border-0 text-sm focus:ring-1 focus:ring-ring focus:bg-white transition-all placeholder:text-muted-foreground"
                    />
                </div>

                {/* Notifications */}
                <button className="w-9 h-9 flex items-center justify-center rounded-md hover:bg-secondary text-muted-foreground transition-colors relative">
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
