/**
 * Knowledge AI — Chat Page (flagship)
 * Three-pane layout: conversation list, thread, source panel.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useParams, useNavigate } from 'react-router-dom';
import {
  Plus,
  Search,
  MoreHorizontal,
  Trash2,
  Edit3,
  Copy,
  RefreshCw,
  ThumbsUp,
  ThumbsDown,
  Square,
  Send,
  ArrowUp,
  ChevronRight,
  BookOpen,
  MessageSquare,
  AlertCircle,
  FileText,
  SearchIcon,
  GitCompareArrows,
  BarChart3,
  Paperclip,
  Lightbulb,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { chatApi } from '@/lib/api/endpoints';
import { useChatStream } from '@/hooks/useChatStream';
import { useScope } from '@/hooks/useScope';
import { Button } from '@/components/ui/Button';
import { ScopeChip, ScoreBar } from '@/components/shared';
import { cn, groupBy, truncate } from '@/lib/utils';
import type { Chat, Message, Citation } from '@/types/api';
import { toast } from 'sonner';

type ChatUIMessage = Message & {
  _localPhase?: string;
  _localError?: string | null;
  _localSuggested?: string[];
};

export default function ChatPage() {
  const { chatId } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { scope } = useScope();
  
  const [selectedChat, setSelectedChat] = useState<string | null>(chatId ?? null);
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<ChatUIMessage[]>([]);
  const [hoveredCitation, setHoveredCitation] = useState<Citation | null>(null);
  const [showScrollBottom, setShowScrollBottom] = useState(false);
  const [userScrolledUp, setUserScrolledUp] = useState(false);
  
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const stream = useChatStream();

  // Fetch chat list
  const { data: chatList } = useQuery({
    queryKey: ['chats'],
    queryFn: () => chatApi.list({ page: 1, page_size: 50 }),
  });

  // Fetch selected chat detail
  const { data: chatDetail } = useQuery({
    queryKey: ['chat', selectedChat],
    queryFn: () => chatApi.get(selectedChat!),
    enabled: !!selectedChat,
  });

  // Sync messages from server, unless streaming or pending
  useEffect(() => {
    if (chatDetail?.messages && stream.phase === 'idle') {
      setMessages(chatDetail.messages);
    }
  }, [chatDetail, stream.phase]);

  // Handle stream completion: append the final assistant message
  useEffect(() => {
    if (['complete', 'no_support', 'error', 'cancelled'].includes(stream.phase) && stream.phase !== 'idle') {
      if (stream.content || stream.phase !== 'cancelled') {
        const assistantMsg: Message = {
          id: crypto.randomUUID(),
          chat_id: stream.chatId ?? selectedChat ?? '',
          role: 'assistant',
          content: stream.content || (stream.phase === 'error' ? 'The assistant returned no answer.' : 'No supporting passages found.'),
          tokens_used: null,
          latency_ms: null,
          model: null,
          citations: stream.citations,
          created_at: new Date().toISOString(),
          // Extend locally to render the state correctly
          _localPhase: stream.phase,
          _localError: stream.error,
          _localSuggested: stream.suggestedQuestions,
        } as Message & { _localPhase: string; _localError?: string | null; _localSuggested?: string[] };

        setMessages(prev => {
          // If the last message was the placeholder for this stream, replace it
          if (prev.length > 0 && prev[prev.length - 1]._localPhase === 'pending_or_streaming') {
            return [...prev.slice(0, -1), assistantMsg];
          }
          return [...prev, assistantMsg];
        });
        
        // Sync URL and list if this was the first message creating the chat
        if (stream.chatId && stream.chatId !== selectedChat) {
          setSelectedChat(stream.chatId);
          navigate(`/chat/${stream.chatId}`, { replace: true });
        }
        
        queryClient.invalidateQueries({ queryKey: ['chats'] });
        queryClient.invalidateQueries({ queryKey: ['chat', stream.chatId ?? selectedChat] });
      }
      // Defer reset to next microtask so the message list renders before
      // 'idle' phase triggers a stale server re-sync that would overwrite it
      setTimeout(() => stream.reset(), 0);
    }
  }, [stream.phase, stream.chatId, stream.content, stream.citations, stream.suggestedQuestions, stream.error, selectedChat, navigate, queryClient, stream.reset]);

  const scrollToBottom = useCallback(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'auto' });
  }, []);

  useEffect(() => {
    if (!userScrolledUp) {
      scrollToBottom();
    }
  }, [messages, stream.content, userScrolledUp, scrollToBottom]);

  const handleScroll = () => {
    if (!scrollContainerRef.current) return;
    const { scrollTop, scrollHeight, clientHeight } = scrollContainerRef.current;
    const isAtBottom = scrollHeight - scrollTop - clientHeight < 50;
    
    setUserScrolledUp(!isAtBottom);
    setShowScrollBottom(!isAtBottom);
  };

  const deleteChat = useMutation({
    mutationFn: chatApi.delete,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      setSelectedChat(null);
      setMessages([]);
      toast.success('Chat deleted');
    },
  });

  const handleSend = useCallback((retryQuestion?: string) => {
    const question = retryQuestion || inputValue.trim();
    if (!question || (stream.phase === 'streaming' || stream.phase === 'pending')) return;

    // Add user message locally
    const userMsg: Message = {
      id: crypto.randomUUID(),
      chat_id: selectedChat ?? '',
      role: 'user',
      content: question,
      tokens_used: null,
      latency_ms: null,
      model: null,
      citations: [],
      created_at: new Date().toISOString(),
    };
    
    // Add pending assistant message placeholder
    const pendingMsg: any = {
      id: 'pending-' + crypto.randomUUID(),
      role: 'assistant',
      content: '',
      citations: [],
      _localPhase: 'pending_or_streaming',
    };

    setMessages(prev => [...prev, userMsg, pendingMsg]);
    setInputValue('');
    setUserScrolledUp(false);
    
    // Resize textarea back to 1 row
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }

    // Start streaming
    stream.start({
      question,
      chat_id: selectedChat ?? undefined,
      collection_id: scope.type === 'collection' ? scope.id : undefined,
    });
  }, [inputValue, selectedChat, stream, scope]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInput = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInputValue(e.target.value);
    e.target.style.height = 'auto';
    e.target.style.height = Math.min(e.target.scrollHeight, 120) + 'px';
  };

  const formatChatTime = (dateStr?: string) => {
    if (!dateStr) return '';
    try {
      const d = new Date(dateStr);
      return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: true });
    } catch {
      return '';
    }
  };

  // Group chats by date
  const groupedChats = chatList?.chats
    ? groupBy(chatList.chats, (chat) => {
        const d = new Date(chat.updated_at);
        const now = new Date();
        const diff = now.getTime() - d.getTime();
        const days = Math.floor(diff / (1000 * 60 * 60 * 24));
        if (days === 0) return 'Today';
        if (days === 1) return 'Yesterday';
        return 'Earlier';
      })
    : {};

  return (
    <div className="flex h-full w-full">
      {/* Conversation List Pane */}
      <div className="w-[280px] border-r border-border flex flex-col shrink-0 hidden lg:flex bg-bg">
        <div className="p-3 border-b border-border">
          <button
            className="w-full flex items-center justify-between px-3.5 py-2 bg-accent hover:bg-accent/90 text-black font-semibold rounded-[var(--radius)] transition-colors shadow-sm"
            onClick={() => {
              setSelectedChat(null);
              setMessages([]);
              stream.reset();
              navigate('/chat');
            }}
          >
            <div className="flex items-center gap-2">
              <Plus size={16} strokeWidth={2.5} className="text-black" />
              <span className="text-[13px] font-semibold text-black">New chat</span>
            </div>
            <span className="text-[10px] border border-black/40 text-black font-mono font-medium px-1.5 py-0.5 rounded">
              ⌘K
            </span>
          </button>
        </div>
        
        <div className="px-3 py-2 border-b border-border">
          <div className="relative">
            <Search size={13} className="absolute left-2.5 top-[8px] text-fg-faint" />
            <input 
              type="text" 
              placeholder="Search conversations..." 
              className="w-full bg-surface border border-border focus:border-accent rounded-[var(--radius)] pl-8 pr-2 py-1.5 text-[12px] text-fg placeholder:text-fg-faint outline-none transition-colors"
            />
          </div>
        </div>

        <div className="flex-1 overflow-y-auto py-1">
          {Object.keys(groupedChats).length === 0 ? (
            <p className="px-4 py-4 text-[13px] text-fg-muted text-left">
              No conversations yet. Ask your first question below.
            </p>
          ) : (
            Object.entries(groupedChats).map(([group, chats]) => (
              <div key={group} className="mb-2">
                <div className="px-3 py-1.5 text-[11px] text-fg-faint uppercase tracking-wider font-medium">
                  {group}
                </div>
                {chats.map((chat) => {
                  const isSelected = selectedChat === chat.id;
                  return (
                    <div
                      key={chat.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => {
                        setSelectedChat(chat.id);
                        navigate(`/chat/${chat.id}`);
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' || e.key === ' ') {
                          setSelectedChat(chat.id);
                          navigate(`/chat/${chat.id}`);
                        }
                      }}
                      className={cn(
                        'w-full text-left px-2.5 py-2 flex items-center gap-2 group relative cursor-pointer rounded-[var(--radius-sm)]',
                        'hover:bg-surface-raised transition-colors',
                        isSelected ? 'bg-surface-raised text-fg font-medium' : 'text-fg-muted'
                      )}
                    >
                      {isSelected ? (
                        <div className="w-[3px] h-4 bg-accent rounded-full shrink-0" />
                      ) : (
                        <div className="w-[3px] h-4 shrink-0" />
                      )}
                      <MessageSquare size={14} strokeWidth={1.5} className={cn("shrink-0", isSelected ? "text-accent" : "text-fg-faint")} />
                      <span className="flex-1 text-[13px] truncate min-w-0">
                        {truncate(chat.title, 24)}
                      </span>
                      <span className="text-[11px] text-fg-faint shrink-0 ml-1">
                        {formatChatTime(chat.updated_at || chat.created_at)}
                      </span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (confirm('Delete this chat?')) deleteChat.mutate(chat.id);
                        }}
                        className="opacity-0 group-hover:opacity-100 p-1 text-fg-faint hover:text-danger transition-all shrink-0"
                      >
                        <Trash2 size={12} strokeWidth={1.5} />
                      </button>
                    </div>
                  );
                })}
              </div>
            ))
          )}
        </div>
      </div>

      {/* Thread & Composer Pane */}
      <div className="flex-1 flex flex-col min-w-0 relative">
        {/* Messages */}
        <div 
          className="flex-1 overflow-y-auto" 
          ref={scrollContainerRef}
          onScroll={handleScroll}
        >
          <div className="mx-auto w-full max-w-[720px] px-4 sm:px-6 py-6 pb-32">
            {messages.length === 0 ? (
              <ChatEmptyState onSelect={(q) => {
                setInputValue(q);
                textareaRef.current?.focus();
              }} />
            ) : (
              <div className="space-y-6">
                {messages.map((msg: any) => (
                  <MessageBlock 
                    key={msg.id} 
                    message={msg} 
                    stream={msg._localPhase === 'pending_or_streaming' ? stream : undefined}
                    onRetry={() => {
                      // Retry the last user message
                      const lastUserMsg = [...messages].reverse().find(m => m.role === 'user');
                      if (lastUserMsg) handleSend(lastUserMsg.content);
                    }}
                  />
                ))}
              </div>
            )}
            <div ref={messagesEndRef} />
          </div>
        </div>
        
        {showScrollBottom && (
          <div className="absolute bottom-28 left-1/2 -translate-x-1/2 z-10">
            <Button 
              variant="secondary" 
              size="sm" 
              className="rounded-full shadow-lg border border-border bg-surface text-fg-muted"
              onClick={() => {
                scrollToBottom();
                setUserScrolledUp(false);
              }}
            >
              <ArrowUp size={14} className="mr-2" /> Jump to latest
            </Button>
          </div>
        )}

        {/* Composer (Sticky Bottom) */}
        <div className="absolute bottom-0 w-full bg-gradient-to-t from-bg via-bg/95 to-transparent pt-8 pb-[calc(1.25rem+env(safe-area-inset-bottom))] px-4 sm:px-6">
          <div className="mx-auto w-full max-w-[720px]">
            <div className="flex flex-col gap-2 rounded-[14px] border border-accent bg-surface p-3 shadow-lg shadow-accent/5 focus-within:ring-2 focus-within:ring-accent/20 transition-all">
              <textarea
                ref={textareaRef}
                value={inputValue}
                onChange={handleInput}
                onKeyDown={handleKeyDown}
                placeholder="Ask your documents anything..."
                rows={1}
                className={cn(
                  'w-full bg-transparent text-[14px] text-fg placeholder:text-fg-faint',
                  'resize-none outline-none min-h-[28px]',
                  'py-1 px-1'
                )}
                style={{ fontFamily: 'var(--font-sans)' }}
              />
              
              <div className="flex items-center justify-between px-1 pt-1">
                <div className="flex items-center gap-2">
                  <button className="p-1 text-fg-faint hover:text-fg transition-colors">
                    <Paperclip size={16} strokeWidth={1.5} />
                  </button>
                  {scope.type !== 'all' ? (
                    <ScopeChip label={scope.label} />
                  ) : (
                    <button className="text-[12px] text-fg-muted hover:text-fg bg-surface-raised border border-border px-2.5 py-1 rounded-full flex items-center gap-1 transition-colors">
                      All documents ▾
                    </button>
                  )}
                </div>
                
                <div className="flex items-center gap-3">
                  <span className="text-[11px] text-fg-faint hidden sm:inline-block">
                    Press Enter to send · Shift+Enter for new line
                  </span>
                  
                  {stream.phase === 'streaming' || stream.phase === 'pending' ? (
                    <Button 
                      variant="primary" 
                      onClick={stream.stop} 
                      aria-label="Stop"
                      className="h-8 w-8 p-0 flex items-center justify-center rounded-[10px] bg-accent text-accent-fg"
                    >
                      <Square size={13} strokeWidth={2} />
                    </Button>
                  ) : (
                    <button
                      onClick={() => handleSend()}
                      disabled={!inputValue.trim()}
                      aria-label="Send"
                      className={cn(
                        "h-8 w-8 p-0 flex items-center justify-center rounded-[10px] transition-all",
                        inputValue.trim()
                          ? "bg-accent text-accent-fg hover:bg-accent/90 shadow-md shadow-accent/30 cursor-pointer"
                          : "bg-surface-raised text-fg-faint border border-border cursor-not-allowed"
                      )}
                    >
                      <Send size={15} strokeWidth={2} />
                    </button>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Message Block ───────────────────────────────────────────────
function MessageBlock({ message, stream, onRetry }: { message: any; stream?: any, onRetry?: () => void }) {
  const [showActions, setShowActions] = useState(false);

  // User Message
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] px-4 py-2.5 rounded-[10px] bg-surface-sunken text-[14px] text-fg">
          {message.content}
        </div>
      </div>
    );
  }

  // Assistant Message (Streaming)
  if (stream) {
    if (stream.phase === 'pending') {
      return (
        <div className="group relative">
          <div className="text-[14px] text-fg-faint mb-2 flex items-center gap-2" style={{ fontFamily: 'var(--font-sans)' }}>
            <div className="w-4 h-4 rounded-full border-2 border-accent border-t-transparent animate-spin" />
            {stream.status || 'Thinking…'}
            <div className="w-1.5 h-4 bg-accent animate-pulse" />
          </div>
        </div>
      );
    }
    
    if (stream.phase === 'streaming') {
      return (
        <div className="group relative">
          {stream.status && (
            <div className="text-[12px] text-fg-faint mb-2 flex items-center gap-1.5" style={{ fontFamily: 'var(--font-mono)' }}>
              <div className="w-1.5 h-1.5 rounded-full bg-accent animate-pulse" />
              {stream.status}
            </div>
          )}
          <div className="prose-custom text-[16px] md:text-[17px] leading-relaxed text-fg" style={{ fontFamily: 'var(--font-serif)' }}>
             <ReactMarkdown remarkPlugins={[remarkGfm]}>{stream.content}</ReactMarkdown>
             <span className="inline-block w-1.5 h-4 bg-accent ml-1 animate-pulse align-text-bottom" />
          </div>
        </div>
      );
    }
    return null;
  }

  // Assistant Message (Complete / Terminal States)
  const isError = message._localPhase === 'error';
  const isNoSupport = message._localPhase === 'no_support';
  const isCancelled = message._localPhase === 'cancelled';

  if (isError) {
    return (
      <div className="bg-red-500/10 border border-red-500/20 rounded-[10px] p-4 my-2">
        <div className="flex items-start gap-3">
          <AlertCircle size={18} className="text-red-500 mt-0.5 shrink-0" />
          <div>
            <p className="text-[14px] font-medium text-red-500">Error</p>
            <p className="text-[14px] text-red-400 mt-1">{message._localError || message.content}</p>
            <div className="mt-3 flex gap-2">
              <Button size="sm" variant="outline" onClick={onRetry}>Retry</Button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  if (isNoSupport) {
    return (
      <div className="bg-surface-sunken rounded-[10px] p-5 my-2">
        <p className="text-[15px] font-medium text-fg mb-1">No supporting passages found</p>
        <p className="text-[14px] text-fg-muted">{message.content}</p>
      </div>
    );
  }
  
  if (isCancelled) {
    return (
      <div className="group relative">
        <div className="prose-custom text-[16px] md:text-[17px] leading-relaxed text-fg opacity-80" style={{ fontFamily: 'var(--font-serif)' }}>
           <ReactMarkdown remarkPlugins={[remarkGfm]}>{message.content}</ReactMarkdown>
        </div>
        <div className="mt-2 flex items-center gap-2">
          <span className="text-[12px] text-fg-muted font-medium bg-surface-raised px-2 py-1 rounded">Stopped.</span>
          <Button size="sm" variant="ghost" onClick={onRetry} className="h-6 text-[12px]">Regenerate</Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className="group relative"
      onMouseEnter={() => setShowActions(true)}
      onMouseLeave={() => setShowActions(false)}
    >
      {/* Assistant answer — serif prose */}
      <div
        className="prose-custom text-[16px] md:text-[17px] leading-relaxed text-fg"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {message.content}
        </ReactMarkdown>
      </div>

      {/* Citations */}
      {message.citations && message.citations.length > 0 && (
        <SourceStrip citations={message.citations} />
      )}
      
      {/* Suggested Questions */}
      {message._localSuggested && message._localSuggested.length > 0 && (
        <div className="space-y-1.5 mt-5">
          {message._localSuggested.map((q: string) => (
            <button
              key={q}
              onClick={() => {
                 // The parent would need to handle this, but for now we just show it
                 // We could pass onSelectSuggestion down
              }}
              className="block text-left text-[14px] text-fg-muted hover:text-accent transition-colors"
            >
              ↳ {q}
            </button>
          ))}
        </div>
      )}

      {/* Message actions */}
      {showActions && (
        <div className="absolute -top-10 right-0 flex items-center gap-1 p-1 rounded-[var(--radius)] border border-border bg-surface shadow-sm">
          {[
            { icon: Copy, label: 'Copy' },
            { icon: RefreshCw, label: 'Regenerate', onClick: onRetry },
            { icon: ThumbsUp, label: 'Good' },
            { icon: ThumbsDown, label: 'Bad' },
          ].map((action) => (
            <button
              key={action.label}
              onClick={action.onClick}
              className="p-1.5 rounded-[var(--radius-sm)] text-fg-faint hover:text-fg hover:bg-surface-raised transition-colors"
              title={action.label}
            >
              <action.icon size={14} strokeWidth={1.5} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Source Strip ─────────────────────────────────────────────────
function SourceStrip({ citations }: { citations: Citation[] }) {
  return (
    <div className="flex gap-2 mt-4 overflow-x-auto pb-2 scrollbar-hide">
      {citations.map((cit, i) => (
        <div
          key={cit.id ?? i}
          className="flex items-center gap-2 px-3 py-1.5 rounded-[var(--radius)] border border-border bg-surface hover:bg-surface-raised transition-colors cursor-pointer shrink-0"
        >
          <span
            className="text-[11px] font-semibold text-accent bg-accent/10 px-1 rounded"
            style={{ fontFamily: 'var(--font-mono)' }}
          >
            {i + 1}
          </span>
          <span className="text-[13px] text-fg font-medium truncate max-w-[150px]">
            {cit.filename}
          </span>
          {cit.page_number && (
            <span
              className="text-[11px] text-fg-faint"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              p.{cit.page_number}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Chat Empty State ────────────────────────────────────────────
function ChatEmptyState({ onSelect }: { onSelect: (q: string) => void }) {
  const featureCards = [
    {
      icon: FileText,
      title: 'Summarize this document',
      desc: 'Get key insights and main points',
      query: 'Summarize the uploaded document with key takeaways.',
    },
    {
      icon: Search,
      title: 'Find specific information',
      desc: 'Search across all your documents',
      query: 'Find the most important clauses and terms across all documents.',
    },
    {
      icon: GitCompareArrows,
      title: 'Compare documents',
      desc: 'Analyze differences and changes',
      query: 'Compare the key differences between the uploaded documents.',
    },
    {
      icon: Lightbulb,
      title: 'Analyze data',
      desc: 'Extract insights from your files',
      query: 'Analyze the data and extract key insights from the uploaded files.',
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center py-10 md:py-16">
      {/* Welcome badge */}
      <div className="flex items-center gap-2 mb-4">
        <div className="w-5 h-[3px] bg-accent rounded-full" />
        <span className="text-[13px] text-fg-muted font-medium">Welcome to Knowledge AI</span>
      </div>

      {/* Big heading */}
      <h1 className="text-[38px] md:text-[46px] font-bold text-fg tracking-tight leading-tight text-center">
        Ask your documents
      </h1>
      <h1 className="text-[38px] md:text-[46px] font-bold text-accent tracking-tight leading-tight text-center mb-3">
        anything.
      </h1>

      <p className="text-[14px] text-fg-muted mb-8 max-w-lg text-center leading-relaxed">
        Get precise answers backed by citations from your uploaded files.
      </p>

      {/* Feature Cards Grid */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 max-w-[620px] w-full">
        {featureCards.map((card) => (
          <button
            key={card.title}
            onClick={() => onSelect(card.query)}
            className="text-left p-3.5 rounded-[12px] border border-border bg-surface hover:bg-surface-raised hover:border-fg-faint/30 transition-all group flex items-start gap-3"
          >
            <div className="mt-0.5 text-accent shrink-0">
              <card.icon size={18} strokeWidth={1.75} />
            </div>
            <div className="min-w-0">
              <div className="text-[13.5px] text-fg font-medium group-hover:text-accent transition-colors leading-snug">
                {card.title}
              </div>
              <div className="text-[12px] text-fg-faint mt-0.5 leading-snug">
                {card.desc}
              </div>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}
