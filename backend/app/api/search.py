"""
Search API Routes
Handles hybrid search and metadata-based search.
"""

import time

from fastapi import APIRouter, Depends
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.schemas.schemas import SearchRequest, SearchResponse, SearchResult
from app.services.hybrid_search import HybridSearchService
from app.services.reranker import RerankerService

logger = get_logger(__name__)
router = APIRouter(prefix="/search", tags=["Search"])

search_service = HybridSearchService()
reranker = RerankerService()


@router.post("/", response_model=SearchResponse)
async def hybrid_search(
    data: SearchRequest,
    db: AsyncSession = Depends(get_db),
):
    """Perform hybrid search across all documents."""
    start = time.time()

    # Hybrid search
    results = await search_service.search(
        query=data.query,
        db=db,
        top_k=data.top_k * 4,  # Retrieve more for reranking
        collection_id=data.collection_id,
    )

    # Rerank
    reranked = reranker.rerank(
        query=data.query,
        chunks=results,
        top_k=data.top_k,
    )

    # Format results
    search_results = []
    for r in reranked:
        meta = r.get("metadata", {})
        search_results.append(SearchResult(
            chunk_id=r["chunk_id"],
            document_id=meta.get("document_id", ""),
            filename=meta.get("filename", "Unknown"),
            content=r["content"],
            page_number=meta.get("page_number"),
            relevance_score=r.get("rerank_score", r.get("fused_score", 0)),
        ))

    search_time_ms = int((time.time() - start) * 1000)

    return SearchResponse(
        results=search_results,
        total=len(search_results),
        query=data.query,
        search_time_ms=search_time_ms,
    )
