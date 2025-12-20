'use client';

function cn(...inputs) {
    return inputs.filter(Boolean).join(' ');
}

export function Card({ className, children, ...props }) {
    return (
        <div
            className={cn(
                "bg-[var(--surface-card)] backdrop-blur-sm rounded-[var(--radius-md)] border border-[var(--surface-border)] shadow-sm",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}

export function GlassPanel({ className, children, ...props }) {
    return (
        <div
            className={cn(
                "bg-[var(--surface-overlay)] backdrop-filter backdrop-blur-[var(--glass-blur)] rounded-[var(--radius-lg)] border border-[var(--surface-border)] shadow-[var(--shadow-soft)]",
                className
            )}
            {...props}
        >
            {children}
        </div>
    );
}
