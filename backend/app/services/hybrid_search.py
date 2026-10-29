"""
Hybrid Search Service
Combines Dense Vector Search (ChromaDB) with BM25 Keyword Search
using Reciprocal Rank Fusion (RRF) for optimal retrieval.
Includes query normalization and multi-query expansion for acronyms/abbreviations.
"""

import math
import re
from typing import Dict, List, Optional, Any, Set

from rank_bm25 import BM25Okapi
from sqlalchemy import select
from sqlalchemy.orm import selectinload
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.models import DocumentChunk, Document
from app.services.embedding import EmbeddingService
from app.services.vector_store import VectorStore
from app.services.query_understanding import QueryUnderstandingService

logger = get_logger(__name__)
settings = get_settings()


class HybridSearchService:
    """
    Performs hybrid retrieval combining:
    1. Dense vector search via ChromaDB (with query expansion)
    2. Sparse keyword search via BM25 (with regex tokenization and keyword matching)
    Fused using Reciprocal Rank Fusion (RRF).
    """

    def __init__(self):
        self.embedding_service = EmbeddingService()
        self.vector_store = VectorStore()
        self.query_expander = QueryUnderstandingService()
        self.dense_weight = settings.dense_weight
        self.bm25_weight = settings.bm25_weight
        self.rrf_k = 60  # RRF constant

    async def search(
        self,
        query: str,
        db: AsyncSession,
        top_k: int = 20,
        collection_id: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> List[Dict[str, Any]]:
        """
        Execute hybrid search combining dense + sparse retrieval.

        Args:
            query: User's natural language query
            db: Database session for BM25 corpus
            top_k: Number of results to return
            collection_id: Optional filter by collection
            filters: Additional metadata filters

        Returns:
            List of ranked results with scores and metadata
        """
        # ── 0. Query Understanding & Expansion ────────────────────
        expansion_queries, keywords = self.query_expander.expand_query(query)

        # ── 1. Dense Vector Search (Multi-query expanded) ────────
        dense_results = await self._dense_search(expansion_queries, top_k * 2, collection_id, filters)

        # ── 2. BM25 Keyword Search (Tokenized with keywords) ─────
        bm25_results = await self._bm25_search(query, keywords, db, top_k * 2, collection_id)

        # ── 3. Reciprocal Rank Fusion ────────────────────────────
        fused = self._reciprocal_rank_fusion(dense_results, bm25_results, top_k)

        logger.info(
            "hybrid_search_complete",
            original_query=query[:60],
            expansions_count=len(expansion_queries),
            keywords=list(keywords)[:5],
            dense_count=len(dense_results),
            bm25_count=len(bm25_results),
            fused_count=len(fused),
        )

        return fused

    async def _dense_search(
        self,
        queries: List[str],
        top_k: int,
        collection_id: Optional[str],
        filters: Optional[Dict[str, Any]],
    ) -> List[Dict[str, Any]]:
        """
        Perform dense vector search using ChromaDB.
        Runs vector query across original query and any expanded variants,
        merging results by best similarity score.
        """
        where = {}
        if collection_id:
            where["collection_id"] = collection_id
        if filters:
            for key, value in filters.items():
                if value is not None:
                    where[key] = value

        chunk_map: Dict[str, Dict[str, Any]] = {}

        # Query ChromaDB for each query variant (original query is first)
        for q_idx, q_text in enumerate(queries[:3]):  # Limit to top 3 expansions
            query_embedding = self.embedding_service.embed_query(q_text)
            results = self.vector_store.query(
                query_embedding=query_embedding,
                n_results=top_k,
                where=where if where else None,
            )

            for i, (chunk_id, doc, meta, distance) in enumerate(zip(
                results["ids"], results["documents"], results["metadatas"], results["distances"]
            )):
                similarity = 1.0 - distance
                if chunk_id not in chunk_map or similarity > chunk_map[chunk_id]["score"]:
                    chunk_map[chunk_id] = {
                        "chunk_id": chunk_id,
                        "content": doc,
                        "metadata": meta,
                        "score": similarity,
                        "source": "dense",
                        "matched_query": q_text,
                    }

        # Sort all unique chunks by best similarity score
        sorted_chunks = sorted(chunk_map.values(), key=lambda x: x["score"], reverse=True)

        ranked = []
        for rank, item in enumerate(sorted_chunks[:top_k]):
            item["rank"] = rank + 1
            ranked.append(item)

        return ranked

    async def _bm25_search(
        self,
        query: str,
        keywords: Set[str],
        db: AsyncSession,
        top_k: int,
        collection_id: Optional[str],
    ) -> List[Dict[str, Any]]:
        """
        Perform BM25 keyword search over document chunks in the database.
        Uses clean regex tokenization to handle punctuation, slashes, and acronyms.
        """
        stmt = select(DocumentChunk).options(selectinload(DocumentChunk.document)).join(Document)
        if collection_id:
            stmt = stmt.where(Document.collection_id == collection_id)
        stmt = stmt.where(Document.status == "indexed")

        result = await db.execute(stmt)
        chunks = result.scalars().all()

        if not chunks:
            return []

        # Tokenize corpus with regex word matching (\w+)
        def tokenize(text: str) -> List[str]:
            return re.findall(r"\b\w+\b", text.lower())

        corpus = [tokenize(chunk.content) for chunk in chunks]
        bm25 = BM25Okapi(corpus)

        # Build query tokens: combine tokenized user query + extracted keywords
        query_tokens = tokenize(query)
        combined_tokens = list(set(query_tokens) | keywords)

        scores = bm25.get_scores(combined_tokens)

        # Rank results
        scored_chunks = list(zip(chunks, scores))
        scored_chunks.sort(key=lambda x: x[1], reverse=True)

        ranked = []
        for rank, (chunk, score) in enumerate(scored_chunks[:top_k]):
            if score <= 0:
                continue

            meta_json = chunk.metadata_json or {}
            doc = getattr(chunk, "document", None)
            filename = doc.original_filename if doc else meta_json.get("filename", "")
            doc_col_id = doc.collection_id if doc else meta_json.get("collection_id")

            ranked.append({
                "chunk_id": chunk.id,
                "content": chunk.content,
                "metadata": {
                    "document_id": chunk.document_id,
                    "filename": filename,
                    "page_number": chunk.page_number,
                    "paragraph_number": chunk.paragraph_number,
                    "chunk_index": chunk.chunk_index,
                    "collection_id": doc_col_id,
                },
                "score": float(score),
                "rank": rank + 1,
                "source": "bm25",
            })

        return ranked

    def _reciprocal_rank_fusion(
        self,
        dense_results: List[Dict[str, Any]],
        bm25_results: List[Dict[str, Any]],
        top_k: int,
    ) -> List[Dict[str, Any]]:
        """
        Fuse results from dense and BM25 search using Reciprocal Rank Fusion.
        RRF score = sum(weight * (1 / (k + rank))) for each result list.
        Preserves original retrieval metadata (dense_rank, dense_score, bm25_rank, bm25_score).
        """
        fused_scores: Dict[str, float] = {}
        result_map: Dict[str, Dict[str, Any]] = {}
        dense_ranks: Dict[str, int] = {}
        dense_scores: Dict[str, float] = {}
        bm25_ranks: Dict[str, int] = {}
        bm25_scores: Dict[str, float] = {}

        # Score dense results
        for item in dense_results:
            chunk_id = item["chunk_id"]
            dense_ranks[chunk_id] = item["rank"]
            dense_scores[chunk_id] = item["score"]
            rrf_score = self.dense_weight * (1.0 / (self.rrf_k + item["rank"]))
            fused_scores[chunk_id] = fused_scores.get(chunk_id, 0) + rrf_score
            if chunk_id not in result_map:
                result_map[chunk_id] = item

        # Score BM25 results
        for item in bm25_results:
            chunk_id = item["chunk_id"]
            bm25_ranks[chunk_id] = item["rank"]
            bm25_scores[chunk_id] = item["score"]
            rrf_score = self.bm25_weight * (1.0 / (self.rrf_k + item["rank"]))
            fused_scores[chunk_id] = fused_scores.get(chunk_id, 0) + rrf_score
            if chunk_id not in result_map:
                result_map[chunk_id] = item

        # Sort by fused score descending
        sorted_ids = sorted(fused_scores.keys(), key=lambda x: fused_scores[x], reverse=True)

        fused_results = []
        for rank, chunk_id in enumerate(sorted_ids[:top_k]):
            item = result_map[chunk_id].copy()
            item["fused_score"] = fused_scores[chunk_id]
            item["rank"] = rank + 1
            item["dense_rank"] = dense_ranks.get(chunk_id)
            item["dense_score"] = dense_scores.get(chunk_id)
            item["bm25_rank"] = bm25_ranks.get(chunk_id)
            item["bm25_score"] = bm25_scores.get(chunk_id)
            fused_results.append(item)

        return fused_results
