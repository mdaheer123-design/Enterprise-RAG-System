/**
 * Knowledge AI — Dashboard Page ("Overview")
 * Editorial layout: greeting-less header, recent chats, recent documents,
 * KPI strip, storage meter, and first-run checklist.
 */
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { analyticsApi } from '@/lib/api/endpoints';
import { PageHeader, EmptyState, Skeleton, FileGlyph } from '@/components/shared';
import { Button } from '@/components/ui/Button';
import { formatBytes, formatNumber, relativeTime } from '@/lib/utils';
import { cn } from '@/lib/utils';

export default function DashboardPage() {
  const navigate = useNavigate();
  const { data, isLoading, error } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => analyticsApi.overview(),
  });

  if (isLoading) return <DashboardSkeleton />;

  const isEmpty = !data || data.total_documents === 0;

  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <PageHeader
        title="Overview"
        subtitle={
          data
            ? `${formatNumber(data.total_documents)} documents · ${formatNumber(data.total_collections)} collections · ${formatNumber(data.total_questions)} questions asked`
            : undefined
        }
      />

      {isEmpty ? (
        <FirstRunChecklist />
      ) : (
        <>
          {/* KPI Strip */}
          <div className="flex items-center gap-8 py-3 px-4 border border-border rounded-[var(--radius-md)] bg-surface mb-6">
            {[
              { label: 'Documents', value: formatNumber(data!.total_documents) },
              { label: 'Collections', value: formatNumber(data!.total_collections) },
              { label: 'Questions', value: formatNumber(data!.total_questions) },
              { label: 'Storage', value: formatBytes(data!.total_storage_bytes) },
            ].map((kpi) => (
              <div key={kpi.label} className="flex items-baseline gap-2">
                <span
                  className="text-[20px] text-fg font-medium"
                  style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                >
                  {kpi.value}
                </span>
                <span className="text-[11px] text-fg-faint uppercase tracking-wider">
                  {kpi.label}
                </span>
              </div>
            ))}
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            {/* Left: Recently indexed documents */}
            <div className="lg:col-span-2">
              <h2 className="text-[14px] font-medium text-fg mb-3">Recently indexed</h2>
              <div className="border border-border rounded-[var(--radius-md)] overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-surface-sunken">
                      <th className="text-left py-2 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">File</th>
                      <th className="text-left py-2 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium hidden sm:table-cell">Size</th>
                      <th className="text-left py-2 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium hidden md:table-cell">Pages</th>
                      <th className="text-left py-2 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium hidden md:table-cell">Status</th>
                      <th className="text-right py-2 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Added</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data!.recent_uploads.slice(0, 8).map((doc) => (
                      <tr
                        key={doc.id}
                        className="border-b border-border-subtle last:border-0 hover:bg-surface-raised transition-colors cursor-pointer"
                      >
                        <td className="py-2 px-3">
                          <div className="flex items-center gap-2 min-w-0">
                            <FileGlyph type={doc.file_type} size={14} />
                            <span className="truncate text-fg">{doc.original_filename}</span>
                          </div>
                        </td>
                        <td className="py-2 px-3 text-fg-muted hidden sm:table-cell"
                          style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums', fontSize: '12px' }}
                        >
                          {formatBytes(doc.file_size)}
                        </td>
                        <td className="py-2 px-3 text-fg-muted hidden md:table-cell"
                          style={{ fontFamily: 'var(--font-mono)', fontSize: '12px' }}
                        >
                          {doc.page_count ?? '—'}
                        </td>
                        <td className="py-2 px-3 hidden md:table-cell">
                          <StatusBadge status={doc.status} />
                        </td>
                        <td className="py-2 px-3 text-right text-fg-faint text-[12px]">
                          {relativeTime(doc.created_at)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Right: Storage meter + suggestions */}
            <div className="space-y-6">
              {/* Storage Meter */}
              <div>
                <h2 className="text-[14px] font-medium text-fg mb-3">Storage usage</h2>
                <div className="border border-border rounded-[var(--radius-md)] p-4">
                  <div className="flex items-baseline justify-between mb-3">
                    <span
                      className="text-[20px] text-fg font-medium"
                      style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
                    >
                      {formatBytes(data!.total_storage_bytes)}
                    </span>
                    <span className="text-[11px] text-fg-faint">total</span>
                  </div>
                  {/* Stacked bar by file type */}
                  <div className="h-2 rounded-full overflow-hidden flex bg-surface-sunken">
                    {(Object.entries(data!.documents_by_type) as [string, number][]).map(([type, count], i) => {
                      const total = (Object.values(data!.documents_by_type) as number[]).reduce((a, b) => a + b, 0);
                      const pct = total > 0 ? (count / total) * 100 : 0;
                      const colors = ['bg-danger', 'bg-info', 'bg-fg-muted', 'bg-success', 'bg-warning'];
                      return (
                        <div
                          key={type}
                          className={cn('h-full', colors[i % colors.length])}
                          style={{ width: `${pct}%` }}
                          title={`${type.toUpperCase()}: ${count} files`}
                        />
                      );
                    })}
                  </div>
                  <div className="flex flex-wrap gap-3 mt-3">
                    {(Object.entries(data!.documents_by_type) as [string, number][]).map(([type, count]) => (
                      <div key={type} className="flex items-center gap-1.5">
                        <FileGlyph type={type} size={12} />
                        <span className="text-[11px] text-fg-faint">
                          {type.toUpperCase()} ({count})
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>

              {/* Quick Actions */}
              <div>
                <h2 className="text-[14px] font-medium text-fg mb-3">Quick actions</h2>
                <div className="space-y-2">
                  <button
                    onClick={() => navigate('/chat')}
                    className="w-full text-left px-3 py-2.5 rounded-[var(--radius)] border border-border hover:bg-surface-raised transition-colors text-[13px] text-fg-muted hover:text-fg"
                  >
                    Ask a question about your documents
                  </button>
                  <button
                    onClick={() => navigate('/upload')}
                    className="w-full text-left px-3 py-2.5 rounded-[var(--radius)] border border-border hover:bg-surface-raised transition-colors text-[13px] text-fg-muted hover:text-fg"
                  >
                    Upload new documents
                  </button>
                  <button
                    onClick={() => navigate('/compare')}
                    className="w-full text-left px-3 py-2.5 rounded-[var(--radius)] border border-border hover:bg-surface-raised transition-colors text-[13px] text-fg-muted hover:text-fg"
                  >
                    Compare two document versions
                  </button>
                </div>
              </div>
            </div>
          </div>
        </>
      )}
    </div>
  );
}

// ── First Run Checklist ─────────────────────────────────────────
function FirstRunChecklist() {
  const navigate = useNavigate();
  const steps = [
    { label: 'Create a collection', description: 'Organize your documents into groups.', action: () => navigate('/collections') },
    { label: 'Upload documents', description: 'Add PDF, DOCX, TXT, CSV, or Excel files.', action: () => navigate('/upload') },
    { label: 'Ask a question', description: 'Get answers backed by your documents.', action: () => navigate('/chat') },
  ];

  return (
    <div className="max-w-[520px] mx-auto mt-12">
      <h2
        className="text-[28px] text-fg tracking-tight text-center mb-2"
        style={{ fontFamily: 'var(--font-serif)' }}
      >
        Get started with Knowledge AI
      </h2>
      <p className="text-[13px] text-fg-muted text-center mb-8">
        Follow these steps to set up your document knowledge base.
      </p>
      <div className="space-y-3">
        {steps.map((step, i) => (
          <button
            key={step.label}
            onClick={step.action}
            className="w-full flex items-start gap-4 p-4 rounded-[var(--radius-md)] border border-border hover:bg-surface-raised transition-colors text-left"
          >
            <span
              className="w-6 h-6 rounded-full border border-border flex items-center justify-center text-[12px] text-fg-faint shrink-0 mt-0.5"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              {i + 1}
            </span>
            <div>
              <span className="text-[14px] text-fg font-medium block">{step.label}</span>
              <span className="text-[12px] text-fg-muted">{step.description}</span>
            </div>
          </button>
        ))}
      </div>
    </div>
  );
}

// ── Status Badge ────────────────────────────────────────────────
function StatusBadge({ status }: { status: string }) {
  const styles: Record<string, string> = {
    indexed: 'bg-success-subtle text-success',
    processing: 'bg-warning-subtle text-warning',
    failed: 'bg-danger-subtle text-danger',
  };

  return (
    <span
      className={cn(
        'inline-flex items-center h-5 px-1.5 rounded-[3px] text-[11px] font-medium',
        styles[status] ?? 'bg-surface-sunken text-fg-muted',
      )}
    >
      {status}
    </span>
  );
}

// ── Skeleton ────────────────────────────────────────────────────
function DashboardSkeleton() {
  return (
    <div className="p-6 max-w-[1200px] mx-auto">
      <Skeleton className="h-8 w-32 mb-2" />
      <Skeleton className="h-4 w-80 mb-6" />
      <Skeleton className="h-16 mb-6" />
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <Skeleton className="h-64" />
        </div>
        <div className="space-y-4">
          <Skeleton className="h-32" />
          <Skeleton className="h-40" />
        </div>
      </div>
    </div>
  );
}
