/**
 * Knowledge AI — Upload Page
 * Drag-and-drop document ingestion, queue with pipeline status,
 * target collection selection, and recent uploads table.
 */
import { useState, useRef, useEffect, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Upload,
  Plus,
  Trash2,
  CheckCircle2,
  AlertCircle,
  FileText,
  RefreshCw,
  FolderPlus,
  ExternalLink,
  MessageSquare,
  X,
} from 'lucide-react';
import { documentsApi, collectionsApi } from '@/lib/api/endpoints';
import { PageHeader, EmptyState, ErrorState, FileGlyph, Skeleton } from '@/components/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { formatBytes, relativeTime, cn } from '@/lib/utils';
import { ALLOWED_EXTENSIONS, MAX_FILE_SIZE } from '@/config/constants';
import type { Document, Collection } from '@/types/api';
import { toast } from 'sonner';

interface QueueItem {
  id: string;
  file: File;
  collectionId?: string;
  collectionName?: string;
  progress: number;
  status: 'pending' | 'uploading' | 'processing' | 'ready' | 'failed';
  error?: string;
}

export default function UploadPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Collection selection state
  const [selectedCollectionId, setSelectedCollectionId] = useState<string>(() => {
    return localStorage.getItem('knowledge_ai_last_collection') || '';
  });

  // Create Collection Modal state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newCollectionName, setNewCollectionName] = useState('');
  const [newCollectionDesc, setNewCollectionDesc] = useState('');
  const [createError, setCreateError] = useState('');

  // Drag and drop state
  const [isDragging, setIsDragging] = useState(false);

  // Upload queue state
  const [queue, setQueue] = useState<QueueItem[]>([]);
  const [isUploading, setIsUploading] = useState(false);

  // Delete confirmation state
  const [documentToDelete, setDocumentToDelete] = useState<Document | null>(null);
  const [retryingId, setRetryingId] = useState<string | null>(null);

  // Retry document indexing mutation
  const retryMutation = useMutation({
    mutationFn: (docId: string) => documentsApi.retry(docId),
    onMutate: (docId: string) => {
      setRetryingId(docId);
    },
    onSuccess: (updatedDoc) => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      toast.success(`Retrying processing for "${updatedDoc.original_filename}"`);
    },
    onError: (err: any) => {
      toast.error(err.response?.data?.detail || err.message || 'Retry failed');
    },
    onSettled: () => {
      setRetryingId(null);
    },
  });

  // Fetch collections
  const { data: collections = [], isLoading: collectionsLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: () => collectionsApi.list(),
  });

  // Fetch recent documents with polling if any are indexing
  const {
    data: documentsData,
    isLoading: documentsLoading,
    refetch: refetchDocuments,
  } = useQuery({
    queryKey: ['documents', { page_size: 10 }],
    queryFn: () => documentsApi.list({ page_size: 10 }),
    refetchInterval: (query) => {
      const docs = query.state.data?.documents ?? [];
      const hasActive = docs.some((d: Document) => ['uploaded', 'processing', 'queued'].includes(d.status));
      return hasActive ? 3000 : false;
    },
  });

  // Warn on page leave if uploading
  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (queue.some((item) => item.status === 'uploading' || item.status === 'pending')) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', handleBeforeUnload);
    return () => window.removeEventListener('beforeunload', handleBeforeUnload);
  }, [queue]);

  // Save selected collection
  const handleCollectionChange = (id: string) => {
    setSelectedCollectionId(id);
    if (id) {
      localStorage.setItem('knowledge_ai_last_collection', id);
    } else {
      localStorage.removeItem('knowledge_ai_last_collection');
    }
  };

  // Create collection mutation
  const createCollectionMutation = useMutation({
    mutationFn: () => collectionsApi.create({ name: newCollectionName.trim(), description: newCollectionDesc.trim() || undefined, color: '#6366F1', icon: 'folder' }),
    onSuccess: (newCol) => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setSelectedCollectionId(newCol.id);
      localStorage.setItem('knowledge_ai_last_collection', newCol.id);
      setShowCreateModal(false);
      setNewCollectionName('');
      setNewCollectionDesc('');
      toast.success(`Collection "${newCol.name}" created`);
    },
    onError: (err: any) => {
      setCreateError(err.message || 'Failed to create collection');
    },
  });

  // Handle file validation and add to queue
  const addFilesToQueue = useCallback((files: FileList | File[]) => {
    const validExtensions = [...ALLOWED_EXTENSIONS, 'xls'];
    const itemsToAdd: QueueItem[] = [];

    Array.from(files).forEach((file) => {
      const ext = file.name.split('.').pop()?.toLowerCase() || '';

      if (!validExtensions.includes(ext as any)) {
        toast.error(`"${file.name}" has unsupported format (.${ext})`);
        return;
      }

      if (file.size > MAX_FILE_SIZE) {
        toast.error(`"${file.name}" exceeds 50MB limit (${formatBytes(file.size)})`);
        return;
      }

      if (file.size === 0) {
        toast.error(`"${file.name}" is empty`);
        return;
      }

      const col = collections.find((c) => c.id === selectedCollectionId);

      itemsToAdd.push({
        id: crypto.randomUUID(),
        file,
        collectionId: selectedCollectionId || undefined,
        collectionName: col?.name,
        progress: 0,
        status: 'pending',
      });
    });

    if (itemsToAdd.length > 0) {
      setQueue((prev) => [...prev, ...itemsToAdd]);
    }
  }, [collections, selectedCollectionId]);

  // Execute upload queue
  useEffect(() => {
    if (isUploading) return;

    const pendingItem = queue.find((item) => item.status === 'pending');
    if (!pendingItem) return;

    setIsUploading(true);

    const uploadItem = async (item: QueueItem) => {
      setQueue((prev) =>
        prev.map((q) => (q.id === item.id ? { ...q, status: 'uploading', progress: 30 } : q))
      );

      try {
        await documentsApi.upload([item.file], item.collectionId);

        setQueue((prev) =>
          prev.map((q) => (q.id === item.id ? { ...q, status: 'ready', progress: 100 } : q))
        );
        toast.success(`"${item.file.name}" indexed successfully`);
        queryClient.invalidateQueries({ queryKey: ['documents'] });
        queryClient.invalidateQueries({ queryKey: ['analytics'] });
      } catch (err: any) {
        setQueue((prev) =>
          prev.map((q) =>
            q.id === item.id
              ? { ...q, status: 'failed', error: err.message || 'Upload failed' }
              : q
          )
        );
        toast.error(`Failed to upload "${item.file.name}"`);
      } finally {
        setIsUploading(false);
      }
    };

    uploadItem(pendingItem);
  }, [queue, isUploading, queryClient]);

  // Retry an item
  const retryItem = (id: string) => {
    setQueue((prev) =>
      prev.map((item) =>
        item.id === id ? { ...item, status: 'pending', progress: 0, error: undefined } : item
      )
    );
  };

  // Remove item from queue
  const removeItem = (id: string) => {
    setQueue((prev) => prev.filter((item) => item.id !== id));
  };

  // Clear completed items
  const clearCompleted = () => {
    setQueue((prev) => prev.filter((item) => item.status !== 'ready'));
  };

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      addFilesToQueue(e.dataTransfer.files);
    }
  };

  // Delete document mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => documentsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      queryClient.invalidateQueries({ queryKey: ['analytics'] });
      toast.success('Document deleted');
      setDocumentToDelete(null);
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to delete document');
    },
  });

  const allCompleted = queue.length > 0 && queue.every((item) => item.status === 'ready');

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-8">
      <PageHeader
        title="Upload Documents"
        subtitle="Ingest PDF, Word, plain text, and spreadsheet files into the RAG knowledge base."
      />

      {/* Target Collection Selector & Actions */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 p-4 border border-border rounded-[var(--radius-md)] bg-surface">
        <div className="flex flex-col sm:flex-row items-start sm:items-center gap-3 w-full sm:w-auto">
          <label className="text-[13px] font-medium text-fg whitespace-nowrap">
            Target Collection:
          </label>
          <select
            value={selectedCollectionId}
            onChange={(e) => handleCollectionChange(e.target.value)}
            className="w-full sm:w-[240px] h-8 px-2.5 rounded-[var(--radius-sm)] border border-border bg-surface-raised text-[13px] text-fg focus:outline-none focus:border-accent"
          >
            <option value="">No collection (General)</option>
            {collections.map((col) => (
              <option key={col.id} value={col.id}>
                {col.name} ({col.document_count} files)
              </option>
            ))}
          </select>
        </div>

        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            setCreateError('');
            setShowCreateModal(true);
          }}
          className="gap-1.5 shrink-0"
        >
          <FolderPlus size={14} />
          New Collection
        </Button>
      </div>

      {/* Drag and Drop Zone */}
      <div
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
        className={cn(
          'relative border-2 border-dashed rounded-[10px] p-10 text-center cursor-pointer transition-all duration-200',
          isDragging
            ? 'border-accent bg-accent/8 scale-[1.005]'
            : 'border-border bg-surface hover:border-accent/50 hover:bg-surface-raised'
        )}
      >
        <input
          ref={fileInputRef}
          type="file"
          multiple
          accept=".pdf,.docx,.txt,.csv,.xlsx,.xls"
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFilesToQueue(e.target.files);
            e.target.value = '';
          }}
        />

        <div className="flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-accent-subtle flex items-center justify-center text-accent">
            <Upload size={22} strokeWidth={1.75} />
          </div>
          <div>
            <p className="text-[15px] font-medium text-fg">
              Drag and drop files here, or <span className="text-accent underline">browse</span>
            </p>
            <p
              className="mt-1 text-[12px] text-fg-muted font-mono"
              style={{ fontFamily: 'var(--font-mono)' }}
            >
              Accepted formats: PDF · DOCX · TXT · CSV · XLSX · XLS (max 50 MB)
            </p>
          </div>
        </div>
      </div>

      {/* Upload Queue Section */}
      {queue.length > 0 && (
        <div className="border border-border rounded-[var(--radius-md)] bg-surface overflow-hidden">
          <div className="flex items-center justify-between p-4 border-b border-border bg-surface-sunken">
            <div className="flex items-center gap-2">
              <h2 className="text-[14px] font-medium text-fg">Upload Queue</h2>
              <span className="text-[12px] text-fg-muted font-mono">
                ({queue.filter((q) => q.status === 'ready').length}/{queue.length} completed)
              </span>
            </div>
            {queue.some((q) => q.status === 'ready') && (
              <Button variant="ghost" size="sm" onClick={clearCompleted} className="text-fg-faint">
                Clear completed
              </Button>
            )}
          </div>

          {/* Success Banner if all completed */}
          {allCompleted && (
            <div className="flex items-center justify-between p-4 bg-success/10 border-b border-success/20 text-success text-[13px]">
              <div className="flex items-center gap-2">
                <CheckCircle2 size={16} />
                <span>All documents have been indexed and embedded into the vector store.</span>
              </div>
              <Button
                variant="primary"
                size="sm"
                onClick={() => navigate('/chat')}
                className="gap-1.5"
              >
                <MessageSquare size={14} />
                Ask in Chat
              </Button>
            </div>
          )}

          <div className="divide-y divide-border">
            {queue.map((item) => (
              <div key={item.id} className="p-4 flex items-center justify-between gap-4">
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <FileGlyph type={item.file.name.split('.').pop() || 'txt'} size={18} />
                  <div className="min-w-0 flex-1">
                    <p className="text-[13px] font-medium text-fg truncate">{item.file.name}</p>
                    <div className="flex items-center gap-2 mt-0.5 text-[11px] text-fg-muted font-mono">
                      <span>{formatBytes(item.file.size)}</span>
                      {item.collectionName && <span>· Collection: {item.collectionName}</span>}
                    </div>
                  </div>
                </div>

                {/* Status / Stepper */}
                <div className="flex items-center gap-4 shrink-0">
                  {item.status === 'pending' && (
                    <span className="text-[12px] text-fg-faint font-mono">Queued</span>
                  )}
                  {item.status === 'uploading' && (
                    <div className="flex items-center gap-2 text-[12px] text-accent font-mono">
                      <RefreshCw size={12} className="animate-spin" />
                      <span>Uploading & Chunking...</span>
                    </div>
                  )}
                  {item.status === 'ready' && (
                    <div className="flex items-center gap-1.5 text-[12px] text-success font-medium">
                      <CheckCircle2 size={14} />
                      <span>Indexed</span>
                    </div>
                  )}
                  {item.status === 'failed' && (
                    <div className="flex items-center gap-2 text-[12px] text-danger">
                      <AlertCircle size={14} />
                      <span>{item.error || 'Failed'}</span>
                      <Button variant="ghost" size="sm" onClick={() => retryItem(item.id)}>
                        Retry
                      </Button>
                    </div>
                  )}

                  <button
                    onClick={() => removeItem(item.id)}
                    className="text-fg-faint hover:text-fg p-1 rounded"
                    title="Remove"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Recently Uploaded Documents Table */}
      <div className="space-y-4">
        <div className="flex items-center justify-between">
          <h2 className="text-[16px] font-medium text-fg">Recently Uploaded Documents</h2>
          <Button variant="ghost" size="sm" onClick={() => refetchDocuments()} className="gap-1.5 text-fg-muted">
            <RefreshCw size={13} />
            Refresh
          </Button>
        </div>

        {documentsLoading ? (
          <div className="space-y-2">
            {[...Array(4)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        ) : documentsData && documentsData.documents.length > 0 ? (
          <div className="border border-border rounded-[var(--radius-md)] overflow-hidden bg-surface">
            <div className="overflow-x-auto">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken">
                    <th className="text-left py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Document</th>
                    <th className="text-left py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Type</th>
                    <th className="text-left py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Size</th>
                    <th className="text-left py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Pages</th>
                    <th className="text-left py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Status</th>
                    <th className="text-left py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Uploaded</th>
                    <th className="text-right py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {documentsData.documents.map((doc: Document) => (
                    <tr key={doc.id} className="hover:bg-surface-raised transition-colors">
                      <td className="py-2.5 px-3">
                        <div className="flex flex-col max-w-[280px]">
                          <div className="flex items-center gap-2">
                            <FileGlyph type={doc.file_type} size={15} />
                            <span className="truncate font-medium text-fg">{doc.original_filename}</span>
                          </div>
                          {doc.status === 'failed' && doc.error_message && (
                            <span
                              className="text-[11px] text-danger/90 truncate mt-0.5"
                              title={doc.error_message}
                            >
                              {doc.error_message}
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="py-2.5 px-3 uppercase text-[11px] font-mono text-fg-muted">
                        {doc.file_type}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[12px] text-fg-muted">
                        {formatBytes(doc.file_size)}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[12px] text-fg-muted">
                        {doc.page_count ?? '—'}
                      </td>
                      <td className="py-2.5 px-3">
                        <span
                          className={cn(
                            'inline-flex items-center gap-1.5 px-2 py-0.5 rounded-[4px] text-[11px] font-medium',
                            doc.status === 'indexed' && 'bg-success/15 text-success',
                            doc.status === 'processing' && 'bg-accent/15 text-accent animate-pulse',
                            doc.status === 'failed' && 'bg-danger/15 text-danger'
                          )}
                        >
                          {doc.status === 'indexed' && <CheckCircle2 size={11} />}
                          {doc.status === 'processing' && <RefreshCw size={11} className="animate-spin" />}
                          {doc.status === 'failed' && <AlertCircle size={11} />}
                          {doc.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[11px] text-fg-faint whitespace-nowrap">
                        {relativeTime(doc.created_at)}
                      </td>
                      <td className="py-2.5 px-3 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {doc.status === 'failed' && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={retryingId === doc.id}
                              onClick={() => retryMutation.mutate(doc.id)}
                              className="h-7 w-7 p-0 text-fg-faint hover:text-accent"
                              title="Retry processing"
                            >
                              <RefreshCw size={13} className={cn(retryingId === doc.id && 'animate-spin text-accent')} />
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => setDocumentToDelete(doc)}
                            className="h-7 w-7 p-0 text-fg-faint hover:text-danger"
                            title="Delete document"
                          >
                            <Trash2 size={13} />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : (
          <EmptyState
            title="No documents uploaded yet"
            description="Drag and drop your files above to populate the knowledge assistant."
          />
        )}
      </div>

      {/* Create Collection Dialog Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-[var(--radius-lg)] w-full max-w-[420px] p-6 shadow-xl space-y-4">
            <h3 className="text-[17px] font-medium text-fg" style={{ fontFamily: 'var(--font-serif)' }}>
              Create New Collection
            </h3>

            {createError && (
              <div className="p-3 bg-danger-subtle text-danger text-[12px] rounded-[var(--radius-sm)]">
                {createError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-medium text-fg block mb-1">Collection Name *</label>
                <Input
                  value={newCollectionName}
                  onChange={(e) => setNewCollectionName(e.target.value)}
                  placeholder="e.g. Finance & Q3 Audits"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-[12px] font-medium text-fg block mb-1">Description (optional)</label>
                <textarea
                  value={newCollectionDesc}
                  onChange={(e) => setNewCollectionDesc(e.target.value)}
                  placeholder="Brief summary of document topic..."
                  rows={2}
                  className="w-full rounded-[var(--radius-sm)] border border-border bg-surface-raised px-3 py-1.5 text-[13px] text-fg focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setShowCreateModal(false)}>
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!newCollectionName.trim() || createCollectionMutation.isPending}
                onClick={() => createCollectionMutation.mutate()}
              >
                {createCollectionMutation.isPending ? 'Creating...' : 'Create Collection'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {documentToDelete && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-[var(--radius-lg)] w-full max-w-[400px] p-6 shadow-xl space-y-4">
            <h3 className="text-[16px] font-medium text-fg">Delete Document?</h3>
            <p className="text-[13px] text-fg-muted leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <strong className="text-fg font-medium">"{documentToDelete.original_filename}"</strong>?
              Its embeddings and indexed search chunks will be permanently purged.
            </p>
            <div className="flex items-center justify-end gap-2 pt-2">
              <Button variant="ghost" size="sm" onClick={() => setDocumentToDelete(null)}>
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(documentToDelete.id)}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Permanently'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
