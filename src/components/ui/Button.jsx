'use client';

import Link from 'next/link';
import { cn } from '@/lib/utils';

export const buttonVariants = {
    default: "bg-primary text-primary-foreground hover:bg-primary/90 shadow-sm",
    destructive: "bg-destructive text-destructive-foreground hover:bg-destructive/90 shadow-sm",
    outline: "border border-input bg-background shadow-sm hover:bg-accent hover:text-accent-foreground",
    secondary: "bg-secondary text-secondary-foreground hover:bg-secondary/80 shadow-sm",
    ghost: "hover:bg-accent hover:text-accent-foreground",
    link: "text-primary underline-offset-4 hover:underline",
};

export const buttonSizes = {
    default: "h-9 px-4 py-2",
    sm: "h-8 rounded-md px-3 text-xs",
    lg: "h-10 rounded-md px-8",
    icon: "h-9 w-9",
};

export function Button({
    className,
    variant = 'default',
    size = 'default',
    isLoading = false,
    icon: Icon,
    children,
    href,
    onClick,
    disabled,
    type = 'button',
    ...props
}) {
    // Map old 'primary' to 'default' for backward compatibility during migration
    const normalizedVariant = variant === 'primary' ? 'default' : variant;

    const baseStyles = "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50";

    const variantStyles = buttonVariants[normalizedVariant] || buttonVariants.default;
    const sizeStyles = buttonSizes[size] || buttonSizes.default;

    const combinedClassName = cn(baseStyles, variantStyles, sizeStyles, className);

    const content = (
        <>
            {isLoading && (
                <svg className="animate-spin -ml-1 mr-2 h-4 w-4 text-current" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                    <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                    <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                </svg>
            )}
            {!isLoading && Icon && <Icon className="h-4 w-4" />}
            {children}
        </>
    );

    if (href) {
        return (
            <Link
                href={href}
                className={combinedClassName}
                onClick={onClick}
                aria-disabled={disabled || isLoading}
                {...props}
            >
                {content}
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
            {content}
        </button>
    );
}
