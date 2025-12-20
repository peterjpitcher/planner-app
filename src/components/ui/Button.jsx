'use client';

import Link from 'next/link';

function cn(...inputs) {
    return inputs.filter(Boolean).join(' ');
}

export const buttonVariants = {
    primary: 'bg-[var(--brand-primary)] hover:bg-[#00628A] text-white shadow-lg shadow-[var(--brand-primary)]/25 border border-transparent',
    secondary: 'bg-[var(--surface-overlay)] hover:bg-white text-[var(--text-primary)] border border-[var(--brand-primary)]/20 backdrop-blur-md',
    ghost: 'bg-transparent hover:bg-[var(--brand-primary)]/10 text-[var(--text-secondary)] hover:text-[var(--brand-primary)]',
    destructive: 'bg-[var(--danger)] hover:bg-[#c03434] text-white shadow-lg shadow-[var(--danger)]/25',
    outline: 'bg-transparent border border-[var(--text-secondary)]/30 text-[var(--text-secondary)] hover:border-[var(--brand-primary)] hover:text-[var(--brand-primary)]'
};

export const buttonSizes = {
    sm: 'px-3 py-1.5 text-xs',
    md: 'px-4 py-2 text-sm',
    lg: 'px-6 py-3 text-base',
    icon: 'p-2'
};

export default function Button({
    className,
    variant = 'primary',
    size = 'md',
    isLoading = false,
    icon: Icon,
    children,
    href,
    onClick,
    disabled,
    type = 'button',
    ...props
}) {
    const baseStyles = 'inline-flex items-center justify-center gap-2 rounded-xl font-medium transition-all duration-200 outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-primary)] focus-visible:ring-offset-2 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98]';

    const variantStyles = buttonVariants[variant] || buttonVariants.primary;
    const sizeStyles = buttonSizes[size] || buttonSizes.md;

    const combinedClassName = cn(baseStyles, variantStyles, sizeStyles, className);

    if (href) {
        return (
            <Link
                href={href}
                className={combinedClassName}
                onClick={onClick}
                aria-disabled={disabled || isLoading}
                {...props}
            >
                {isLoading && (
                    <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                    </svg>
                )}
                {!isLoading && Icon && <Icon className="h-4 w-4" />}
                {children}
            </Link>
        );
    }

    return (
        <button
            type={type}
            className={combinedClassName}
            disabled={disabled || isLoading}
            onClick={onClick}
            {...props}
        >
            {isLoading && (
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            )}
            {!isLoading && Icon && <Icon className="h-4 w-4" />}
            {children}
        </button>
    );
}
