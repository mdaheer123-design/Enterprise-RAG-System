/**
 * Knowledge AI — Scope Hook
 * Manages the active document/collection scope for chat and search.
 */
import { createContext, useContext, useState, useCallback, type ReactNode } from 'react';
import type { Scope } from '@/types/api';

const defaultScope: Scope = { type: 'all', label: 'All documents' };

interface ScopeContext {
  scope: Scope;
  setScope: (scope: Scope) => void;
  resetScope: () => void;
}

const ScopeCtx = createContext<ScopeContext | null>(null);

export function ScopeProvider({ children }: { children: ReactNode }) {
  const [scope, setScopeState] = useState<Scope>(defaultScope);

  const setScope = useCallback((s: Scope) => setScopeState(s), []);
  const resetScope = useCallback(() => setScopeState(defaultScope), []);

  return (
    <ScopeCtx.Provider value={{ scope, setScope, resetScope }}>
      {children}
    </ScopeCtx.Provider>
  );
}

export function useScope(): ScopeContext {
  const ctx = useContext(ScopeCtx);
  if (!ctx) throw new Error('useScope must be used within ScopeProvider');
  return ctx;
}
