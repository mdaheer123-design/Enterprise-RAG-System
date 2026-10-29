/**
 * Knowledge AI — Chat Stream Hook
 * Manages SSE streaming with state for tokens, citations, and status.
 */
import { useState, useCallback, useRef } from 'react';
import { streamChat, type SSECallbacks } from '@/lib/sse';
import type { Citation, QueryRequest } from '@/types/api';

export type StreamPhase = 'idle' | 'pending' | 'streaming' | 'complete' | 'no_support' | 'error' | 'cancelled';

interface StreamState {
  phase: StreamPhase;
  content: string;
  status: string | null;
  chatId: string | null;
  citations: Citation[];
  suggestedQuestions: string[];
  confidence: number | null;
  error: string | null;
}

const initialState: StreamState = {
  phase: 'idle',
  content: '',
  status: null,
  chatId: null,
  citations: [],
  suggestedQuestions: [],
  confidence: null,
  error: null,
};

export function useChatStream() {
  const [state, setState] = useState<StreamState>(initialState);
  const controllerRef = useRef<AbortController | null>(null);
  const timeoutRef = useRef<number | null>(null);
  const contentRef = useRef('');

  const resetTimeout = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    timeoutRef.current = window.setTimeout(() => {
      controllerRef.current?.abort();
      setState(prev => ({
        ...prev,
        phase: 'error',
        error: 'Stream timed out after 120 seconds of inactivity.',
      }));
    }, 120000);
  }, []);

  const start = useCallback((request: QueryRequest) => {
    contentRef.current = '';
    setState({
      ...initialState,
      phase: 'pending',
    });
    
    resetTimeout();

    const callbacks: SSECallbacks = {
      onToken: (token) => {
        resetTimeout();
        contentRef.current += token;
        setState((prev) => ({
          ...prev,
          phase: 'streaming',
          content: contentRef.current,
        }));
      },
      onChatId: (chatId) => {
        resetTimeout();
        setState((prev) => ({ ...prev, chatId }));
      },
      onStatus: (status) => {
        resetTimeout();
        setState((prev) => ({ ...prev, status }));
      },
      onDone: (data) => {
        if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
        
        setState((prev) => {
          if (prev.phase === 'error') {
            return prev;
          }
          let newPhase: StreamPhase = 'complete';
          if (!contentRef.current && data.confidence === 0) {
             newPhase = 'no_support';
          } else if (!contentRef.current) {
             newPhase = 'error';
          }

          return {
            ...prev,
            phase: newPhase,
            content: contentRef.current,
            status: null,
            citations: data.citations as Citation[],
            suggestedQuestions: data.suggested_questions,
            confidence: data.confidence ?? null,
            error: newPhase === 'error' ? 'The assistant returned no answer.' : null,
          };
        });
        controllerRef.current = null;
      },
      onError: (error) => {
        if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
        setState((prev) => ({
          ...prev,
          phase: 'error',
          error,
          status: null,
        }));
        controllerRef.current = null;
      },
    };

    controllerRef.current = streamChat(request, callbacks);
  }, [resetTimeout]);

  const stop = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    controllerRef.current?.abort();
    controllerRef.current = null;
    setState((prev) => ({
      ...prev,
      phase: 'cancelled',
      status: null,
    }));
  }, []);

  const reset = useCallback(() => {
    if (timeoutRef.current) window.clearTimeout(timeoutRef.current);
    controllerRef.current?.abort();
    controllerRef.current = null;
    contentRef.current = '';
    setState(initialState);
  }, []);

  return {
    ...state,
    start,
    stop,
    reset,
  };
}
