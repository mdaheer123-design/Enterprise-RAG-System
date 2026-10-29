/**
 * Knowledge AI — Sidebar Navigation
 * Collapsible left sidebar with wordmark, nav items, recent chats, and footer.
 */
import { useState } from 'react';
import { NavLink, useNavigate } from 'react-router-dom';
import {
  LayoutDashboard,
  MessageSquare,
  Upload,
  FolderOpen,
  GitCompareArrows,
  Search,
  BarChart3,
  Settings,
  PanelLeftClose,
  PanelLeft,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { brand } from '@/config/brand';
import { Kbd, StatusDot } from '@/components/shared';

interface SidebarProps {
  collapsed: boolean;
  onToggle: () => void;
}

const navItems = [
  { to: '/', icon: LayoutDashboard, label: 'Dashboard', shortcut: 'G D' },
  { to: '/chat', icon: MessageSquare, label: 'Chat', shortcut: 'G C' },
  { to: '/upload', icon: Upload, label: 'Upload', shortcut: 'G U' },
  { to: '/collections', icon: FolderOpen, label: 'Collections', shortcut: 'G L' },
  { to: '/compare', icon: GitCompareArrows, label: 'Compare', shortcut: '' },
  { to: '/search', icon: Search, label: 'Search', shortcut: 'G S' },
  { to: '/analytics', icon: BarChart3, label: 'Analytics', shortcut: 'G A' },
  { to: '/settings', icon: Settings, label: 'Settings', shortcut: '' },
] as const;

export function Sidebar({ collapsed, onToggle }: SidebarProps) {
  const navigate = useNavigate();

  return (
    <aside
      className={cn(
        'fixed left-0 top-0 bottom-0 z-30 flex flex-col',
        'bg-bg border-r border-border',
        'transition-[width] duration-[var(--duration-normal)] ease-[var(--ease-out)]',
        collapsed ? 'w-[var(--sidebar-collapsed-width)]' : 'w-[var(--sidebar-width)]',
      )}
    >
      {/* Wordmark */}
      <div
        className={cn(
          'h-[var(--topbar-height)] flex items-center shrink-0 border-b border-border',
          collapsed ? 'justify-center px-0' : 'px-4',
        )}
      >
        {collapsed ? (
          <span className="text-[18px] font-bold text-accent">
            K
          </span>
        ) : (
          <span className="text-[16px] tracking-tight">
            <span className="font-bold text-fg">Knowledge</span>{' '}
            <span className="font-bold italic text-accent">AI</span>
          </span>
        )}
      </div>

      {/* Navigation */}
      <nav className="flex-1 overflow-y-auto py-2 px-2">
        <ul className="space-y-0.5">
          {navItems.map((item) => (
            <li key={item.to}>
              <NavLink
                to={item.to}
                end={item.to === '/'}
                className={({ isActive }) =>
                  cn(
                    'group flex items-center gap-2.5 rounded-[var(--radius)] transition-colors',
                    'duration-[var(--duration-fast)] ease-[var(--ease-out)]',
                    collapsed ? 'h-9 w-9 justify-center mx-auto' : 'h-8 px-2.5',
                    isActive
                      ? 'text-accent bg-accent/10 border border-accent font-medium shadow-sm shadow-accent/5'
                      : 'text-fg-muted hover:text-fg hover:bg-surface-raised border border-transparent',
                  )
                }
              >
                {({ isActive }) => (
                  <>
                    <item.icon size={16} strokeWidth={1.5} className="shrink-0" />
                    {!collapsed && (
                      <>
                        <span className="flex-1 text-[13px] truncate">{item.label}</span>
                        {item.shortcut && (
                          <span className="text-[10px] text-fg-faint opacity-0 group-hover:opacity-100 transition-opacity"
                            style={{ fontFamily: 'var(--font-mono)' }}
                          >
                            {item.shortcut}
                          </span>
                        )}
                      </>
                    )}
                  </>
                )}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>

      {/* Footer */}
      <div className={cn(
        'shrink-0 border-t border-border py-2 px-2',
        'flex items-center',
        collapsed ? 'justify-center' : 'justify-between',
      )}>
        {!collapsed && <StatusDot status="online" label="API connected" />}
        <button
          onClick={onToggle}
          className="p-1.5 rounded-[var(--radius-sm)] text-fg-faint hover:text-fg hover:bg-surface-raised transition-colors"
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          {collapsed ? (
            <PanelLeft size={16} strokeWidth={1.5} />
          ) : (
            <PanelLeftClose size={16} strokeWidth={1.5} />
          )}
        </button>
      </div>
    </aside>
  );
}
