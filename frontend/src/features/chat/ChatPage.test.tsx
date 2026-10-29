/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ScopeProvider } from '@/hooks/useScope';
import ChatPage from './ChatPage';

// Mock the SSE module
vi.mock('@/lib/sse', () => ({
  streamChat: vi.fn((request, callbacks) => {
    // Simulate immediate stream completion with no content
    setTimeout(() => {
      if (request.question.toLowerCase() === 'hi') {
        callbacks.onToken('Hi! Ask me anything.');
        callbacks.onDone({ citations: [], confidence: 1, suggested_questions: [] });
      } else {
        callbacks.onDone({ citations: [], confidence: 0, suggested_questions: [] });
      }
    }, 10);
    return new AbortController();
  }),
}));

// Mock ResizeObserver and scrollIntoView for standard testing
(globalThis as any).ResizeObserver = class {
  observe() {}
  unobserve() {}
  disconnect() {}
};
window.HTMLElement.prototype.scrollIntoView = vi.fn();

describe('ChatPage Component', () => {
  let queryClient: QueryClient;

  beforeEach(() => {
    queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
  });

  afterEach(() => {
    cleanup();
    vi.clearAllMocks();
  });

  const renderWithProviders = () => {
    render(
      <QueryClientProvider client={queryClient}>
        <ScopeProvider>
          <MemoryRouter initialEntries={['/chat']}>
            <Routes>
              <Route path="/chat" element={<ChatPage />} />
            </Routes>
          </MemoryRouter>
        </ScopeProvider>
      </QueryClientProvider>
    );
  };

  it('renders a terminal assistant state when sending a greeting', async () => {
    renderWithProviders();

    // Type "hi"
    const input = screen.getByPlaceholderText('Ask your documents anything…');
    fireEvent.change(input, { target: { value: 'hi' } });

    // Send
    const sendButton = screen.getByLabelText('Send');
    expect(sendButton.hasAttribute('disabled')).toBe(false);
    fireEvent.click(sendButton);

    // Assert that the user message appeared
    expect(await screen.findByText('hi')).toBeTruthy();

    // The mock stream replies with "Hi! Ask me anything."
    // Assert that the assistant message appears in complete state
    await waitFor(() => {
      expect(screen.getByText('Hi! Ask me anything.')).toBeTruthy();
    });
  });

  it('renders a "No supporting passages found" terminal state when confidence is 0 and content is empty', async () => {
    renderWithProviders();

    const input = screen.getByPlaceholderText('Ask your documents anything…');
    fireEvent.change(input, { target: { value: 'Unknown question' } });
    
    const sendButton = screen.getByLabelText('Send');
    fireEvent.click(sendButton);

    // Mock stream returns no content and confidence 0
    await waitFor(() => {
      expect(screen.getByText('No supporting passages found')).toBeTruthy();
    });
  });
});
