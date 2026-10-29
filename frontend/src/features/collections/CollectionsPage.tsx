/**
 * Knowledge AI — Collections Management Page
 * List collections, create, rename, delete with confirmation,
 * drill down into collection documents, and launch chat scoped to a collection.
 */
import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  FolderOpen,
  Plus,
  Trash2,
  Edit2,
  FileText,
  MessageSquare,
  Upload,
  Search,
  ExternalLink,
  ChevronRight,
  ArrowLeft,
  CheckCircle2,
} from 'lucide-react';
import { collectionsApi, documentsApi } from '@/lib/api/endpoints';
import { PageHeader, EmptyState, Skeleton, FileGlyph } from '@/components/shared';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useScope } from '@/hooks/useScope';
import { formatBytes, relativeTime, cn } from '@/lib/utils';
import type { Collection, Document } from '@/types/api';
import { toast } from 'sonner';

export default function CollectionsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { setScope } = useScope();

  // Active view: list or detail
  const [selectedCollection, setSelectedCollection] = useState<Collection | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Modals state
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [editingCollection, setEditingCollection] = useState<Collection | null>(null);
  const [deletingCollection, setDeletingCollection] = useState<Collection | null>(null);
  const [typedConfirmName, setTypedConfirmName] = useState('');

  // Form fields
  const [formName, setFormName] = useState('');
  const [formDesc, setFormDesc] = useState('');
  const [formError, setFormError] = useState('');

  // Fetch collections
  const { data: collections = [], isLoading } = useQuery({
    queryKey: ['collections'],
    queryFn: () => collectionsApi.list(),
  });

  // Fetch documents for selected collection
  const {
    data: collectionDocsData,
    isLoading: docsLoading,
  } = useQuery({
    queryKey: ['documents', { collection_id: selectedCollection?.id }],
    queryFn: () => documentsApi.list({ collection_id: selectedCollection!.id }),
    enabled: !!selectedCollection,
  });

  // Create mutation
  const createMutation = useMutation({
    mutationFn: () =>
      collectionsApi.create({
        name: formName.trim(),
        description: formDesc.trim() || undefined,
        color: '#6366F1',
        icon: 'folder',
      }),
    onSuccess: (newCol) => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setShowCreateModal(false);
      setFormName('');
      setFormDesc('');
      toast.success(`Collection "${newCol.name}" created`);
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to create collection');
    },
  });

  // Update mutation
  const updateMutation = useMutation({
    mutationFn: () =>
      collectionsApi.update(editingCollection!.id, {
        name: formName.trim(),
        description: formDesc.trim() || undefined,
      }),
    onSuccess: (updatedCol) => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      setEditingCollection(null);
      if (selectedCollection?.id === updatedCol.id) {
        setSelectedCollection(updatedCol);
      }
      toast.success(`Collection "${updatedCol.name}" updated`);
    },
    onError: (err: any) => {
      setFormError(err.message || 'Failed to update collection');
    },
  });

  // Delete mutation
  const deleteMutation = useMutation({
    mutationFn: (id: string) => collectionsApi.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['collections'] });
      queryClient.invalidateQueries({ queryKey: ['documents'] });
      if (selectedCollection?.id === deletingCollection?.id) {
        setSelectedCollection(null);
      }
      setDeletingCollection(null);
      setTypedConfirmName('');
      toast.success('Collection deleted');
    },
    onError: (err: any) => {
      toast.error(err.message || 'Failed to delete collection');
    },
  });

  // Start chat with collection
  const handleChatWithCollection = (col: Collection) => {
    setScope({
      type: 'collection',
      id: col.id,
      label: col.name,
    });
    navigate('/chat');
  };

  // Upload to collection
  const handleUploadToCollection = (col: Collection) => {
    localStorage.setItem('knowledge_ai_last_collection', col.id);
    navigate('/upload');
  };

  const filteredCollections = collections.filter(
    (c) =>
      c.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
      c.description?.toLowerCase().includes(searchQuery.toLowerCase())
  );

  return (
    <div className="p-6 max-w-[1200px] mx-auto space-y-6">
      {/* Detail View Header */}
      {selectedCollection ? (
        <div className="space-y-4">
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedCollection(null)}
            className="gap-1.5 text-fg-muted -ml-2"
          >
            <ArrowLeft size={14} />
            Back to Collections
          </Button>

          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 p-5 border border-border rounded-[var(--radius-md)] bg-surface">
            <div>
              <div className="flex items-center gap-2">
                <FolderOpen className="text-accent" size={20} />
                <h1 className="text-[22px] font-semibold text-fg tracking-tight" style={{ fontFamily: 'var(--font-serif)' }}>
                  {selectedCollection.name}
                </h1>
              </div>
              <p className="mt-1 text-[13px] text-fg-muted max-w-[600px]">
                {selectedCollection.description || 'No description provided.'}
              </p>
              <div className="flex items-center gap-4 mt-3 text-[12px] font-mono text-fg-faint">
                <span>{selectedCollection.document_count} documents</span>
                <span>·</span>
                <span>Created {relativeTime(selectedCollection.created_at)}</span>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <Button
                variant="primary"
                size="sm"
                onClick={() => handleChatWithCollection(selectedCollection)}
                className="gap-1.5"
              >
                <MessageSquare size={14} />
                Chat with Collection
              </Button>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => handleUploadToCollection(selectedCollection)}
                className="gap-1.5"
              >
                <Upload size={14} />
                Upload Documents
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setDeletingCollection(selectedCollection)}
                className="gap-1.5 text-danger hover:text-danger hover:bg-danger-subtle"
                title="Delete this collection"
              >
                <Trash2 size={14} />
                Delete
              </Button>
            </div>
          </div>
        </div>
      ) : (
        /* List View Header */
        <PageHeader
          title="Collections"
          subtitle="Organize documents into thematic knowledge silos for targeted retrieval."
          actions={
            <Button
              variant="primary"
              size="sm"
              onClick={() => {
                setFormName('');
                setFormDesc('');
                setFormError('');
                setShowCreateModal(true);
              }}
              className="gap-1.5"
            >
              <Plus size={14} />
              New Collection
            </Button>
          }
        />
      )}

      {/* Main Content Area */}
      {selectedCollection ? (
        /* Documents inside selected collection */
        <div className="space-y-4">
          <h2 className="text-[15px] font-medium text-fg">Documents in this Collection</h2>

          {docsLoading ? (
            <div className="space-y-2">
              {[...Array(3)].map((_, i) => (
                <Skeleton key={i} className="h-12 w-full" />
              ))}
            </div>
          ) : collectionDocsData && collectionDocsData.documents.length > 0 ? (
            <div className="border border-border rounded-[var(--radius-md)] overflow-hidden bg-surface">
              <table className="w-full text-[13px]">
                <thead>
                  <tr className="border-b border-border bg-surface-sunken">
                    <th className="text-left py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Document</th>
                    <th className="text-left py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Type</th>
                    <th className="text-left py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Size</th>
                    <th className="text-left py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Status</th>
                    <th className="text-right py-2.5 px-3 text-[11px] text-fg-faint uppercase tracking-wider font-medium">Added</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {collectionDocsData.documents.map((doc: Document) => (
                    <tr key={doc.id} className="hover:bg-surface-raised transition-colors">
                      <td className="py-2.5 px-3 font-medium text-fg">
                        <div className="flex items-center gap-2">
                          <FileGlyph type={doc.file_type} size={15} />
                          <span className="truncate max-w-[320px]">{doc.original_filename}</span>
                        </div>
                      </td>
                      <td className="py-2.5 px-3 uppercase font-mono text-[11px] text-fg-muted">
                        {doc.file_type}
                      </td>
                      <td className="py-2.5 px-3 font-mono text-[12px] text-fg-muted">
                        {formatBytes(doc.file_size)}
                      </td>
                      <td className="py-2.5 px-3">
                        <span className="inline-flex items-center gap-1 text-[11px] font-medium text-success">
                          <CheckCircle2 size={12} />
                          {doc.status}
                        </span>
                      </td>
                      <td className="py-2.5 px-3 text-right font-mono text-[11px] text-fg-faint whitespace-nowrap">
                        {relativeTime(doc.created_at)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : (
            <EmptyState
              title="No documents in this collection yet"
              description="Upload files into this collection to empower the knowledge assistant."
              action={
                <Button
                  variant="primary"
                  size="sm"
                  onClick={() => handleUploadToCollection(selectedCollection)}
                  className="gap-1.5"
                >
                  <Upload size={14} />
                  Upload Document Now
                </Button>
              }
            />
          )}
        </div>
      ) : (
        /* List View */
        <div className="space-y-4">
          {/* Search bar */}
          <div className="flex items-center justify-between gap-4">
            <div className="relative w-full max-w-sm">
              <Search className="absolute left-3 top-2.5 text-fg-faint" size={14} />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search collections..."
                className="pl-8"
              />
            </div>
            <span className="text-[12px] font-mono text-fg-muted whitespace-nowrap">
              {filteredCollections.length} total
            </span>
          </div>

          {isLoading ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {[...Array(6)].map((_, i) => (
                <Skeleton key={i} className="h-36 rounded-[var(--radius-md)]" />
              ))}
            </div>
          ) : filteredCollections.length > 0 ? (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {filteredCollections.map((col) => (
                <div
                  key={col.id}
                  className="group flex flex-col justify-between border border-border rounded-[var(--radius-md)] p-4 bg-surface hover:border-accent/40 hover:bg-surface-raised transition-all"
                >
                  <div>
                    <div className="flex items-start justify-between gap-2">
                      <div
                        className="cursor-pointer flex-1 min-w-0"
                        onClick={() => setSelectedCollection(col)}
                      >
                        <h3 className="text-[16px] font-medium text-fg truncate group-hover:text-accent transition-colors">
                          {col.name}
                        </h3>
                      </div>
                      <div className="flex items-center gap-1 opacity-80 group-hover:opacity-100">
                        <button
                          onClick={() => {
                            setEditingCollection(col);
                            setFormName(col.name);
                            setFormDesc(col.description || '');
                            setFormError('');
                          }}
                          className="p-1 text-fg-faint hover:text-fg rounded"
                          title="Edit collection"
                        >
                          <Edit2 size={13} />
                        </button>
                        <button
                          onClick={() => {
                            setDeletingCollection(col);
                            setTypedConfirmName('');
                          }}
                          className="p-1 text-fg-faint hover:text-danger rounded"
                          title="Delete collection"
                        >
                          <Trash2 size={13} />
                        </button>
                      </div>
                    </div>

                    <p
                      className="mt-2 text-[12px] text-fg-muted line-clamp-2 leading-relaxed cursor-pointer"
                      onClick={() => setSelectedCollection(col)}
                    >
                      {col.description || 'No description provided.'}
                    </p>
                  </div>

                  <div className="mt-4 pt-3 border-t border-border flex items-center justify-between text-[11px] font-mono text-fg-faint">
                    <span>{col.document_count} {col.document_count === 1 ? 'doc' : 'docs'}</span>

                    <div className="flex items-center gap-2">
                      <button
                        onClick={() => handleChatWithCollection(col)}
                        className="hover:text-accent font-medium flex items-center gap-1"
                        title="Chat with this collection"
                      >
                        <MessageSquare size={12} />
                        Chat
                      </button>
                      <span>·</span>
                      <button
                        onClick={() => setSelectedCollection(col)}
                        className="hover:text-fg flex items-center gap-0.5"
                      >
                        View
                        <ChevronRight size={12} />
                      </button>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              title={searchQuery ? 'No matching collections' : 'No collections yet'}
              description={
                searchQuery
                  ? 'Try adjusting your search query.'
                  : 'Collections help organize and compartmentalize your document knowledge.'
              }
              action={
                !searchQuery && (
                  <Button
                    variant="primary"
                    size="sm"
                    onClick={() => {
                      setFormName('');
                      setFormDesc('');
                      setFormError('');
                      setShowCreateModal(true);
                    }}
                    className="gap-1.5"
                  >
                    <Plus size={14} />
                    Create First Collection
                  </Button>
                )
              }
            />
          )}
        </div>
      )}

      {/* Create / Edit Dialog Modal */}
      {(showCreateModal || editingCollection) && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-[var(--radius-lg)] w-full max-w-[420px] p-6 shadow-xl space-y-4">
            <h3 className="text-[17px] font-medium text-fg" style={{ fontFamily: 'var(--font-serif)' }}>
              {editingCollection ? 'Edit Collection' : 'Create New Collection'}
            </h3>

            {formError && (
              <div className="p-3 bg-danger-subtle text-danger text-[12px] rounded-[var(--radius-sm)]">
                {formError}
              </div>
            )}

            <div className="space-y-3">
              <div>
                <label className="text-[12px] font-medium text-fg block mb-1">Collection Name *</label>
                <Input
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  placeholder="e.g. Legal Contracts"
                  autoFocus
                />
              </div>

              <div>
                <label className="text-[12px] font-medium text-fg block mb-1">Description (optional)</label>
                <textarea
                  value={formDesc}
                  onChange={(e) => setFormDesc(e.target.value)}
                  placeholder="Purpose or scope of this collection..."
                  rows={3}
                  className="w-full rounded-[var(--radius-sm)] border border-border bg-surface-raised px-3 py-1.5 text-[13px] text-fg focus:outline-none focus:border-accent"
                />
              </div>
            </div>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setShowCreateModal(false);
                  setEditingCollection(null);
                }}
              >
                Cancel
              </Button>
              <Button
                variant="primary"
                size="sm"
                disabled={!formName.trim() || createMutation.isPending || updateMutation.isPending}
                onClick={() => (editingCollection ? updateMutation.mutate() : createMutation.mutate())}
              >
                {editingCollection
                  ? updateMutation.isPending
                    ? 'Saving...'
                    : 'Save Changes'
                  : createMutation.isPending
                  ? 'Creating...'
                  : 'Create Collection'}
              </Button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Confirmation Modal */}
      {deletingCollection && (
        <div className="fixed inset-0 z-50 bg-black/60 flex items-center justify-center p-4">
          <div className="bg-surface border border-border rounded-[var(--radius-lg)] w-full max-w-[420px] p-6 shadow-xl space-y-4">
            <h3 className="text-[16px] font-medium text-danger">Delete Collection?</h3>
            <p className="text-[13px] text-fg-muted leading-relaxed">
              Are you sure you want to permanently delete{' '}
              <strong className="text-fg font-medium">"{deletingCollection.name}"</strong>
              {deletingCollection.document_count > 0 ? (
                <>
                  {' '}containing{' '}
                  <span className="font-mono text-fg">{deletingCollection.document_count}</span>{' '}
                  {deletingCollection.document_count === 1 ? 'document' : 'documents'}
                </>
              ) : ''}?
            </p>

            <div className="flex items-center justify-end gap-2 pt-2">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDeletingCollection(null);
                  setTypedConfirmName('');
                }}
              >
                Cancel
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={deleteMutation.isPending}
                onClick={() => deleteMutation.mutate(deletingCollection.id)}
              >
                {deleteMutation.isPending ? 'Deleting...' : 'Delete Collection'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
