/**
 * Knowledge AI — Search Page
 * Hybrid retrieval across indexed documents with BM25 + dense vector embeddings,
 * BGE reranking score visualization, keyword highlighting, collection filters, and URL sync.
 */
import { useState, useEffect, useMemo, useCallback } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Search,
  SlidersHorizontal,
  X,
  FileText,
  Copy,
  Check,
  MessageSquare,
  Sparkles,
  ExternalLink,
  ChevronDown,
  Filter,
} from 'lucide-react';
import { searchApi, collectionsApi, documentsApi } from '@/lib/api/endpoints';
import { PageHeader, EmptyState, ErrorState, ScoreBar, FileGlyph, Skeleton } from '@/components/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useScope } from '@/hooks/useScope';
import { cn } from '@/lib/utils';
import type { SearchResult } from '@/types/api';
import { toast } from 'sonner';

/**
 * XSS-safe keyword highlighter that splits by regex and returns React elements
 */
function HighlightedSnippet({ text, query }: { text: string; query: string }) {
  if (!query.trim()) return <span>{text}</span>;

  const terms = query
    .trim()
    .split(/\s+/)
    .filter((t) => t.length > 1)
    .map((t) => t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));

  if (terms.length === 0) return <span>{text}</span>;

  const regex = new RegExp(`(${terms.join('|')})`, 'gi');
  const parts = text.split(regex);

  return (
    <span>
      {parts.map((part, i) =>
        regex.test(part) ? (
          <mark
            key={i}
            className="bg-accent/20 text-accent font-medium rounded-[2px] px-0.5"
          >
            {part}
          </mark>
        ) : (
          part
        )
      )}
    </span>
  );
}

export default function SearchPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { setScope } = useScope();

  // Query and parameters from URL
  const initialQuery = searchParams.get('q') || '';
  const initialTopK = parseInt(searchParams.get('k') || '10', 10);
  const initialCollection = searchParams.get('collection') || '';

  const [queryInput, setQueryInput] = useState(initialQuery);
  const [activeQuery, setActiveQuery] = useState(initialQuery);
  const [topK, setTopK] = useState(initialTopK);
  const [selectedCollectionId, setSelectedCollectionId] = useState(initialCollection);
  const [selectedFileType, setSelectedFileType] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Recent searches stored in localStorage
  const [recentSearches, setRecentSearches] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem('knowledge_ai_recent_searches') || '[]');
    } catch {
      return [];
    }
  });

  // Fetch collections for filtering
  const { data: collections = [] } = useQuery({
    queryKey: ['collections'],
    queryFn: () => collectionsApi.list(),
  });

  // Fetch documents for suggestions
  const { data: recentDocsData } = useQuery({
    queryKey: ['documents', { page_size: 5 }],
    queryFn: () => documentsApi.list({ page_size: 5 }),
  });

  // Synchronize URL parameters
  const updateUrlParams = useCallback(
    (q: string, k: number, col: string) => {
      const params = new URLSearchParams();
      if (q.trim()) params.set('q', q.trim());
      if (k !== 10) params.set('k', k.toString());
      if (col) params.set('collection', col);
      setSearchParams(params, { replace: true });
    },
    [setSearchParams]
  );

  // Search API query
  const {
    data: searchData,
    isLoading,
    isFetching,
    error,
    refetch,
  } = useQuery({
    queryKey: ['search', activeQuery, selectedCollectionId, topK],
    queryFn: () =>
      searchApi.hybrid({
        query: activeQuery,
        collection_id: selectedCollectionId || undefined,
        top_k: topK,
      }),
    enabled: activeQuery.trim().length > 0,
    staleTime: 60000,
  });

  // Trigger search execution
  const executeSearch = (q: string) => {
    const trimmed = q.trim();
    if (!trimmed) return;

    setActiveQuery(trimmed);
    updateUrlParams(trimmed, topK, selectedCollectionId);

    // Save to recent searches
    setRecentSearches((prev) => {
      const updated = [trimmed, ...prev.filter((item) => item.toLowerCase() !== trimmed.toLowerCase())].slice(0, 8);
      localStorage.setItem('knowledge_ai_recent_searches', JSON.stringify(updated));
      return updated;
    });
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      executeSearch(queryInput);
    }
  };

  const clearSearch = () => {
    setQueryInput('');
    setActiveQuery('');
    updateUrlParams('', topK, selectedCollectionId);
  };

  const handleCopyCitation = (result: SearchResult) => {
    const citation = `"${result.content.trim()}" — ${result.filename}${result.page_number ? ` (p. ${result.page_number})` : ''}`;
    navigator.clipboard.writeText(citation);
    setCopiedId(result.chunk_id);
    toast.success('Citation copied to clipboard');
    setTimeout(() => setCopiedId(null), 2000);
  };

  const handleAskAboutSnippet = (result: SearchResult) => {
    if (result.document_id) {
      setScope({
        type: 'documents',
        id: result.document_id,
        label: result.filename,
      });
    }
    navigate('/chat');
  };

  // Filter results client-side by file type if specified
  const filteredResults = useMemo(() => {
    if (!searchData?.results) return [];
    if (selectedFileType === 'all') return searchData.results;
    return searchData.results.filter((r) => {
      const ext = r.filename.split('.').pop()?.toLowerCase();
      return ext === selectedFileType;
    });
  }, [searchData, selectedFileType]);

  // Suggested queries from documents
  const suggestedQueries = useMemo(() => {
    const docs = recentDocsData?.documents ?? [];
    if (docs.length === 0) return ['revenue growth', 'quarterly summary', 'policy guidelines', 'security requirements'];
    return docs.map((d: { original_filename: string }) => `overview of ${d.original_filename.replace(/\.[^/.]+$/, '')}`);
  }, [recentDocsData]);

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <PageHeader
        title="Search Knowledge"
        subtitle="Hybrid dense vector + BM25 keyword search with neural cross-encoder reranking."
      />

      {/* Main Search Bar & Settings */}
      <div className="space-y-3">
        <div className="flex flex-col sm:flex-row gap-2.5">
          <div className="relative flex-1">
            <Search className="absolute left-3.5 top-3 text-fg-faint" size={17} />
            <input
              type="text"
              value={queryInput}
              onChange={(e) => setQueryInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search concepts, clauses, numbers, or questions..."
              className="w-full h-11 pl-10 pr-10 rounded-[var(--radius-md)] border border-border bg-surface text-[14px] text-fg focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent"
            />
            {queryInput && (
              <button
                onClick={clearSearch}
                className="absolute right-3.5 top-3 text-fg-faint hover:text-fg"
              >
                <X size={16} />
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            {/* Top-K Select */}
            <select
              value={topK}
              onChange={(e) => {
                const k = Number(e.target.value);
                setTopK(k);
                if (activeQuery) updateUrlParams(activeQuery, k, selectedCollectionId);
              }}
              className="h-11 px-3 rounded-[var(--radius-md)] border border-border bg-surface text-[13px] text-fg font-mono focus:outline-none focus:border-accent"
              title="Number of results (Top-K)"
            >
              <option value={5}>Top 5</option>
              <option value={10}>Top 10</option>
              <option value={20}>Top 20</option>
              <option value={50}>Top 50</option>
            </select>

            <Button
              variant="primary"
              size="md"
              onClick={() => executeSearch(queryInput)}
              disabled={!queryInput.trim() || isFetching}
              className="h-11 px-5 gap-2"
            >
              <Search size={15} />
              Search
            </Button>
          </div>
        </div>

        {/* Filter Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3 pt-1 text-[13px]">
          <div className="flex flex-wrap items-center gap-3">
            {/* Collection Filter */}
            <div className="flex items-center gap-1.5 text-fg-muted">
              <Filter size={13} className="text-fg-faint" />
              <span>Collection:</span>
              <select
                value={selectedCollectionId}
                onChange={(e) => {
                  setSelectedCollectionId(e.target.value);
                  if (activeQuery) updateUrlParams(activeQuery, topK, e.target.value);
                }}
                className="h-7 px-2 rounded-[var(--radius-sm)] border border-border bg-surface-raised text-[12px] text-fg focus:outline-none focus:border-accent"
              >
                <option value="">All Collections</option>
                {collections.map((col) => (
                  <option key={col.id} value={col.id}>
                    {col.name}
                  </option>
                ))}
              </select>
            </div>

            {/* File Type Filter Chips */}
            <div className="flex items-center gap-1">
              {['all', 'pdf', 'docx', 'txt', 'csv', 'xlsx'].map((type) => (
                <button
                  key={type}
                  onClick={() => setSelectedFileType(type)}
                  className={cn(
                    'h-6 px-2 rounded-[var(--radius-sm)] text-[11px] font-mono uppercase transition-colors',
                    selectedFileType === type
                      ? 'bg-accent text-accent-fg font-medium'
                      : 'bg-surface border border-border text-fg-muted hover:text-fg'
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {searchData && (
            <span className="text-[12px] font-mono text-fg-faint">
              {filteredResults.length} matches in {searchData.search_time_ms}ms
            </span>
          )}
        </div>
      </div>

      {/* Results or Empty/Initial States */}
      {isLoading ? (
        <div className="space-y-4 pt-2">
          {[...Array(3)].map((_, i) => (
            <div key={i} className="p-4 border border-border rounded-[var(--radius-md)] bg-surface space-y-3">
              <div className="flex items-center justify-between">
                <Skeleton className="h-4 w-48" />
                <Skeleton className="h-4 w-20" />
              </div>
              <Skeleton className="h-16 w-full" />
            </div>
          ))}
        </div>
      ) : error ? (
        <ErrorState
          message="Failed to perform hybrid search"
          detail={(error as any)?.message || 'An unexpected error occurred while communicating with the retrieval engine.'}
          onRetry={() => refetch()}
        />
      ) : activeQuery && filteredResults.length > 0 ? (
        <div className="space-y-3 pt-2">
          {filteredResults.map((result, idx) => (
            <div
              key={result.chunk_id || idx}
              className="group border border-border rounded-[var(--radius-md)] p-4 bg-surface hover:border-accent/40 hover:bg-surface-raised transition-all"
            >
              {/* Result Header */}
              <div className="flex items-center justify-between gap-3 mb-2 pb-2 border-b border-border-subtle">
                <div className="flex items-center gap-2 min-w-0">
                  <FileGlyph type={result.filename.split('.').pop() || 'txt'} size={15} />
                  <span className="text-[13px] font-medium text-fg truncate">
                    {result.filename}
                  </span>
                  {result.page_number && (
                    <span className="text-[11px] font-mono text-fg-faint bg-surface-sunken px-1.5 py-0.5 rounded">
                      Page {result.page_number}
                    </span>
                  )}
                </div>

                {/* Score bar */}
                <div className="flex items-center gap-3 shrink-0">
                  <span className="text-[11px] font-mono text-fg-faint hidden sm:inline">
                    Score:
                  </span>
                  <ScoreBar score={result.relevance_score} />
                </div>
              </div>

              {/* Passage Snippet with Highlight */}
              <p
                className="text-[14px] text-fg leading-relaxed whitespace-pre-line"
                style={{ fontFamily: 'var(--font-serif)' }}
              >
                <HighlightedSnippet text={result.content} query={activeQuery} />
              </p>

              {/* Action Buttons */}
              <div className="flex items-center justify-end gap-2 mt-3 pt-2 border-t border-border-subtle">
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => handleCopyCitation(result)}
                  className="h-7 px-2 text-[12px] text-fg-muted gap-1"
                >
                  {copiedId === result.chunk_id ? <Check size={12} className="text-success" /> : <Copy size={12} />}
                  <span>{copiedId === result.chunk_id ? 'Copied' : 'Copy citation'}</span>
                </Button>

                <Button
                  variant="secondary"
                  size="sm"
                  onClick={() => handleAskAboutSnippet(result)}
                  className="h-7 px-2.5 text-[12px] gap-1"
                >
                  <MessageSquare size={12} />
                  <span>Ask in Chat</span>
                </Button>
              </div>
            </div>
          ))}
        </div>
      ) : activeQuery && filteredResults.length === 0 ? (
        <EmptyState
          title={`No results found for "${activeQuery}"`}
          description="Try broader keywords, removing filters, or indexing more documents."
          action={
            <Button variant="secondary" size="sm" onClick={clearSearch}>
              Clear Search Query
            </Button>
          }
        />
      ) : (
        /* Initial State: Recent searches & Suggested topics */
        <div className="space-y-8 pt-4">
          {recentSearches.length > 0 && (
            <div>
              <h3 className="text-[13px] font-medium text-fg-muted mb-2.5">Recent searches</h3>
              <div className="flex flex-wrap gap-2">
                {recentSearches.map((term, i) => (
                  <button
                    key={i}
                    onClick={() => {
                      setQueryInput(term);
                      executeSearch(term);
                    }}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-[var(--radius-sm)] border border-border bg-surface hover:bg-surface-raised text-[12px] text-fg transition-colors"
                  >
                    <Search size={11} className="text-fg-faint" />
                    <span>{term}</span>
                  </button>
                ))}
              </div>
            </div>
          )}

          <div>
            <div className="flex items-center gap-1.5 mb-2.5">
              <Sparkles size={14} className="text-accent" />
              <h3 className="text-[13px] font-medium text-fg">Suggested searches based on your knowledge base</h3>
            </div>
            <div className="flex flex-wrap gap-2">
              {suggestedQueries.map((query: string, i: number) => (
                <button
                  key={i}
                  onClick={() => {
                    setQueryInput(query);
                    executeSearch(query);
                  }}
                  className="px-3 py-1.5 rounded-[var(--radius-sm)] border border-border bg-surface hover:border-accent/40 text-[12px] text-fg-muted hover:text-fg transition-colors"
                >
                  {query}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
