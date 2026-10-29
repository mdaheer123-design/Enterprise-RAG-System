/**
 * Knowledge AI — Button Primitive
 * Restyled from defaults with token-driven design.
 */
import { forwardRef, type ButtonHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline';
type ButtonSize = 'sm' | 'md' | 'lg' | 'icon';

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
}

const variantStyles: Record<ButtonVariant, string> = {
  primary:
    'bg-accent text-accent-fg hover:bg-accent/90 active:bg-accent/80',
  secondary:
    'bg-surface-raised text-fg border border-border hover:bg-surface-sunken active:bg-surface-sunken/80',
  ghost:
    'text-fg-muted hover:text-fg hover:bg-surface-raised active:bg-surface-sunken',
  danger:
    'bg-danger text-white hover:bg-danger/90 active:bg-danger/80',
  outline:
    'border border-border text-fg hover:bg-surface-raised active:bg-surface-sunken',
};

const sizeStyles: Record<ButtonSize, string> = {
  sm: 'h-7 px-2.5 text-[12px] gap-1.5 rounded-[var(--radius-sm)]',
  md: 'h-8 px-3 text-[13px] gap-2 rounded-[var(--radius)]',
  lg: 'h-9 px-4 text-[14px] gap-2 rounded-[var(--radius)]',
  icon: 'h-8 w-8 rounded-[var(--radius)] flex items-center justify-center p-0',
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant = 'secondary', size = 'md', disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={cn(
          'inline-flex items-center justify-center font-medium transition-colors',
          'duration-[var(--duration-fast)] ease-[var(--ease-out)]',
          'focus-visible:outline-2 focus-visible:outline-accent focus-visible:outline-offset-2',
          'disabled:opacity-50 disabled:pointer-events-none',
          'select-none whitespace-nowrap',
          variantStyles[variant],
          sizeStyles[size],
          className,
        )}
        disabled={disabled}
        {...props}
      />
    );
  },
);
Button.displayName = 'Button';
