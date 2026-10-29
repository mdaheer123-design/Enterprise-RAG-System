/**
 * Knowledge AI — App Providers
 * QueryClient, Theme, Scope providers.
 */
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { type ReactNode } from 'react';
import { ThemeProvider } from '@/hooks/useTheme';
import { ScopeProvider } from '@/hooks/useScope';
import { Toaster } from 'sonner';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      retry: 2,
      refetchOnWindowFocus: false,
    },
  },
});

export function Providers({ children }: { children: ReactNode }) {
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <ScopeProvider>
          {children}
          <Toaster
            position="bottom-right"
            toastOptions={{
              style: {
                background: 'hsl(var(--surface))',
                color: 'hsl(var(--fg))',
                border: '1px solid hsl(var(--border))',
                borderRadius: 'var(--radius)',
                fontSize: '13px',
                fontFamily: 'var(--font-sans)',
              },
            }}
          />
        </ScopeProvider>
      </ThemeProvider>
    </QueryClientProvider>
  );
}
