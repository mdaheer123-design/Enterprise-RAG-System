/**
 * Knowledge AI — Top Bar
 * Search bar trigger, settings, and user avatar.
 */
import { useLocation } from 'react-router-dom';
import { Search, Settings, Sun, Moon } from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { Kbd } from '@/components/shared';
import { cn } from '@/lib/utils';

interface TopBarProps {
  onOpenPalette: () => void;
}

const routeNames: Record<string, string> = {
  '/': 'Dashboard',
  '/chat': 'Chat',
  '/upload': 'Upload',
  '/collections': 'Collections',
  '/compare': 'Compare',
  '/search': 'Search',
  '/analytics': 'Analytics',
  '/settings': 'Settings',
};

export function TopBar({ onOpenPalette }: TopBarProps) {
  const { theme, toggle } = useTheme();
  const location = useLocation();

  const currentPage = routeNames[location.pathname] ?? 'Page';

  return (
    <header className="h-[var(--topbar-height)] flex items-center px-4 border-b border-border bg-bg shrink-0">
      {/* Spacer */}
      <div className="flex-1" />

      {/* Command bar trigger */}
      <button
        onClick={onOpenPalette}
        className={cn(
          'flex items-center gap-2 h-8 px-3.5 rounded-[var(--radius)]',
          'border border-border bg-surface',
          'text-[13px] text-fg-faint hover:text-fg-muted hover:border-fg-faint',
          'transition-colors duration-[var(--duration-fast)]',
          'max-w-[280px]',
        )}
      >
        <Search size={14} strokeWidth={1.5} />
        <span className="truncate">Search or jump to…</span>
        <Kbd>⌘K</Kbd>
      </button>

      {/* Spacer */}
      <div className="flex-1" />

      {/* Theme toggle */}
      <button
        onClick={toggle}
        className="p-1.5 rounded-[var(--radius-sm)] text-fg-muted hover:text-fg hover:bg-surface-raised transition-colors"
        aria-label="Toggle theme"
      >
        <Sun size={17} strokeWidth={1.5} />
      </button>

      {/* User Avatar */}
      <div className="ml-2 w-8 h-8 rounded-full bg-accent flex items-center justify-center text-accent-fg text-[13px] font-bold">
        U
      </div>
    </header>
  );
}
