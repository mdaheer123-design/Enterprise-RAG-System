/**
 * Knowledge AI — Theme Hook
 * Persists theme to localStorage, defaults to system preference.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from 'react';

type Theme = 'dark' | 'light';

interface ThemeContext {
  theme: Theme;
  toggle: () => void;
  set: (theme: Theme) => void;
  setTheme: (theme: Theme | 'system') => void;
}

const ThemeCtx = createContext<ThemeContext | null>(null);

function getInitialTheme(): Theme {
  if (typeof window === 'undefined') return 'dark';
  const stored = localStorage.getItem('knowledge-ai-theme') as Theme | null;
  if (stored === 'dark' || stored === 'light') return stored;
  return window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
}

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>(getInitialTheme);

  useEffect(() => {
    const root = document.documentElement;
    root.classList.remove('dark', 'light');
    root.classList.add(theme);
    localStorage.setItem('knowledge-ai-theme', theme);
  }, [theme]);

  const toggle = useCallback(() => {
    setThemeState((prev) => (prev === 'dark' ? 'light' : 'dark'));
  }, []);

  const set = useCallback((t: Theme) => setThemeState(t), []);

  const setTheme = useCallback((t: Theme | 'system') => {
    if (t === 'system') {
      const systemTheme = window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark';
      setThemeState(systemTheme);
    } else {
      setThemeState(t);
    }
  }, []);

  return (
    <ThemeCtx.Provider value={{ theme, toggle, set, setTheme }}>
      {children}
    </ThemeCtx.Provider>
  );
}

export function useTheme(): ThemeContext {
  const ctx = useContext(ThemeCtx);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}
