/**
 * Knowledge AI — Shared Components
 * Reusable building blocks used across all features.
 */
import { type ReactNode } from 'react';
import {
  FileText,
  FileSpreadsheet,
  File,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

// ── Page Header ─────────────────────────────────────────────────
interface PageHeaderProps {
  title: string;
  subtitle?: string;
  actions?: ReactNode;
  serif?: boolean;
}

export function PageHeader({ title, subtitle, actions, serif = true }: PageHeaderProps) {
  return (
    <div className="flex items-start justify-between gap-4 mb-6">
      <div className="min-w-0">
        <h1
          className={cn(
            'text-[28px] tracking-tight leading-tight text-fg',
            serif ? 'font-serif' : 'font-sans font-semibold',
          )}
          style={serif ? { fontFamily: 'var(--font-serif)' } : undefined}
        >
          {title}
        </h1>
        {subtitle && (
          <p
            className="mt-1 text-[13px] text-fg-muted font-mono"
            style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
          >
            {subtitle}
          </p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2 shrink-0">{actions}</div>}
    </div>
  );
}

// ── Empty State ─────────────────────────────────────────────────
interface EmptyStateProps {
  title: string;
  description: string;
  action?: ReactNode;
}

export function EmptyState({ title, description, action }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <h2
        className="text-[20px] text-fg tracking-tight"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        {title}
      </h2>
      <p className="mt-2 text-[13px] text-fg-muted max-w-[400px] leading-relaxed">
        {description}
      </p>
      {action && <div className="mt-5">{action}</div>}
    </div>
  );
}

// ── Error State ─────────────────────────────────────────────────
interface ErrorStateProps {
  message: string;
  detail?: string;
  onRetry?: () => void;
}

export function ErrorState({ message, detail, onRetry }: ErrorStateProps) {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="w-8 h-8 rounded-full bg-danger-subtle flex items-center justify-center mb-3">
        <span className="text-danger text-[14px] font-medium">!</span>
      </div>
      <h2 className="text-[14px] text-fg font-medium">{message}</h2>
      {detail && (
        <details className="mt-2 text-[12px] text-fg-faint">
          <summary className="cursor-pointer hover:text-fg-muted">Technical details</summary>
          <p className="mt-1 font-mono text-[11px]" style={{ fontFamily: 'var(--font-mono)' }}>
            {detail}
          </p>
        </details>
      )}
      {onRetry && (
        <button
          onClick={onRetry}
          className="mt-4 text-[13px] text-accent hover:underline"
        >
          Try again
        </button>
      )}
    </div>
  );
}

// ── Kbd (keyboard shortcut display) ─────────────────────────────
interface KbdProps {
  children: ReactNode;
}

export function Kbd({ children }: KbdProps) {
  return (
    <kbd
      className={cn(
        'inline-flex items-center justify-center min-w-[20px] h-5 px-1.5',
        'rounded-[3px] border border-border bg-surface-sunken',
        'text-[11px] text-fg-faint leading-none',
      )}
      style={{ fontFamily: 'var(--font-mono)' }}
    >
      {children}
    </kbd>
  );
}

// ── File Type Glyph ─────────────────────────────────────────────
const fileIconMap: Record<string, LucideIcon> = {
  pdf: FileText,
  docx: FileText,
  txt: File,
  csv: FileSpreadsheet,
  xlsx: FileSpreadsheet,
};

const fileColorMap: Record<string, string> = {
  pdf: 'text-danger',
  docx: 'text-info',
  txt: 'text-fg-muted',
  csv: 'text-success',
  xlsx: 'text-success',
};

interface FileGlyphProps {
  type: string;
  size?: number;
  className?: string;
}

export function FileGlyph({ type, size = 16, className }: FileGlyphProps) {
  const Icon = fileIconMap[type.toLowerCase()] ?? File;
  const colorClass = fileColorMap[type.toLowerCase()] ?? 'text-fg-muted';

  return <Icon size={size} strokeWidth={1.5} className={cn(colorClass, className)} />;
}

// ── Score Bar ───────────────────────────────────────────────────
interface ScoreBarProps {
  score: number; // 0–1
  className?: string;
}

export function ScoreBar({ score, className }: ScoreBarProps) {
  const pct = Math.round(score * 100);
  return (
    <div className={cn('flex items-center gap-2', className)}>
      <div className="w-12 h-1.5 rounded-full bg-border overflow-hidden">
        <div
          className="h-full rounded-full bg-accent transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
      <span
        className="text-[11px] text-fg-faint"
        style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
      >
        {score.toFixed(2)}
      </span>
    </div>
  );
}

// ── Status Dot ──────────────────────────────────────────────────
interface StatusDotProps {
  status: 'online' | 'offline' | 'busy';
  label?: string;
}

const dotColors: Record<string, string> = {
  online: 'bg-success',
  offline: 'bg-fg-faint',
  busy: 'bg-warning',
};

export function StatusDot({ status, label }: StatusDotProps) {
  return (
    <div className="flex items-center gap-1.5">
      <div className={cn('w-1.5 h-1.5 rounded-full', dotColors[status])} />
      {label && <span className="text-[11px] text-fg-faint">{label}</span>}
    </div>
  );
}

// ── Scope Chip ──────────────────────────────────────────────────
interface ScopeChipProps {
  label: string;
  onClear?: () => void;
}

export function ScopeChip({ label, onClear }: ScopeChipProps) {
  return (
    <span className="inline-flex items-center gap-1 h-6 px-2 rounded-[var(--radius-sm)] bg-accent-subtle text-accent text-[11px] font-medium">
      {label}
      {onClear && (
        <button
          onClick={onClear}
          className="ml-0.5 hover:text-fg transition-colors"
          aria-label="Clear scope"
        >
          ×
        </button>
      )}
    </span>
  );
}

// ── Skeleton ────────────────────────────────────────────────────
interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      className={cn(
        'animate-pulse rounded-[var(--radius-sm)] bg-surface-raised',
        className,
      )}
    />
  );
}
