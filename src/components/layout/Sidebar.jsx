'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { cn } from '@/lib/utils';
import {
    Home,
    ListTodo,
    LayoutGrid,
    Grid3X3,
    BookOpen,
    PieChart,
    LogOut
} from 'lucide-react';
import { signOut } from 'next-auth/react';

const navigation = [
    { name: 'Dashboard', href: '/dashboard', icon: Home },
    { name: 'Tasks', href: '/tasks', icon: ListTodo },
    { name: 'Prioritise', href: '/prioritise', icon: LayoutGrid },
    { name: 'Mind Sweep', href: '/capture', icon: Grid3X3 },
    { name: 'Journal', href: '/journal', icon: BookOpen },
    { name: 'Reports', href: '/completed-report', icon: PieChart },
];

export function Sidebar() {
    const pathname = usePathname();

    return (
        <div className="flex flex-col w-[240px] bg-[hsl(var(--sidebar-background))] border-r border-[hsl(var(--sidebar-border))] min-h-screen fixed left-0 top-0 z-40">
            {/* Brand Header */}
            <div className="flex items-center h-14 px-4 border-b border-[hsl(var(--sidebar-border))]">
                <div className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded bg-primary flex items-center justify-center">
                        <span className="text-primary-foreground font-bold text-xs">P</span>
                    </div>
                    <span className="text-[hsl(var(--sidebar-foreground))] font-semibold text-sm tracking-tight">
                        Planner 2.0
                    </span>
                </div>
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
                            className={cn(
                                "group flex items-center gap-3 px-3 py-2 rounded-md text-sm font-medium transition-all duration-150",
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
                    onClick={() => signOut()}
                    className="w-full flex items-center gap-3 px-3 py-2 mt-1 rounded-md text-sm font-medium text-[hsl(var(--danger))] hover:bg-[hsl(var(--sidebar-accent))] transition-all duration-150"
                >
                    <LogOut className="w-4 h-4" />
                    Sign out
                </button>
            </div>
        </div>
    );
}
