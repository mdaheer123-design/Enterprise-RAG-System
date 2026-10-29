/**
 * Knowledge AI — Zod Schemas & TypeScript Types
 * Runtime-validated types matching the backend API contract.
 * No `any` allowed.
 */
import { z } from 'zod';

// ── Collection ──────────────────────────────────────────────────
export const CollectionSchema = z.object({
  id: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  color: z.string(),
  icon: z.string(),
  document_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Collection = z.infer<typeof CollectionSchema>;

export const CollectionCreateSchema = z.object({
  name: z.string().min(1).max(255),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).default('#6366F1'),
  icon: z.string().max(50).default('folder'),
});
export type CollectionCreate = z.infer<typeof CollectionCreateSchema>;

export const CollectionUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  description: z.string().optional(),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/).optional(),
  icon: z.string().max(50).optional(),
});
export type CollectionUpdate = z.infer<typeof CollectionUpdateSchema>;

// ── Document ────────────────────────────────────────────────────
export const DocumentSchema = z.object({
  id: z.string(),
  filename: z.string(),
  original_filename: z.string(),
  file_type: z.string(),
  file_size: z.number(),
  page_count: z.number().nullable(),
  word_count: z.number().nullable(),
  author: z.string().nullable(),
  title: z.string().nullable(),
  status: z.enum(['processing', 'indexed', 'failed']),
  error_message: z.string().nullable(),
  collection_id: z.string().nullable(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Document = z.infer<typeof DocumentSchema>;

export const DocumentListSchema = z.object({
  documents: z.array(DocumentSchema),
  total: z.number(),
  page: z.number(),
  page_size: z.number(),
});
export type DocumentList = z.infer<typeof DocumentListSchema>;

// ── Citation ────────────────────────────────────────────────────
export const CitationSchema = z.object({
  id: z.string(),
  document_id: z.string(),
  chunk_id: z.string(),
  filename: z.string(),
  page_number: z.number().nullable(),
  paragraph_number: z.number().nullable(),
  relevance_score: z.number(),
  snippet: z.string(),
});
export type Citation = z.infer<typeof CitationSchema>;

// ── Chat Message ────────────────────────────────────────────────
export const MessageSchema = z.object({
  id: z.string(),
  chat_id: z.string(),
  role: z.enum(['user', 'assistant', 'system']),
  content: z.string(),
  tokens_used: z.number().nullable(),
  latency_ms: z.number().nullable(),
  model: z.string().nullable(),
  citations: z.array(CitationSchema).default([]),
  created_at: z.string(),
});
export type Message = z.infer<typeof MessageSchema>;

// ── Chat ────────────────────────────────────────────────────────
export const ChatSchema = z.object({
  id: z.string(),
  title: z.string(),
  collection_id: z.string().nullable(),
  is_active: z.boolean(),
  message_count: z.number(),
  created_at: z.string(),
  updated_at: z.string(),
});
export type Chat = z.infer<typeof ChatSchema>;

export const ChatListSchema = z.object({
  chats: z.array(ChatSchema),
  total: z.number(),
});
export type ChatList = z.infer<typeof ChatListSchema>;

export const ChatDetailSchema = z.object({
  chat: ChatSchema,
  messages: z.array(MessageSchema),
});
export type ChatDetail = z.infer<typeof ChatDetailSchema>;

// ── Query ───────────────────────────────────────────────────────
export const QueryRequestSchema = z.object({
  question: z.string().min(1).max(5000),
  chat_id: z.string().optional(),
  collection_id: z.string().optional(),
  filters: z.record(z.string(), z.unknown()).optional(),
});
export type QueryRequest = z.infer<typeof QueryRequestSchema>;

export const QueryResponseSchema = z.object({
  answer: z.string(),
  chat_id: z.string(),
  message_id: z.string(),
  citations: z.array(CitationSchema),
  confidence: z.number(),
  suggested_questions: z.array(z.string()).default([]),
  tokens_used: z.number().nullable(),
  latency_ms: z.number().nullable(),
});
export type QueryResponse = z.infer<typeof QueryResponseSchema>;

// ── Search ──────────────────────────────────────────────────────
export const SearchResultSchema = z.object({
  chunk_id: z.string(),
  document_id: z.string(),
  filename: z.string(),
  content: z.string(),
  page_number: z.number().nullable(),
  relevance_score: z.number(),
  highlight: z.string().nullable().optional(),
});
export type SearchResult = z.infer<typeof SearchResultSchema>;

export const SearchResponseSchema = z.object({
  results: z.array(SearchResultSchema),
  total: z.number(),
  query: z.string(),
  search_time_ms: z.number(),
});
export type SearchResponse = z.infer<typeof SearchResponseSchema>;

export const SearchRequestSchema = z.object({
  query: z.string().min(1).max(1000),
  collection_id: z.string().optional(),
  file_type: z.string().optional(),
  filename: z.string().optional(),
  top_k: z.number().min(1).max(50).default(10),
});
export type SearchRequest = z.infer<typeof SearchRequestSchema>;

// ── Comparison ──────────────────────────────────────────────────
export const ComparisonDifferenceSchema = z.object({
  type: z.enum(['added', 'removed', 'modified']),
  category: z.string(),
  location_a: z.string().nullable(),
  location_b: z.string().nullable(),
  content_a: z.string().nullable(),
  content_b: z.string().nullable(),
  description: z.string(),
});
export type ComparisonDifference = z.infer<typeof ComparisonDifferenceSchema>;

export const ComparisonResponseSchema = z.object({
  id: z.string(),
  comparison_id: z.string().optional(),
  document_a_id: z.string().optional(),
  document_a_filename: z.string().optional(),
  document_b_id: z.string().optional(),
  document_b_filename: z.string().optional(),
  comparison_mode: z.string().optional().default('semantic'),
  comparison_status: z.string().optional().default('completed'),
  added_count: z.number().optional().default(0),
  removed_count: z.number().optional().default(0),
  modified_count: z.number().optional().default(0),
  detailed_changes: z.array(ComparisonDifferenceSchema).optional().default([]),
  document_a: DocumentSchema,
  document_b: DocumentSchema,
  differences: z.array(ComparisonDifferenceSchema),
  summary: z.string(),
  status: z.string(),
  created_at: z.string(),
});
export type ComparisonResponse = z.infer<typeof ComparisonResponseSchema>;

// ── Analytics ───────────────────────────────────────────────────
export const AnalyticsOverviewSchema = z.object({
  total_documents: z.number(),
  total_collections: z.number(),
  total_chats: z.number(),
  total_questions: z.number(),
  total_storage_bytes: z.number(),
  documents_by_type: z.record(z.string(), z.number()),
  recent_uploads: z.array(DocumentSchema),
  questions_per_day: z.array(z.object({
    date: z.string(),
    count: z.number(),
  })),
});
export type AnalyticsOverview = z.infer<typeof AnalyticsOverviewSchema>;

// ── SSE Events ──────────────────────────────────────────────────
export const SSETokenEventSchema = z.object({
  type: z.literal('token'),
  data: z.string(),
});

export const SSEChatIdEventSchema = z.object({
  type: z.literal('chat_id'),
  data: z.string(),
});

export const SSEDoneEventSchema = z.object({
  type: z.literal('done'),
  data: z.object({
    citations: z.array(CitationSchema).default([]),
    confidence: z.number().optional(),
    suggested_questions: z.array(z.string()).default([]),
    latency_ms: z.number().optional(),
  }),
});

export const SSEStatusEventSchema = z.object({
  type: z.literal('status'),
  data: z.string(),
});

export const SSEErrorEventSchema = z.object({
  type: z.literal('error'),
  data: z.string(),
});

export const SSEEventSchema = z.discriminatedUnion('type', [
  SSETokenEventSchema,
  SSEChatIdEventSchema,
  SSEDoneEventSchema,
  SSEStatusEventSchema,
  SSEErrorEventSchema,
]);
export type SSEEvent = z.infer<typeof SSEEventSchema>;

// ── Scope ───────────────────────────────────────────────────────
export type ScopeType = 'all' | 'collection' | 'documents';
export interface Scope {
  type: ScopeType;
  id?: string;
  label: string;
}

// ── Cleanup ─────────────────────────────────────────────────────
export const CleanupStatusSchema = z.object({
  enabled: z.boolean(),
  interval_days: z.number(),
  retention_days: z.number(),
  last_cleanup_at: z.string().nullable(),
  next_cleanup_at: z.string().nullable(),
  last_deleted_counts: z.record(z.string(), z.number()).nullable(),
  status: z.string(),
  message: z.string().nullable(),
});
export type CleanupStatus = z.infer<typeof CleanupStatusSchema>;

export const CleanupRunResponseSchema = z.object({
  status: z.string(),
  message: z.string(),
  last_cleanup_at: z.string(),
  next_cleanup_at: z.string(),
  records_deleted: z.record(z.string(), z.number()),
});
export type CleanupRunResponse = z.infer<typeof CleanupRunResponseSchema>;

