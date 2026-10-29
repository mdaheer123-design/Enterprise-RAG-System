/**
 * Knowledge AI — Typed API Endpoints
 * All API calls, validated with zod.
 */
import { apiClient } from './client';
import {
  DocumentSchema,
  DocumentListSchema,
  CollectionSchema,
  ChatSchema,
  ChatListSchema,
  ChatDetailSchema,
  QueryResponseSchema,
  SearchResponseSchema,
  ComparisonResponseSchema,
  AnalyticsOverviewSchema,
  CleanupStatusSchema,
  CleanupRunResponseSchema,
  type DocumentList,
  type Collection,
  type CollectionCreate,
  type CollectionUpdate,
  type Chat,
  type ChatList,
  type ChatDetail,
  type QueryResponse,
  type SearchResponse,
  type ComparisonResponse,
  type AnalyticsOverview,
  type CleanupStatus,
  type CleanupRunResponse,
  type Document,
  type QueryRequest,
  type SearchRequest,
} from '@/types/api';

// ── Documents ───────────────────────────────────────────────────
export const documentsApi = {
  async list(params?: {
    page?: number;
    page_size?: number;
    collection_id?: string;
    file_type?: string;
    status?: string;
    search?: string;
  }): Promise<DocumentList> {
    const { data } = await apiClient.get('/documents/', { params });
    return DocumentListSchema.parse(data);
  },

  async get(id: string): Promise<Document> {
    const { data } = await apiClient.get(`/documents/${id}`);
    return DocumentSchema.parse(data);
  },

  async upload(files: File[], collectionId?: string): Promise<Document[]> {
    const formData = new FormData();
    files.forEach((file) => formData.append('files', file));
    if (collectionId) formData.append('collection_id', collectionId);

    const { data } = await apiClient.post('/documents/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' },
      timeout: 120000,
    });
    return data.map((d: unknown) => DocumentSchema.parse(d));
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/documents/${id}`);
  },

  async retry(id: string): Promise<Document> {
    const { data } = await apiClient.post(`/documents/${id}/retry`);
    return DocumentSchema.parse(data);
  },
};

// ── Collections ─────────────────────────────────────────────────
export const collectionsApi = {
  async list(): Promise<Collection[]> {
    const { data } = await apiClient.get('/collections/');
    return data.map((c: unknown) => CollectionSchema.parse(c));
  },

  async get(id: string): Promise<Collection> {
    const { data } = await apiClient.get(`/collections/${id}`);
    return CollectionSchema.parse(data);
  },

  async create(input: CollectionCreate): Promise<Collection> {
    const { data } = await apiClient.post('/collections/', input);
    return CollectionSchema.parse(data);
  },

  async update(id: string, input: CollectionUpdate): Promise<Collection> {
    const { data } = await apiClient.put(`/collections/${id}`, input);
    return CollectionSchema.parse(data);
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/collections/${id}`);
  },
};

// ── Chat ────────────────────────────────────────────────────────
export const chatApi = {
  async list(params?: { page?: number; page_size?: number }): Promise<ChatList> {
    const { data } = await apiClient.get('/chat/', { params });
    return ChatListSchema.parse(data);
  },

  async get(id: string): Promise<ChatDetail> {
    const { data } = await apiClient.get(`/chat/${id}`);
    return ChatDetailSchema.parse(data);
  },

  async create(input: { title?: string; collection_id?: string }): Promise<Chat> {
    const { data } = await apiClient.post('/chat/', input);
    return ChatSchema.parse(data);
  },

  async ask(input: QueryRequest): Promise<QueryResponse> {
    const { data } = await apiClient.post('/chat/ask', input);
    return QueryResponseSchema.parse(data);
  },

  async delete(id: string): Promise<void> {
    await apiClient.delete(`/chat/${id}`);
  },

  async history(chatId: string, limit = 50): Promise<unknown> {
    const { data } = await apiClient.get(`/chat/${chatId}/history`, {
      params: { limit },
    });
    return data;
  },
};

// ── Search ──────────────────────────────────────────────────────
export const searchApi = {
  async hybrid(input: SearchRequest): Promise<SearchResponse> {
    const { data } = await apiClient.post('/search/', input);
    return SearchResponseSchema.parse(data);
  },
};

// ── Comparison ──────────────────────────────────────────────────
export const compareApi = {
  async compare(documentAId: string, documentBId: string): Promise<ComparisonResponse> {
    const { data } = await apiClient.post('/compare/', {
      document_a_id: documentAId,
      document_b_id: documentBId,
    });
    return ComparisonResponseSchema.parse(data);
  },

  async list(params?: { document_a_id?: string; document_b_id?: string }): Promise<ComparisonResponse[]> {
    const { data } = await apiClient.get('/compare/', { params });
    return data.map((c: unknown) => ComparisonResponseSchema.parse(c));
  },

  async getById(id: string): Promise<ComparisonResponse> {
    const { data } = await apiClient.get(`/compare/${id}`);
    return ComparisonResponseSchema.parse(data);
  },
};

// ── Analytics ───────────────────────────────────────────────────
export const analyticsApi = {
  async overview(): Promise<AnalyticsOverview> {
    const { data } = await apiClient.get('/analytics/overview');
    return AnalyticsOverviewSchema.parse(data);
  },
};

// ── Cleanup ─────────────────────────────────────────────────────
export const cleanupApi = {
  async getStatus(): Promise<CleanupStatus> {
    const { data } = await apiClient.get('/cleanup/status');
    return CleanupStatusSchema.parse(data);
  },

  async runCleanup(olderThanDays: number = 7, force: boolean = false): Promise<CleanupRunResponse> {
    const { data } = await apiClient.post('/cleanup/run', {
      older_than_days: olderThanDays,
      force,
    });
    return CleanupRunResponseSchema.parse(data);
  },
};

