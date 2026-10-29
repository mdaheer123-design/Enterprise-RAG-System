/**
 * Knowledge AI — Analytics Page
 * System telemetry, document ingestion volume, query metrics over time,
 * file-type distribution charts, and storage utilization.
 */
import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  AreaChart,
  Area,
  CartesianGrid,
  PieChart,
  Pie,
  Cell,
} from 'recharts';
import {
  BarChart3,
  Download,
  Calendar,
  Layers,
  FileText,
  MessageSquare,
  HardDrive,
  RefreshCw,
} from 'lucide-react';
import { analyticsApi } from '@/lib/api/endpoints';
import { PageHeader, EmptyState, ErrorState, Skeleton, FileGlyph } from '@/components/shared';
import { Button } from '@/components/ui/Button';
import { formatBytes, formatNumber, relativeTime } from '@/lib/utils';
import { toast } from 'sonner';

const CHART_COLORS = [
  'hsl(18 100% 50%)', // Ember accent
  'hsl(210 70% 56%)',
  'hsl(152 55% 42%)',
  'hsl(35 90% 55%)',
  'hsl(280 60% 60%)',
];

export default function AnalyticsPage() {
  const [timeRange, setTimeRange] = useState<'7d' | '30d' | '90d' | 'all'>('30d');

  const { data, isLoading, error, refetch } = useQuery({
    queryKey: ['analytics', 'overview'],
    queryFn: () => analyticsApi.overview(),
  });

  // Export analytics summary to CSV
  const handleExportCSV = () => {
    if (!data) return;

    let csv = 'Metric,Value\n';
    csv += `Total Documents,${data.total_documents}\n`;
    csv += `Total Collections,${data.total_collections}\n`;
    csv += `Total Questions,${data.total_questions}\n`;
    csv += `Total Storage (Bytes),${data.total_storage_bytes}\n\n`;

    csv += 'File Type,Count\n';
    Object.entries(data.documents_by_type).forEach(([type, count]) => {
      csv += `${type},${count}\n`;
    });

    csv += '\nDate,Questions Asked\n';
    data.questions_per_day.forEach((item) => {
      csv += `${item.date},${item.count}\n`;
    });

    const blob = new Blob([csv], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `knowledge_ai_analytics_${new Date().toISOString().slice(0, 10)}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast.success('Analytics CSV exported');
  };

  if (isLoading) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto space-y-6">
        <Skeleton className="h-8 w-48" />
        <div className="grid grid-cols-4 gap-4">
          {[...Array(4)].map((_, i) => (
            <Skeleton key={i} className="h-20" />
          ))}
        </div>
        <Skeleton className="h-80 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6 max-w-[1200px] mx-auto">
        <ErrorState
          message="Failed to load analytics telemetry"
          detail={(error as any)?.message || 'Database analytics overview service returned an error.'}
          onRetry={() => refetch()}
        />
      </div>
    );
  }

  // Format file types for pie/bar chart
  const fileTypeData = Object.entries(data.documents_by_type).map(([name, value]) => ({
    name: name.toUpperCase(),
    value,
  }));

  // Questions per day
  const questionsData = data.questions_per_day.length > 0
    ? data.questions_per_day
    : [
        { date: 'Today', count: data.total_questions },
      ];

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-8">
      <PageHeader
        title="Analytics & Telemetry"
        subtitle="Real-time document ingestion velocity, query throughput, and knowledge base utilization."
        actions={
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={handleExportCSV} className="gap-1.5">
              <Download size={13} />
              Export CSV
            </Button>
            <Button variant="ghost" size="sm" onClick={() => refetch()} className="p-2 text-fg-muted">
              <RefreshCw size={13} />
            </Button>
          </div>
        }
      />

      {/* KPI Cards Grid */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { label: 'Total Documents', value: formatNumber(data.total_documents), icon: FileText },
          { label: 'Total Collections', value: formatNumber(data.total_collections), icon: Layers },
          { label: 'Questions Answered', value: formatNumber(data.total_questions), icon: MessageSquare },
          { label: 'Total Storage', value: formatBytes(data.total_storage_bytes), icon: HardDrive },
        ].map((kpi) => (
          <div
            key={kpi.label}
            className="p-4 border border-border rounded-[var(--radius-md)] bg-surface flex items-center justify-between"
          >
            <div>
              <p className="text-[11px] font-mono uppercase tracking-wider text-fg-faint">
                {kpi.label}
              </p>
              <p
                className="text-[24px] font-medium text-fg mt-0.5"
                style={{ fontFamily: 'var(--font-mono)', fontVariantNumeric: 'tabular-nums' }}
              >
                {kpi.value}
              </p>
            </div>
            <div className="w-9 h-9 rounded-full bg-surface-sunken flex items-center justify-center text-fg-faint">
              <kpi.icon size={16} />
            </div>
          </div>
        ))}
      </div>

      {/* Questions Throughput Chart */}
      <div className="p-5 border border-border rounded-[var(--radius-md)] bg-surface space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-[15px] font-medium text-fg">Questions Asked Over Time</h3>
            <p className="text-[12px] text-fg-muted mt-0.5">
              Cumulative conversational queries processed by the RAG assistant.
            </p>
          </div>

          <div className="flex items-center gap-1 text-[11px] font-mono">
            {(['7d', '30d', '90d', 'all'] as const).map((range) => (
              <button
                key={range}
                onClick={() => setTimeRange(range)}
                className={`px-2 py-0.5 rounded uppercase ${
                  timeRange === range
                    ? 'bg-accent text-accent-fg font-medium'
                    : 'text-fg-faint hover:text-fg'
                }`}
              >
                {range}
              </button>
            ))}
          </div>
        </div>

        <div className="h-64 w-full pt-2">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={questionsData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
              <defs>
                <linearGradient id="colorCount" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="5%" stopColor="hsl(18 100% 50%)" stopOpacity={0.3} />
                  <stop offset="95%" stopColor="hsl(18 100% 50%)" stopOpacity={0.0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
              <XAxis
                dataKey="date"
                stroke="hsl(var(--fg-faint))"
                fontSize={11}
                tickLine={false}
                fontFamily="var(--font-mono)"
              />
              <YAxis
                stroke="hsl(var(--fg-faint))"
                fontSize={11}
                tickLine={false}
                fontFamily="var(--font-mono)"
                allowDecimals={false}
              />
              <Tooltip
                contentStyle={{
                  backgroundColor: 'hsl(var(--surface))',
                  borderColor: 'hsl(var(--border))',
                  borderRadius: '6px',
                  fontSize: '12px',
                  fontFamily: 'var(--font-mono)',
                  color: 'hsl(var(--fg))',
                }}
              />
              <Area
                type="monotone"
                dataKey="count"
                stroke="hsl(18 100% 50%)"
                strokeWidth={2}
                fillOpacity={1}
                fill="url(#colorCount)"
                name="Questions"
              />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Two Column Section: File Type Breakdown & Recent Activity */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Document Type Distribution */}
        <div className="p-5 border border-border rounded-[var(--radius-md)] bg-surface space-y-4">
          <div>
            <h3 className="text-[15px] font-medium text-fg">Knowledge Base Distribution</h3>
            <p className="text-[12px] text-fg-muted mt-0.5">
              Documents categorized by file extension.
            </p>
          </div>

          {fileTypeData.length > 0 ? (
            <div className="h-56 w-full pt-2">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={fileTypeData} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis
                    dataKey="name"
                    stroke="hsl(var(--fg-faint))"
                    fontSize={11}
                    tickLine={false}
                    fontFamily="var(--font-mono)"
                  />
                  <YAxis
                    stroke="hsl(var(--fg-faint))"
                    fontSize={11}
                    tickLine={false}
                    fontFamily="var(--font-mono)"
                    allowDecimals={false}
                  />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: 'hsl(var(--surface))',
                      borderColor: 'hsl(var(--border))',
                      borderRadius: '6px',
                      fontSize: '12px',
                      fontFamily: 'var(--font-mono)',
                      color: 'hsl(var(--fg))',
                    }}
                  />
                  <Bar dataKey="value" fill="hsl(18 100% 50%)" radius={[4, 4, 0, 0]} name="Documents" />
                </BarChart>
              </ResponsiveContainer>
            </div>
          ) : (
            <div className="py-12 text-center text-[13px] text-fg-muted">
              No document types to display.
            </div>
          )}
        </div>

        {/* Recent Ingestion Activity */}
        <div className="p-5 border border-border rounded-[var(--radius-md)] bg-surface space-y-4">
          <div>
            <h3 className="text-[15px] font-medium text-fg">Recent Ingestion Jobs</h3>
            <p className="text-[12px] text-fg-muted mt-0.5">
              Latest documents processed through the embedding pipeline.
            </p>
          </div>

          {data.recent_uploads.length > 0 ? (
            <div className="divide-y divide-border">
              {data.recent_uploads.slice(0, 5).map((doc) => (
                <div key={doc.id} className="py-2.5 flex items-center justify-between gap-3 text-[13px]">
                  <div className="flex items-center gap-2.5 min-w-0">
                    <FileGlyph type={doc.file_type} size={15} />
                    <span className="truncate text-fg font-medium">{doc.original_filename}</span>
                  </div>
                  <div className="flex items-center gap-3 font-mono text-[11px] text-fg-faint shrink-0">
                    <span>{formatBytes(doc.file_size)}</span>
                    <span>·</span>
                    <span>{relativeTime(doc.created_at)}</span>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <div className="py-12 text-center text-[13px] text-fg-muted">
              No recent uploads.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
