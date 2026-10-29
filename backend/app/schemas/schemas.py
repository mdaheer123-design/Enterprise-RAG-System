"""
Pydantic schemas for API request/response validation.
"""

from datetime import datetime
from typing import Optional, List, Dict, Any
from pydantic import BaseModel, Field


# ── Collection Schemas ───────────────────────────────────────────
class CollectionCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: Optional[str] = None
    color: str = Field(default="#6366F1", pattern=r"^#[0-9a-fA-F]{6}$")
    icon: str = Field(default="folder", max_length=50)


class CollectionUpdate(BaseModel):
    name: Optional[str] = Field(None, min_length=1, max_length=255)
    description: Optional[str] = None
    color: Optional[str] = Field(None, pattern=r"^#[0-9a-fA-F]{6}$")
    icon: Optional[str] = Field(None, max_length=50)


class CollectionResponse(BaseModel):
    id: str
    name: str
    description: Optional[str]
    color: str
    icon: str
    document_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


# ── Document Schemas ─────────────────────────────────────────────
class DocumentResponse(BaseModel):
    id: str
    filename: str
    original_filename: str
    file_type: str
    file_size: int
    page_count: Optional[int]
    word_count: Optional[int]
    author: Optional[str]
    title: Optional[str]
    status: str
    error_message: Optional[str]
    collection_id: Optional[str]
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class DocumentListResponse(BaseModel):
    documents: List[DocumentResponse]
    total: int
    page: int
    page_size: int


# ── Chat Schemas ─────────────────────────────────────────────────
class ChatCreate(BaseModel):
    title: Optional[str] = "New Chat"
    collection_id: Optional[str] = None


class ChatResponse(BaseModel):
    id: str
    title: str
    collection_id: Optional[str]
    is_active: bool
    message_count: int
    created_at: datetime
    updated_at: datetime

    model_config = {"from_attributes": True}


class ChatListResponse(BaseModel):
    chats: List[ChatResponse]
    total: int


# ── Message Schemas ──────────────────────────────────────────────
class CitationResponse(BaseModel):
    id: Optional[str] = None
    document_id: str
    chunk_id: str
    filename: str
    page_number: Optional[int] = None
    paragraph_number: Optional[int] = None
    relevance_score: float
    snippet: str

    model_config = {"from_attributes": True}


class MessageResponse(BaseModel):
    id: str
    chat_id: str
    role: str
    content: str
    tokens_used: Optional[int]
    latency_ms: Optional[int]
    model: Optional[str]
    citations: List[CitationResponse] = []
    created_at: datetime

    model_config = {"from_attributes": True}


class ChatDetailResponse(BaseModel):
    chat: ChatResponse
    messages: List[MessageResponse]


# ── Query Schemas ────────────────────────────────────────────────
class QueryRequest(BaseModel):
    question: str = Field(..., min_length=1, max_length=5000)
    chat_id: Optional[str] = None
    collection_id: Optional[str] = None
    filters: Optional[Dict[str, Any]] = None


class QueryResponse(BaseModel):
    answer: str
    chat_id: str
    message_id: str
    citations: List[CitationResponse]
    confidence: float
    suggested_questions: List[str] = []
    tokens_used: Optional[int] = None
    latency_ms: Optional[int] = None


# ── Search Schemas ───────────────────────────────────────────────
class SearchRequest(BaseModel):
    query: str = Field(..., min_length=1, max_length=1000)
    collection_id: Optional[str] = None
    file_type: Optional[str] = None
    filename: Optional[str] = None
    top_k: int = Field(default=10, ge=1, le=50)


class SearchResult(BaseModel):
    chunk_id: str
    document_id: str
    filename: str
    content: str
    page_number: Optional[int]
    relevance_score: float
    highlight: Optional[str] = None


class SearchResponse(BaseModel):
    results: List[SearchResult]
    total: int
    query: str
    search_time_ms: int


# ── Comparison Schemas ───────────────────────────────────────────
class ComparisonRequest(BaseModel):
    document_a_id: str
    document_b_id: str


class ComparisonDifference(BaseModel):
    type: str  # added, removed, modified
    category: str  # clause, date, salary, policy, text
    location_a: Optional[str] = None
    location_b: Optional[str] = None
    content_a: Optional[str] = None
    content_b: Optional[str] = None
    description: str


class ComparisonResponse(BaseModel):
    id: str
    comparison_id: Optional[str] = None
    document_a_id: Optional[str] = None
    document_a_filename: Optional[str] = None
    document_b_id: Optional[str] = None
    document_b_filename: Optional[str] = None
    document_a: DocumentResponse
    document_b: DocumentResponse
    comparison_mode: str = "semantic"
    comparison_status: str = "completed"
    summary: str
    status: str = "completed"
    added_count: int = 0
    removed_count: int = 0
    modified_count: int = 0
    detailed_changes: List[ComparisonDifference] = []
    differences: List[ComparisonDifference] = []
    created_at: datetime

    model_config = {"from_attributes": True}


# ── Analytics Schemas ────────────────────────────────────────────
class AnalyticsOverview(BaseModel):
    total_documents: int
    total_collections: int
    total_chats: int
    total_questions: int
    total_storage_bytes: int
    documents_by_type: Dict[str, int]
    recent_uploads: List[DocumentResponse]
    questions_per_day: List[Dict[str, Any]]


# ── Cleanup Schemas ──────────────────────────────────────────────
class CleanupStatusResponse(BaseModel):
    enabled: bool = True
    interval_days: int = 7
    retention_days: int = 7
    last_cleanup_at: Optional[datetime] = None
    next_cleanup_at: Optional[datetime] = None
    last_deleted_counts: Optional[Dict[str, int]] = None
    status: str = "idle"
    message: Optional[str] = None


class CleanupRunRequest(BaseModel):
    older_than_days: Optional[int] = Field(default=7, ge=0)
    force: bool = False


class CleanupRunResponse(BaseModel):
    status: str
    message: str
    last_cleanup_at: datetime
    next_cleanup_at: datetime
    records_deleted: Dict[str, int]

