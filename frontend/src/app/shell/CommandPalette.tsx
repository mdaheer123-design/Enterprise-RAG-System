/**
 * Knowledge AI — Command Palette
 * ⌘K navigation: pages, chat, collections, theme toggle.
 */
import { useEffect, useState, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { Command } from 'cmdk';
import {
  LayoutDashboard,
  MessageSquare,
  Upload,
  FolderOpen,
  GitCompareArrows,
  Search,
  BarChart3,
  Settings,
  Sun,
  Moon,
  Plus,
} from 'lucide-react';
import { useTheme } from '@/hooks/useTheme';
import { cn } from '@/lib/utils';

interface CommandPaletteProps {
  open: boolean;
  onClose: () => void;
}

export function CommandPalette({ open, onClose }: CommandPaletteProps) {
  const navigate = useNavigate();
  const { theme, toggle } = useTheme();

  const runAction = useCallback(
    (action: () => void) => {
      action();
      onClose();
    },
    [onClose],
  );

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/50"
        onClick={onClose}
      />

      {/* Dialog */}
      <div className="flex items-start justify-center pt-[20vh]">
        <div
          className={cn(
            'relative w-full max-w-[520px] mx-4',
            'bg-surface border border-border rounded-[var(--radius-lg)]',
            'shadow-lg overflow-hidden',
          )}
        >
          <Command
            className="flex flex-col"
            onKeyDown={(e) => {
              if (e.key === 'Escape') onClose();
            }}
          >
            <div className="flex items-center border-b border-border px-3">
              <Search size={16} strokeWidth={1.5} className="text-fg-faint shrink-0" />
              <Command.Input
                autoFocus
                placeholder="Search or jump to…"
                className={cn(
                  'flex-1 h-11 px-2 bg-transparent text-[14px] text-fg',
                  'placeholder:text-fg-faint outline-none',
                )}
              />
            </div>

            <Command.List className="max-h-[320px] overflow-y-auto p-1.5">
              <Command.Empty className="py-8 text-center text-[13px] text-fg-faint">
                No results found.
              </Command.Empty>

              <Command.Group
                heading="Navigation"
                className="text-[11px] text-fg-faint uppercase tracking-wider px-2 py-1.5"
              >
                {[
                  { to: '/', icon: LayoutDashboard, label: 'Dashboard' },
                  { to: '/chat', icon: MessageSquare, label: 'Chat' },
                  { to: '/upload', icon: Upload, label: 'Upload' },
                  { to: '/collections', icon: FolderOpen, label: 'Collections' },
                  { to: '/compare', icon: GitCompareArrows, label: 'Compare' },
                  { to: '/search', icon: Search, label: 'Search' },
                  { to: '/analytics', icon: BarChart3, label: 'Analytics' },
                  { to: '/settings', icon: Settings, label: 'Settings' },
                ].map((item) => (
                  <Command.Item
                    key={item.to}
                    value={item.label}
                    onSelect={() => runAction(() => navigate(item.to))}
                    className={cn(
                      'flex items-center gap-2.5 h-9 px-2 rounded-[var(--radius)]',
                      'text-[13px] text-fg-muted cursor-pointer',
                      'data-[selected=true]:bg-surface-raised data-[selected=true]:text-fg',
                    )}
                  >
                    <item.icon size={16} strokeWidth={1.5} />
                    {item.label}
                  </Command.Item>
                ))}
              </Command.Group>

              <Command.Separator className="h-px bg-border my-1" />

              <Command.Group
                heading="Actions"
                className="text-[11px] text-fg-faint uppercase tracking-wider px-2 py-1.5"
              >
                <Command.Item
                  value="New chat"
                  onSelect={() => runAction(() => navigate('/chat'))}
                  className={cn(
                    'flex items-center gap-2.5 h-9 px-2 rounded-[var(--radius)]',
                    'text-[13px] text-fg-muted cursor-pointer',
                    'data-[selected=true]:bg-surface-raised data-[selected=true]:text-fg',
                  )}
                >
                  <Plus size={16} strokeWidth={1.5} />
                  New chat
                </Command.Item>
                <Command.Item
                  value={`Switch to ${theme === 'dark' ? 'light' : 'dark'} theme`}
                  onSelect={() => runAction(toggle)}
                  className={cn(
                    'flex items-center gap-2.5 h-9 px-2 rounded-[var(--radius)]',
                    'text-[13px] text-fg-muted cursor-pointer',
                    'data-[selected=true]:bg-surface-raised data-[selected=true]:text-fg',
                  )}
                >
                  {theme === 'dark' ? (
                    <Sun size={16} strokeWidth={1.5} />
                  ) : (
                    <Moon size={16} strokeWidth={1.5} />
                  )}
                  Switch to {theme === 'dark' ? 'light' : 'dark'} theme
                </Command.Item>
              </Command.Group>
            </Command.List>
          </Command>
        </div>
      </div>
    </div>
  );
}
