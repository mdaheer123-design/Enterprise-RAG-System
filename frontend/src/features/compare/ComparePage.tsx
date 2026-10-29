/**
 * Knowledge AI — Document Comparison Page
 * Compare two documents side-by-side, view AI-generated summary,
 * structured clause diffs (added/removed/modified), and export comparison report.
 */
import { useState, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  GitCompareArrows,
  ArrowRightLeft,
  FileText,
  Printer,
  Clock,
  CheckCircle2,
  AlertCircle,
  AlertTriangle,
  ChevronDown,
  Layers,
  Sparkles,
  Info,
} from 'lucide-react';
import { documentsApi, compareApi } from '@/lib/api/endpoints';
import { PageHeader, EmptyState, ErrorState, FileGlyph, Skeleton } from '@/components/shared';
import { Button } from '@/components/ui/Button';
import { formatBytes, relativeTime, cn } from '@/lib/utils';
import type { ComparisonResponse, Document } from '@/types/api';
import { toast } from 'sonner';

export default function ComparePage() {
  const queryClient = useQueryClient();

  const [docAId, setDocAId] = useState<string>('');
  const [docBId, setDocBId] = useState<string>('');
  const [currentResult, setCurrentResult] = useState<ComparisonResponse | null>(null);
  const [comparisonError, setComparisonError] = useState<string | null>(null);
  const [filterType, setFilterType] = useState<'all' | 'added' | 'removed' | 'modified'>('all');

  // Track active request to prevent out-of-order responses from overwriting newer selections
  const activeRequestRef = useRef<{ aId: string; bId: string } | null>(null);

  // Fetch available documents
  const { data: documentsData, isLoading: docsLoading } = useQuery({
    queryKey: ['documents', { page_size: 100 }],
    queryFn: () => documentsApi.list({ page_size: 100 }),
  });

  // Fetch recent comparisons history
  const { data: recentComparisons = [], isLoading: historyLoading } = useQuery({
    queryKey: ['comparisons'],
    queryFn: () => compareApi.list(),
  });

  // Comparison mutation with active ID tracking & race condition prevention
  const compareMutation = useMutation({
    mutationFn: async ({ aId, bId }: { aId: string; bId: string }) => {
      activeRequestRef.current = { aId, bId };
      return compareApi.compare(aId, bId);
    },
    onSuccess: (data, variables) => {
      // Guard: Only display if the response belongs to the currently active selection
      if (
        variables.aId === docAId &&
        variables.bId === docBId &&
        activeRequestRef.current?.aId === variables.aId &&
        activeRequestRef.current?.bId === variables.bId
      ) {
        setCurrentResult(data);
        setComparisonError(null);
        queryClient.invalidateQueries({ queryKey: ['comparisons'] });
        toast.success('Document comparison complete');
      }
    },
    onError: (err: any, variables) => {
      // Only set error if it belongs to the current request
      if (variables.aId === docAId && variables.bId === docBId) {
        setCurrentResult(null);
        setComparisonError(err.message || 'Failed to compare documents');
        toast.error(err.message || 'Failed to compare documents');
      }
    },
  });

  const documents = documentsData?.documents ?? [];

  // Dropdown selection handlers: immediately invalidate stale results
  const handleSelectDocA = (newId: string) => {
    setDocAId(newId);
    setCurrentResult(null);
    setComparisonError(null);
  };

  const handleSelectDocB = (newId: string) => {
    setDocBId(newId);
    setCurrentResult(null);
    setComparisonError(null);
  };

  // Swap Document A and Document B: immediately clear stale results
  const handleSwap = () => {
    const nextA = docBId;
    const nextB = docAId;
    setDocAId(nextA);
    setDocBId(nextB);
    setCurrentResult(null);
    setComparisonError(null);
  };

  // Run comparison
  const handleRunCompare = () => {
    if (!docAId || !docBId || docAId === docBId || compareMutation.isPending) return;
    setComparisonError(null);
    setCurrentResult(null);
    compareMutation.mutate({ aId: docAId, bId: docBId });
  };

  // Select historical comparison: synchronize dropdowns AND results
  const handleSelectHistoryItem = (item: ComparisonResponse) => {
    const aId = item.document_a_id || item.document_a.id;
    const bId = item.document_b_id || item.document_b.id;
    setDocAId(aId);
    setDocBId(bId);
    setCurrentResult(item);
    setComparisonError(null);
  };

  // Export / Print PDF report
  const handlePrint = () => {
    window.print();
  };

  const docA = documents.find((d: Document) => d.id === docAId);
  const docB = documents.find((d: Document) => d.id === docBId);

  // Source of truth check: only display result if it matches current selection
  const isResultMatching = Boolean(
    currentResult &&
      ((currentResult.document_a_id === docAId && currentResult.document_b_id === docBId) ||
        (currentResult.document_a.id === docAId && currentResult.document_b.id === docBId))
  );

  const verifiedResult = isResultMatching ? currentResult : null;

  const diffs = verifiedResult?.detailed_changes?.length
    ? verifiedResult.detailed_changes
    : verifiedResult?.differences ?? [];

  const filteredDiffs = filterType === 'all' ? diffs : diffs.filter((d) => d.type === filterType);

  const addedCount = verifiedResult?.added_count ?? diffs.filter((d) => d.type === 'added').length;
  const removedCount = verifiedResult?.removed_count ?? diffs.filter((d) => d.type === 'removed').length;
  const modifiedCount = verifiedResult?.modified_count ?? diffs.filter((d) => d.type === 'modified').length;

  const isStructuralEntity = verifiedResult?.comparison_mode === 'structural_entity';
  const isIncompatible = verifiedResult?.comparison_status === 'incompatible' || verifiedResult?.comparison_mode === 'cross_modal_incompatible';

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-8 print:p-0 print:max-w-none">
      {/* Page Header (hidden during print) */}
      <div className="print:hidden">
        <PageHeader
          title="Document Comparison"
          subtitle="Semantic clause-level and entity comparison with AI difference extraction and side-by-side verification."
        />
      </div>

      {/* Selector Box */}
      <div className="p-5 border border-border rounded-[var(--radius-md)] bg-surface space-y-4 print:hidden">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4 items-center">
          {/* Document A Selector */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-fg flex items-center justify-between">
              <span>Original Document (Version A)</span>
              {docA && <span className="text-[11px] font-mono text-fg-faint">{formatBytes(docA.file_size)}</span>}
            </label>
            <select
              value={docAId}
              onChange={(e) => handleSelectDocA(e.target.value)}
              className="w-full h-10 px-3 rounded-[var(--radius-sm)] border border-border bg-surface-raised text-[13px] text-fg focus:outline-none focus:border-accent"
            >
              <option value="">Select original document...</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id} disabled={doc.id === docBId}>
                  {doc.original_filename} ({doc.file_type.toUpperCase()})
                </option>
              ))}
            </select>
          </div>

          {/* Document B Selector */}
          <div className="space-y-1.5">
            <label className="text-[12px] font-medium text-fg flex items-center justify-between">
              <span>Revised Document (Version B)</span>
              {docB && <span className="text-[11px] font-mono text-fg-faint">{formatBytes(docB.file_size)}</span>}
            </label>
            <select
              value={docBId}
              onChange={(e) => handleSelectDocB(e.target.value)}
              className="w-full h-10 px-3 rounded-[var(--radius-sm)] border border-border bg-surface-raised text-[13px] text-fg focus:outline-none focus:border-accent"
            >
              <option value="">Select revised document...</option>
              {documents.map((doc) => (
                <option key={doc.id} value={doc.id} disabled={doc.id === docAId}>
                  {doc.original_filename} ({doc.file_type.toUpperCase()})
                </option>
              ))}
            </select>
          </div>
        </div>

        {/* Actions Row */}
        <div className="flex items-center justify-between pt-2 border-t border-border">
          <Button
            variant="ghost"
            size="sm"
            onClick={handleSwap}
            disabled={!docAId || !docBId || compareMutation.isPending}
            className="gap-1.5 text-fg-muted"
          >
            <ArrowRightLeft size={13} />
            Swap Documents
          </Button>

          <Button
            variant="primary"
            size="md"
            disabled={!docAId || !docBId || docAId === docBId || compareMutation.isPending}
            onClick={handleRunCompare}
            className="gap-2 px-5"
          >
            <GitCompareArrows size={16} />
            {compareMutation.isPending ? 'Analyzing differences...' : 'Compare Documents'}
          </Button>
        </div>
      </div>

      {/* Comparison Loading State */}
      {compareMutation.isPending && (
        <div className="p-12 border border-border rounded-[var(--radius-md)] bg-surface text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-accent-subtle text-accent flex items-center justify-center mx-auto animate-spin">
            <GitCompareArrows size={20} />
          </div>
          <h3 className="text-[16px] font-medium text-fg" style={{ fontFamily: 'var(--font-serif)' }}>
            Comparing document contents...
          </h3>
          <p className="text-[13px] text-fg-muted max-w-[480px] mx-auto">
            Inspecting structures of <span className="text-fg font-medium">{docA?.original_filename}</span> and{' '}
            <span className="text-fg font-medium">{docB?.original_filename}</span>, verifying entity alignment, and calculating differences.
          </p>
        </div>
      )}

      {/* Comparison Error State */}
      {comparisonError && !compareMutation.isPending && (
        <div className="p-5 border border-danger/30 rounded-[var(--radius-md)] bg-danger/10 space-y-3">
          <div className="flex items-center gap-2 text-danger">
            <AlertCircle size={18} />
            <h3 className="text-[14px] font-medium">Comparison Failed</h3>
          </div>
          <p className="text-[13px] text-danger/90">{comparisonError}</p>
          <Button variant="secondary" size="sm" onClick={handleRunCompare} className="gap-1.5 mt-2">
            Try Again
          </Button>
        </div>
      )}

      {/* Prompt to Run Compare when documents are selected but not yet analyzed */}
      {!verifiedResult && !compareMutation.isPending && !comparisonError && docAId && docBId && docAId !== docBId && (
        <div className="p-8 border border-border/80 border-dashed rounded-[var(--radius-md)] bg-surface/50 text-center space-y-3">
          <div className="w-10 h-10 rounded-full bg-surface-raised flex items-center justify-center mx-auto text-fg-muted">
            <Layers size={18} />
          </div>
          <h3 className="text-[15px] font-medium text-fg">Ready to Compare</h3>
          <p className="text-[13px] text-fg-muted max-w-[440px] mx-auto">
            Selected <strong className="text-fg font-medium">{docA?.original_filename}</strong> and{' '}
            <strong className="text-fg font-medium">{docB?.original_filename}</strong>. Click{' '}
            <strong>Compare Documents</strong> above to analyze differences.
          </p>
          <Button variant="primary" size="sm" onClick={handleRunCompare} className="gap-2">
            <GitCompareArrows size={14} />
            Compare Now
          </Button>
        </div>
      )}

      {/* Verified Comparison Result Display */}
      {verifiedResult && !compareMutation.isPending && (
        <div className="space-y-6">
          {/* Results Summary Header */}
          <div className="p-5 border border-border rounded-[var(--radius-md)] bg-surface space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
              <div>
                <div className="flex items-center gap-2">
                  <Sparkles size={17} className="text-accent" />
                  <h2 className="text-[18px] font-medium text-fg" style={{ fontFamily: 'var(--font-serif)' }}>
                    Comparison Analysis
                  </h2>
                  {isStructuralEntity && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-amber-500/10 text-amber-500 border border-amber-500/20">
                      Structural & Entity Analysis
                    </span>
                  )}
                  {isIncompatible && (
                    <span className="px-2 py-0.5 rounded text-[11px] font-medium bg-danger/10 text-danger border border-danger/20">
                      Incompatible Documents
                    </span>
                  )}
                </div>
                <p className="text-[12px] font-mono text-fg-faint mt-1">
                  Comparing:{' '}
                  <span className="text-fg font-semibold">
                    {verifiedResult.document_a_filename || verifiedResult.document_a.original_filename}
                  </span>{' '}
                  vs{' '}
                  <span className="text-fg font-semibold">
                    {verifiedResult.document_b_filename || verifiedResult.document_b.original_filename}
                  </span>
                </p>
              </div>

              <Button variant="secondary" size="sm" onClick={handlePrint} className="gap-1.5 print:hidden">
                <Printer size={13} />
                Export PDF Report
              </Button>
            </div>

            {/* Incompatibility / Entity Mismatch Notice */}
            {(isStructuralEntity || isIncompatible) && (
              <div className="p-3.5 rounded-[var(--radius-sm)] bg-amber-500/10 border border-amber-500/20 text-[12px] text-amber-600 dark:text-amber-400 space-y-1">
                <div className="flex items-center gap-2 font-medium">
                  <Info size={14} />
                  <span>
                    {isStructuralEntity
                      ? 'Notice: Direct Row-by-Row Comparison Not Appropriate'
                      : 'Notice: Incompatible Document Types'}
                  </span>
                </div>
                <p className="text-[12px] leading-relaxed">
                  {isStructuralEntity
                    ? 'The selected files represent different entity scopes (e.g. single-table customer registry vs multi-entity relational workbook with Orders and Products). Row-level diffing has been superseded by structural and schema entity analysis.'
                    : 'The selected files belong to different formats and domains. Direct comparison between tabular data and narrative documents cannot be performed.'}
                </p>
              </div>
            )}

            {/* AI Summary Text */}
            <div className="p-3.5 rounded-[var(--radius-sm)] bg-surface-raised border border-border text-[13px] text-fg leading-relaxed">
              <strong className="text-accent font-medium block mb-1">Executive Summary:</strong>
              {verifiedResult.summary}
            </div>

            {/* Diff Stats Counts */}
            <div className="flex items-center gap-6 pt-2 font-mono text-[12px]">
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-success" />
                <span className="text-fg font-medium">{addedCount}</span>
                <span className="text-fg-faint">{isStructuralEntity ? 'Entity Additions' : 'Added'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-danger" />
                <span className="text-fg font-medium">{removedCount}</span>
                <span className="text-fg-faint">{isStructuralEntity ? 'Entity Removals' : 'Removed'}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="w-2.5 h-2.5 rounded-full bg-warning" />
                <span className="text-fg font-medium">{modifiedCount}</span>
                <span className="text-fg-faint">{isStructuralEntity ? 'Schema / Entity Discrepancies' : 'Modified'}</span>
              </div>
            </div>
          </div>

          {/* Diffs Filter Bar (hidden on print) */}
          <div className="flex items-center justify-between gap-4 print:hidden">
            <h3 className="text-[15px] font-medium text-fg">
              {isStructuralEntity ? 'Structural & Schema Differences' : 'Detailed Clause Changes'}
            </h3>
            <div className="flex items-center gap-1">
              {(['all', 'added', 'removed', 'modified'] as const).map((type) => (
                <button
                  key={type}
                  onClick={() => setFilterType(type)}
                  className={cn(
                    'h-7 px-2.5 rounded-[var(--radius-sm)] text-[12px] font-medium capitalize transition-colors',
                    filterType === type
                      ? 'bg-accent text-accent-fg'
                      : 'bg-surface border border-border text-fg-muted hover:text-fg'
                  )}
                >
                  {type}
                </button>
              ))}
            </div>
          </div>

          {/* Differences List */}
          <div className="space-y-4">
            {filteredDiffs.length > 0 ? (
              filteredDiffs.map((diff, index) => (
                <div
                  key={index}
                  className="border border-border rounded-[var(--radius-md)] p-4 bg-surface space-y-3"
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span
                        className={cn(
                          'px-2 py-0.5 rounded-[3px] text-[11px] font-mono uppercase font-semibold',
                          diff.type === 'added' && 'bg-success/20 text-success border border-success/30',
                          diff.type === 'removed' && 'bg-danger/20 text-danger border border-danger/30',
                          diff.type === 'modified' && 'bg-warning/20 text-warning border border-warning/30'
                        )}
                      >
                        {diff.type}
                      </span>
                      <span className="text-[13px] font-medium text-fg">{diff.category}</span>
                    </div>

                    <span className="text-[11px] font-mono text-fg-faint">
                      {diff.location_a || diff.location_b || `Item #${index + 1}`}
                    </span>
                  </div>

                  <p className="text-[13px] text-fg-muted leading-relaxed">{diff.description}</p>

                  {/* Side-by-side clauses */}
                  {(diff.content_a || diff.content_b) && (
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 pt-2 font-mono text-[12px]">
                      {diff.content_a && (
                        <div className="p-3 rounded-[var(--radius-sm)] bg-danger/10 border border-danger/20 text-danger">
                          <span className="block text-[10px] text-danger/70 font-bold uppercase mb-1">
                            Original (A)
                          </span>
                          <span className="line-through">{diff.content_a}</span>
                        </div>
                      )}
                      {diff.content_b && (
                        <div className="p-3 rounded-[var(--radius-sm)] bg-success/10 border border-success/20 text-success">
                          <span className="block text-[10px] text-success/70 font-bold uppercase mb-1">
                            Revised (B)
                          </span>
                          <span>{diff.content_b}</span>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))
            ) : (
              <p className="text-center py-8 text-[13px] text-fg-muted">
                No differences found matching the filter "{filterType}".
              </p>
            )}
          </div>
        </div>
      )}

      {/* Comparison History */}
      {!verifiedResult && !compareMutation.isPending && recentComparisons.length > 0 && (
        <div className="space-y-3 pt-4">
          <h3 className="text-[14px] font-medium text-fg">Past Comparisons</h3>
          <div className="border border-border rounded-[var(--radius-md)] bg-surface divide-y divide-border">
            {recentComparisons.map((item) => (
              <div
                key={item.id}
                onClick={() => handleSelectHistoryItem(item)}
                className="p-3.5 flex items-center justify-between gap-4 hover:bg-surface-raised cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <GitCompareArrows size={16} className="text-accent" />
                  <div>
                    <p className="text-[13px] font-medium text-fg">
                      {item.document_a_filename || item.document_a.original_filename}{' '}
                      <span className="text-fg-faint">vs</span>{' '}
                      {item.document_b_filename || item.document_b.original_filename}
                    </p>
                    <p className="text-[11px] text-fg-muted truncate max-w-[500px]">
                      {item.summary}
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-3 text-[11px] font-mono text-fg-faint shrink-0">
                  <span>{item.differences?.length ?? 0} changes</span>
                  <span>·</span>
                  <span>{relativeTime(item.created_at)}</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
