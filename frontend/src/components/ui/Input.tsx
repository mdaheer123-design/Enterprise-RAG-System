/**
 * Knowledge AI — Input Primitive
 */
import { forwardRef, type InputHTMLAttributes } from 'react';
import { cn } from '@/lib/utils';

interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  error?: boolean;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, error, ...props }, ref) => {
    return (
      <input
        ref={ref}
        className={cn(
          'h-8 w-full rounded-[var(--radius)] border bg-surface px-3',
          'text-[13px] text-fg placeholder:text-fg-faint',
          'transition-colors duration-[var(--duration-fast)]',
          'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent focus-visible:ring-offset-0',
          'disabled:opacity-50 disabled:cursor-not-allowed',
          error
            ? 'border-danger focus-visible:ring-danger'
            : 'border-border hover:border-fg-faint',
          className,
        )}
        {...props}
      />
    );
  },
);
Input.displayName = 'Input';
