import { describe, it, expect, vi } from 'vitest';
import { streamChat, type SSECallbacks } from './sse';

// Mock fetch globally
const mockFetch = vi.fn();
(globalThis as any).fetch = mockFetch;

describe('SSE Parser', () => {
  const createMockResponse = (chunks: string[]) => {
    let currentChunk = 0;
    const encoder = new TextEncoder();
    
    return {
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (currentChunk < chunks.length) {
              const value = encoder.encode(chunks[currentChunk++]);
              return { done: false, value };
            }
            return { done: true, value: undefined };
          }
        })
      }
    };
  };

  const getCallbacks = (): SSECallbacks & { calls: Record<string, any[]> } => {
    const calls: Record<string, any[]> = {
      onToken: [],
      onChatId: [],
      onStatus: [],
      onDone: [],
      onError: []
    };
    return {
      calls,
      onToken: (t) => calls.onToken.push(t),
      onChatId: (id) => calls.onChatId.push(id),
      onStatus: (s) => calls.onStatus.push(s),
      onDone: (d) => calls.onDone.push(d),
      onError: (e) => calls.onError.push(e),
    };
  };

  it('handles standard single frames', async () => {
    const callbacks = getCallbacks();
    mockFetch.mockResolvedValue(createMockResponse([
      'data: {"type": "token", "data": "Hello"}\n\n',
      'data: {"type": "done", "data": {"citations": []}}\n\n'
    ]));

    await streamChat({ question: 'test' }, callbacks);
    
    // Wait a tick for promises
    await new Promise(r => setTimeout(r, 10));
    
    expect(callbacks.calls.onToken).toEqual(['Hello']);
    expect(callbacks.calls.onDone.length).toBe(1);
  });

  it('handles split frames (buffering)', async () => {
    const callbacks = getCallbacks();
    mockFetch.mockResolvedValue(createMockResponse([
      'data: {"type": "to',
      'ken", "data": "split"}\n\n'
    ]));

    await streamChat({ question: 'test' }, callbacks);
    await new Promise(r => setTimeout(r, 10));
    
    expect(callbacks.calls.onToken).toEqual(['split']);
  });

  it('handles multi-line data payload (event: line)', async () => {
    const callbacks = getCallbacks();
    mockFetch.mockResolvedValue(createMockResponse([
      'event: token\ndata: {"type": "token", "data": "multi\\nline"}\n\n'
    ]));

    await streamChat({ question: 'test' }, callbacks);
    await new Promise(r => setTimeout(r, 10));
    
    expect(callbacks.calls.onToken).toEqual(['multi\nline']);
  });

  it('handles done-only streams', async () => {
    const callbacks = getCallbacks();
    mockFetch.mockResolvedValue(createMockResponse([
      'data: {"type": "done", "data": {"citations": [], "confidence": 0}}\n\n'
    ]));

    await streamChat({ question: 'test' }, callbacks);
    await new Promise(r => setTimeout(r, 10));
    
    expect(callbacks.calls.onToken.length).toBe(0);
    expect(callbacks.calls.onDone.length).toBe(1);
  });

  it('handles error events', async () => {
    const callbacks = getCallbacks();
    mockFetch.mockResolvedValue(createMockResponse([
      'data: {"type": "error", "data": "backend failed"}\n\n'
    ]));

    await streamChat({ question: 'test' }, callbacks);
    await new Promise(r => setTimeout(r, 10));
    
    expect(callbacks.calls.onError).toEqual(['backend failed']);
  });

  it('handles empty streams gracefully', async () => {
    const callbacks = getCallbacks();
    mockFetch.mockResolvedValue(createMockResponse([
      ''
    ]));

    await streamChat({ question: 'test' }, callbacks);
    await new Promise(r => setTimeout(r, 10));
    
    expect(callbacks.calls.onToken.length).toBe(0);
    expect(callbacks.calls.onDone.length).toBe(0);
    expect(callbacks.calls.onError.length).toBe(0);
  });
});
