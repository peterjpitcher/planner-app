'use client';

function cn(...inputs) {
    return inputs.filter(Boolean).join(' ');
}

const baseInputStyles = "w-full rounded-xl border border-[var(--surface-border)] bg-white/50 backdrop-blur-sm px-4 py-2 text-[var(--text-primary)] placeholder-[var(--text-secondary)]/50 outline-none transition-all focus:border-[var(--brand-primary)] focus:bg-white focus:ring-2 focus:ring-[var(--brand-primary)]/20 disabled:opacity-50 disabled:cursor-not-allowed";

export function Input({ className, ...props }) {
    return (
        <input
            className={cn(baseInputStyles, "h-10", className)}
            {...props}
        />
    );
}

export function Textarea({ className, ...props }) {
    return (
        <textarea
            className={cn(baseInputStyles, "min-h-[100px] resize-y", className)}
            {...props}
        />
    );
}
