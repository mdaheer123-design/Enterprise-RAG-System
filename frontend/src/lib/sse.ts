/**
 * Knowledge AI — SSE Stream Parser
 * Handles Server-Sent Events for chat streaming with abort support.
 */
import { API_BASE } from '@/config/constants';
import type { QueryRequest } from '@/types/api';

export interface SSECallbacks {
  onToken: (token: string) => void;
  onChatId: (chatId: string) => void;
  onStatus: (status: string) => void;
  onDone: (data: {
    citations: Array<{
      id: string;
      document_id: string;
      chunk_id: string;
      filename: string;
      page_number: number | null;
      paragraph_number: number | null;
      relevance_score: number;
      snippet: string;
    }>;
    confidence?: number;
    suggested_questions: string[];
    latency_ms?: number;
  }) => void;
  onError: (error: string) => void;
}

/**
 * Stream a chat response via SSE.
 * Returns an AbortController so the caller can cancel.
 */
export function streamChat(
  request: QueryRequest,
  callbacks: SSECallbacks,
): AbortController {
  const controller = new AbortController();

  (async () => {
    try {
      const response = await fetch(`${API_BASE}/chat/stream`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'text/event-stream',
        },
        body: JSON.stringify(request),
        signal: controller.signal,
      });

      if (!response.ok) {
        callbacks.onError(`Request failed with status ${response.status}`);
        return;
      }

      const reader = response.body?.getReader();
      if (!reader) {
        callbacks.onError('No response body');
        return;
      }

      const decoder = new TextDecoder('utf-8', { fatal: false });
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        
        let boundary = buffer.indexOf('\n\n');
        while (boundary !== -1) {
          const chunk = buffer.slice(0, boundary);
          buffer = buffer.slice(boundary + 2);
          boundary = buffer.indexOf('\n\n');

          if (!chunk.trim()) continue;

          let dataPayload = '';
          let eventType = 'message';

          const lines = chunk.split('\n');
          for (const line of lines) {
            if (line.startsWith('event: ')) {
              eventType = line.slice(7).trim();
            } else if (line.startsWith('data: ')) {
              dataPayload += dataPayload ? '\n' + line.slice(6) : line.slice(6);
            } else if (line.startsWith('data:')) {
              dataPayload += dataPayload ? '\n' + line.slice(5) : line.slice(5);
            }
          }

          if (dataPayload) {
            try {
              const event = JSON.parse(dataPayload);
              const type = event.type || eventType;
              const data = event.data;
              
              if (import.meta.env.VITE_DEBUG_CHAT === 'true') {
                console.log(`[SSE] ${type} (${new Blob([dataPayload]).size} bytes)`);
              }

              switch (type) {
                case 'token':
                  callbacks.onToken(data as string);
                  break;
                case 'chat_id':
                  callbacks.onChatId(data as string);
                  break;
                case 'status':
                case 'status/phase':
                  callbacks.onStatus(data as string);
                  break;
                case 'done':
                  callbacks.onDone(data as any);
                  break;
                case 'error':
                  callbacks.onError(data as string);
                  break;
              }
            } catch (err) {
              if (import.meta.env.VITE_DEBUG_CHAT === 'true') {
                console.error('Failed to parse SSE payload', dataPayload);
              }
            }
          }
        }
      }
      
      // Flush anything left in the buffer at the end
      if (buffer.trim()) {
        const lines = buffer.split('\n');
        let dataPayload = '';
        for (const line of lines) {
          if (line.startsWith('data: ')) dataPayload += line.slice(6);
        }
        if (dataPayload) {
          try {
            const event = JSON.parse(dataPayload);
            if (event.type === 'done') callbacks.onDone(event.data);
          } catch (e) {}
        }
      }
    } catch (err: unknown) {
      if (err instanceof DOMException && err.name === 'AbortError') {
        return; // User cancelled
      }
      callbacks.onError(err instanceof Error ? err.message : 'Stream failed');
    }
  })();

  return controller;
}
