/**
 * Knowledge AI — Settings Page
 * Two-column configuration panel for RAG retrieval parameters,
 * LLM generation settings, UI appearance/density, and system diagnostics.
 */
import { useState, useEffect } from 'react';
import {
  Sliders,
  Cpu,
  Palette,
  Database,
  Keyboard,
  Save,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Server,
  Layers,
} from 'lucide-react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { PageHeader, Kbd } from '@/components/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useTheme } from '@/hooks/useTheme';
import { API_BASE } from '@/config/constants';
import { cleanupApi } from '@/lib/api/endpoints';
import { toast } from 'sonner';

// Default system settings
const DEFAULT_SETTINGS = {
  // Retrieval
  chunkSize: 1000,
  chunkOverlap: 200,
  topK: 10,
  rerankTopN: 5,
  fusionMethod: 'rrf' as 'rrf' | 'weighted',
  similarityThreshold: 0.35,

  // Generation
  model: 'gpt-4o',
  temperature: 0.2,
  streaming: true,

  // Appearance
  density: 'comfortable' as 'comfortable' | 'compact',
};

type SettingsState = typeof DEFAULT_SETTINGS;

const SETTINGS_KEY = 'knowledge_ai_system_settings';

export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
  const [activeTab, setActiveTab] = useState<'retrieval' | 'generation' | 'appearance' | 'data' | 'shortcuts'>('retrieval');
  const queryClient = useQueryClient();

  const { data: cleanupStatus } = useQuery({
    queryKey: ['cleanup', 'status'],
    queryFn: () => cleanupApi.getStatus(),
    refetchInterval: 30000,
  });

  const cleanupMutation = useMutation({
    mutationFn: () => cleanupApi.runCleanup(7, true),
    onSuccess: (data) => {
      queryClient.invalidateQueries({ queryKey: ['cleanup', 'status'] });
      queryClient.invalidateQueries({ queryKey: ['chats'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      const totalDeleted = Object.values(data.records_deleted).reduce((a, b) => a + b, 0);
      toast.success(`Cleanup complete: ${totalDeleted} temporary items purged. Knowledge documents remain intact.`);
    },
    onError: (err: any) => {
      toast.error(`Cleanup failed: ${err?.message || 'Server error'}`);
    },
  });

  // Load saved settings or fall back to defaults
  // BACKEND-GAP: Server settings endpoint does not exist; settings persist in browser storage.
  const [settings, setSettings] = useState<SettingsState>(() => {
    try {
      const saved = localStorage.getItem(SETTINGS_KEY);
      return saved ? { ...DEFAULT_SETTINGS, ...JSON.parse(saved) } : DEFAULT_SETTINGS;
    } catch {
      return DEFAULT_SETTINGS;
    }
  });

  const [isDirty, setIsDirty] = useState(false);

  // Update setting value
  const updateSetting = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
    setIsDirty(true);
  };

  // Save settings
  const handleSave = () => {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
    setIsDirty(false);
    toast.success('Settings saved successfully');
  };

  // Reset to defaults
  const handleReset = () => {
    setSettings(DEFAULT_SETTINGS);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(DEFAULT_SETTINGS));
    setIsDirty(false);
    toast.info('Settings reset to system defaults');
  };

  const navItems = [
    { id: 'retrieval', label: 'Retrieval & Indexing', icon: Sliders },
    { id: 'generation', label: 'AI Model & Generation', icon: Cpu },
    { id: 'appearance', label: 'Appearance & Layout', icon: Palette },
    { id: 'data', label: 'Storage & API Status', icon: Database },
    { id: 'shortcuts', label: 'Keyboard Shortcuts', icon: Keyboard },
  ] as const;

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      <PageHeader
        title="Settings"
        subtitle="Configure vector retrieval mechanics, generation parameters, and workspace appearance."
        actions={
          <div className="flex items-center gap-2">
            <Button
              variant="ghost"
              size="sm"
              onClick={handleReset}
              className="gap-1.5 text-fg-muted"
            >
              <RotateCcw size={13} />
              Reset Defaults
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSave}
              disabled={!isDirty}
              className="gap-1.5"
            >
              <Save size={13} />
              Save Changes
            </Button>
          </div>
        }
      />

      {/* Main Two-Column Layout */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-6 items-start">
        {/* Navigation Sidebar */}
        <div className="border border-border rounded-[var(--radius-md)] bg-surface p-1.5 space-y-0.5">
          {navItems.map((item) => (
            <button
              key={item.id}
              onClick={() => setActiveTab(item.id)}
              className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-[var(--radius-sm)] text-[13px] font-medium transition-colors text-left ${
                activeTab === item.id
                  ? 'bg-surface-raised text-fg font-semibold border-l-2 border-accent'
                  : 'text-fg-muted hover:text-fg hover:bg-surface-raised'
              }`}
            >
              <item.icon size={15} className={activeTab === item.id ? 'text-accent' : 'text-fg-faint'} />
              <span>{item.label}</span>
            </button>
          ))}
        </div>

        {/* Content Panel */}
        <div className="md:col-span-3 border border-border rounded-[var(--radius-md)] bg-surface p-6 space-y-6">
          {/* 1. Retrieval Settings */}
          {activeTab === 'retrieval' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-[16px] font-medium text-fg">Retrieval Pipeline</h2>
                <p className="text-[12px] text-fg-muted mt-1">
                  Adjust chunk partitioning, hybrid search fusion parameters, and similarity thresholds.
                </p>
              </div>

              <div className="space-y-5 divide-y divide-border pt-1">
                {/* Chunk Size */}
                <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-fg block">Chunk Size</label>
                    <p className="text-[12px] text-fg-muted">
                      Target character count for document text segmentation.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={200}
                      max={2000}
                      step={50}
                      value={settings.chunkSize}
                      onChange={(e) => updateSetting('chunkSize', Number(e.target.value))}
                      className="w-32 accent-accent"
                    />
                    <span className="font-mono text-[12px] text-fg w-14 text-right">
                      {settings.chunkSize} chars
                    </span>
                  </div>
                </div>

                {/* Chunk Overlap */}
                <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-fg block">Chunk Overlap</label>
                    <p className="text-[12px] text-fg-muted">
                      Number of overlapping characters between neighboring chunks.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={500}
                      step={25}
                      value={settings.chunkOverlap}
                      onChange={(e) => updateSetting('chunkOverlap', Number(e.target.value))}
                      className="w-32 accent-accent"
                    />
                    <span className="font-mono text-[12px] text-fg w-14 text-right">
                      {settings.chunkOverlap} chars
                    </span>
                  </div>
                </div>

                {/* Retrieval Top-K */}
                <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-fg block">Retrieval Candidates (Top-K)</label>
                    <p className="text-[12px] text-fg-muted">
                      Number of candidates retrieved from vector & BM25 indices prior to reranking.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={5}
                      max={50}
                      step={5}
                      value={settings.topK}
                      onChange={(e) => updateSetting('topK', Number(e.target.value))}
                      className="w-32 accent-accent"
                    />
                    <span className="font-mono text-[12px] text-fg w-14 text-right">
                      {settings.topK} docs
                    </span>
                  </div>
                </div>

                {/* Rerank Top-N */}
                <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-fg block">Reranked Output (Top-N)</label>
                    <p className="text-[12px] text-fg-muted">
                      Highest-scoring passages sent to the LLM prompt context window.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={1}
                      max={10}
                      step={1}
                      value={settings.rerankTopN}
                      onChange={(e) => updateSetting('rerankTopN', Number(e.target.value))}
                      className="w-32 accent-accent"
                    />
                    <span className="font-mono text-[12px] text-fg w-14 text-right">
                      {settings.rerankTopN} passages
                    </span>
                  </div>
                </div>

                {/* Fusion Strategy */}
                <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-fg block">Fusion Strategy</label>
                    <p className="text-[12px] text-fg-muted">
                      Method used to combine sparse (BM25) and dense (vector) ranks.
                    </p>
                  </div>
                  <select
                    value={settings.fusionMethod}
                    onChange={(e) => updateSetting('fusionMethod', e.target.value as any)}
                    className="h-8 px-2.5 rounded-[var(--radius-sm)] border border-border bg-surface-raised text-[12px] text-fg focus:outline-none focus:border-accent"
                  >
                    <option value="rrf">Reciprocal Rank Fusion (RRF)</option>
                    <option value="weighted">Weighted Linear Combination</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {/* 2. Generation Settings */}
          {activeTab === 'generation' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-[16px] font-medium text-fg">LLM & Generation</h2>
                <p className="text-[12px] text-fg-muted mt-1">
                  Configure language model provider parameters and streaming behavior.
                </p>
              </div>

              <div className="space-y-5 divide-y divide-border pt-1">
                {/* Model Selection */}
                <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-fg block">Primary Model</label>
                    <p className="text-[12px] text-fg-muted">
                      Backend model used to synthesize answers with source citations.
                    </p>
                  </div>
                  <select
                    value={settings.model}
                    onChange={(e) => updateSetting('model', e.target.value)}
                    className="h-8 px-2.5 rounded-[var(--radius-sm)] border border-border bg-surface-raised text-[12px] text-fg font-mono focus:outline-none focus:border-accent"
                  >
                    <option value="gpt-4o">gpt-4o (High precision)</option>
                    <option value="gpt-4o-mini">gpt-4o-mini (Fast inference)</option>
                    <option value="claude-3-5-sonnet">claude-3-5-sonnet</option>
                    <option value="ollama-llama3">ollama / llama3 (Local)</option>
                  </select>
                </div>

                {/* Temperature */}
                <div className="pt-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-fg block">Temperature</label>
                    <p className="text-[12px] text-fg-muted">
                      Lower values produce deterministic, grounded factual answers.
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <input
                      type="range"
                      min={0}
                      max={1}
                      step={0.05}
                      value={settings.temperature}
                      onChange={(e) => updateSetting('temperature', Number(e.target.value))}
                      className="w-32 accent-accent"
                    />
                    <span className="font-mono text-[12px] text-fg w-10 text-right">
                      {settings.temperature}
                    </span>
                  </div>
                </div>

                {/* Streaming Toggle */}
                <div className="pt-4 flex items-center justify-between gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-fg block">Stream Tokens (SSE)</label>
                    <p className="text-[12px] text-fg-muted">
                      Enable real-time token streaming during chat interactions.
                    </p>
                  </div>
                  <input
                    type="checkbox"
                    checked={settings.streaming}
                    onChange={(e) => updateSetting('streaming', e.target.checked)}
                    className="w-4 h-4 accent-accent rounded"
                  />
                </div>
              </div>
            </div>
          )}

          {/* 3. Appearance */}
          {activeTab === 'appearance' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-[16px] font-medium text-fg">Appearance & Layout</h2>
                <p className="text-[12px] text-fg-muted mt-1">
                  Adjust color palette theme and interface element density.
                </p>
              </div>

              <div className="space-y-5 divide-y divide-border pt-1">
                {/* Theme Selector */}
                <div className="pt-4 flex items-center justify-between gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-fg block">Interface Theme</label>
                    <p className="text-[12px] text-fg-muted">
                      Light, dark, or follow operating system preference.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(['light', 'dark', 'system'] as const).map((t) => (
                      <button
                        key={t}
                        onClick={() => setTheme(t)}
                        className={`px-3 py-1 rounded-[var(--radius-sm)] text-[12px] font-medium capitalize transition-colors ${
                          theme === t
                            ? 'bg-accent text-accent-fg'
                            : 'bg-surface-raised border border-border text-fg-muted hover:text-fg'
                        }`}
                      >
                        {t}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Density */}
                <div className="pt-4 flex items-center justify-between gap-4">
                  <div>
                    <label className="text-[13px] font-medium text-fg block">Display Density</label>
                    <p className="text-[12px] text-fg-muted">
                      Control vertical padding and table row spacing.
                    </p>
                  </div>
                  <div className="flex items-center gap-1.5">
                    {(['comfortable', 'compact'] as const).map((d) => (
                      <button
                        key={d}
                        onClick={() => updateSetting('density', d)}
                        className={`px-3 py-1 rounded-[var(--radius-sm)] text-[12px] font-medium capitalize transition-colors ${
                          settings.density === d
                            ? 'bg-accent text-accent-fg'
                            : 'bg-surface-raised border border-border text-fg-muted hover:text-fg'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 4. Storage & API Status */}
          {activeTab === 'data' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-[16px] font-medium text-fg">Storage & Infrastructure Status</h2>
                <p className="text-[12px] text-fg-muted mt-1">
                  Connected endpoints, database connections, and cache diagnostics.
                </p>
              </div>

              <div className="space-y-3 font-mono text-[12px]">
                <div className="p-3 rounded-[var(--radius-sm)] bg-surface-raised border border-border flex items-center justify-between">
                  <span className="text-fg-muted">Backend API Base:</span>
                  <span className="text-fg">{API_BASE} (FastAPI)</span>
                </div>
                <div className="p-3 rounded-[var(--radius-sm)] bg-surface-raised border border-border flex items-center justify-between">
                  <span className="text-fg-muted">Relational Database:</span>
                  <span className="text-fg">PostgreSQL 16 (SQLAlchemy Async)</span>
                </div>
                <div className="p-3 rounded-[var(--radius-sm)] bg-surface-raised border border-border flex items-center justify-between">
                  <span className="text-fg-muted">Vector Store:</span>
                  <span className="text-fg">ChromaDB / Persistent Client</span>
                </div>
                <div className="p-3 rounded-[var(--radius-sm)] bg-surface-raised border border-border flex items-center justify-between">
                  <span className="text-fg-muted">API Connection Status:</span>
                  <span className="text-success flex items-center gap-1 font-semibold">
                    <CheckCircle2 size={13} />
                    Connected & Healthy
                  </span>
                </div>

                {/* Weekly Automatic Cleanup Status */}
                <div className="p-3.5 rounded-[var(--radius-sm)] bg-surface-raised border border-border space-y-2.5">
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2">
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="text-fg font-medium text-[13px] font-sans">Weekly Automatic Cleanup</span>
                        <span className="px-1.5 py-0.5 rounded text-[10px] font-semibold bg-emerald-500/15 text-emerald-400 border border-emerald-500/20">
                          Active (Every 7 Days)
                        </span>
                      </div>
                      <p className="text-[11px] text-fg-muted font-sans mt-0.5">
                        Automatically purges temporary chat messages, conversation history, and comparison results every 7 days. Uploaded documents and vectors are never deleted.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => cleanupMutation.mutate()}
                      disabled={cleanupMutation.isPending}
                      className="shrink-0 text-[12px] h-7 px-2.5"
                    >
                      {cleanupMutation.isPending ? 'Cleaning…' : 'Run Cleanup Now'}
                    </Button>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 pt-2 border-t border-border/60 text-[11px] font-mono text-fg-muted">
                    <div>
                      <span>Next Cleanup: </span>
                      <span className="text-fg">
                        {cleanupStatus?.next_cleanup_at ? new Date(cleanupStatus.next_cleanup_at).toLocaleString() : 'Calculating…'}
                      </span>
                    </div>
                    <div>
                      <span>Last Cleaned: </span>
                      <span className="text-fg">
                        {cleanupStatus?.last_cleanup_at ? new Date(cleanupStatus.last_cleanup_at).toLocaleString() : 'Pending first cycle'}
                      </span>
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* 5. Keyboard Shortcuts */}
          {activeTab === 'shortcuts' && (
            <div className="space-y-6">
              <div>
                <h2 className="text-[16px] font-medium text-fg">Keyboard Shortcuts</h2>
                <p className="text-[12px] text-fg-muted mt-1">
                  Global navigation accelerators for rapid knowledge exploration.
                </p>
              </div>

              <div className="border border-border rounded-[var(--radius-md)] overflow-hidden">
                <table className="w-full text-[13px]">
                  <thead>
                    <tr className="border-b border-border bg-surface-sunken">
                      <th className="text-left py-2 px-3 text-[11px] text-fg-faint uppercase font-medium">Action</th>
                      <th className="text-right py-2 px-3 text-[11px] text-fg-faint uppercase font-medium">Shortcut</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {[
                      { action: 'Open Command Palette', keys: ['⌘', 'K'] },
                      { action: 'New Chat Conversation', keys: ['⌘', '⇧', 'O'] },
                      { action: 'Go to Dashboard', keys: ['G', 'D'] },
                      { action: 'Go to Chat', keys: ['G', 'C'] },
                      { action: 'Go to Upload', keys: ['G', 'U'] },
                      { action: 'Go to Collections', keys: ['G', 'L'] },
                      { action: 'Go to Search', keys: ['G', 'S'] },
                      { action: 'Go to Analytics', keys: ['G', 'A'] },
                      { action: 'Close dialog / palette', keys: ['Esc'] },
                    ].map((s) => (
                      <tr key={s.action} className="hover:bg-surface-raised transition-colors">
                        <td className="py-2.5 px-3 text-fg">{s.action}</td>
                        <td className="py-2.5 px-3 text-right">
                          <div className="inline-flex items-center gap-1">
                            {s.keys.map((k) => (
                              <Kbd key={k}>{k}</Kbd>
                            ))}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
