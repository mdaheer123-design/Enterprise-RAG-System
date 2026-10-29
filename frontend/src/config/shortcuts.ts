/**
 * Knowledge AI — Keyboard Shortcuts
 */

export interface Shortcut {
  keys: string[];
  label: string;
  description: string;
  scope: 'global' | 'chat' | 'compare';
}

export const shortcuts: Record<string, Shortcut> = {
  palette: {
    keys: ['Meta+k', 'Control+k'],
    label: '⌘K',
    description: 'Open command palette',
    scope: 'global',
  },
  focusComposer: {
    keys: ['Meta+/', 'Control+/'],
    label: '⌘/',
    description: 'Focus chat composer',
    scope: 'global',
  },
  newChat: {
    keys: ['Meta+Shift+o', 'Control+Shift+o'],
    label: '⌘⇧O',
    description: 'New chat',
    scope: 'global',
  },
  shortcutHelp: {
    keys: ['?'],
    label: '?',
    description: 'Show keyboard shortcuts',
    scope: 'global',
  },
  escape: {
    keys: ['Escape'],
    label: 'Esc',
    description: 'Close panels and dialogs',
    scope: 'global',
  },
  navDashboard: {
    keys: ['g d'],
    label: 'G D',
    description: 'Go to Dashboard',
    scope: 'global',
  },
  navChat: {
    keys: ['g c'],
    label: 'G C',
    description: 'Go to Chat',
    scope: 'global',
  },
  navUpload: {
    keys: ['g u'],
    label: 'G U',
    description: 'Go to Upload',
    scope: 'global',
  },
  navCollections: {
    keys: ['g l'],
    label: 'G L',
    description: 'Go to Collections',
    scope: 'global',
  },
  navSearch: {
    keys: ['g s'],
    label: 'G S',
    description: 'Go to Search',
    scope: 'global',
  },
  navAnalytics: {
    keys: ['g a'],
    label: 'G A',
    description: 'Go to Analytics',
    scope: 'global',
  },
  nextChange: {
    keys: ['j'],
    label: 'J',
    description: 'Next change',
    scope: 'compare',
  },
  prevChange: {
    keys: ['k'],
    label: 'K',
    description: 'Previous change',
    scope: 'compare',
  },
} as const;

export const shortcutGroups = [
  {
    label: 'Navigation',
    items: ['palette', 'navDashboard', 'navChat', 'navUpload', 'navCollections', 'navSearch', 'navAnalytics'],
  },
  {
    label: 'Actions',
    items: ['focusComposer', 'newChat', 'escape', 'shortcutHelp'],
  },
  {
    label: 'Compare',
    items: ['nextChange', 'prevChange'],
  },
] as const;
