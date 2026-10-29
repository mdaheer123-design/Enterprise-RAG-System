"""
RAG Pipeline Orchestrator
Coordinates the full RAG workflow:
Query Understanding → Hybrid Search → Cross-Encoder Reranking → Calibrated Hallucination Check → Gemini Generation → Citations.
Implements the Agentic RAG pattern with automatic intent routing and diagnostic reporting.
"""

import time
import inspect
from typing import AsyncGenerator, Dict, List, Optional, Any

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.logging import get_logger
from app.models.models import Chat, ChatMessage, Citation, DocumentChunk, Document
from app.services.hybrid_search import HybridSearchService
from app.services.reranker import RerankerService
from app.services.llm import LLMService
from app.services.query_understanding import QueryUnderstandingService

logger = get_logger(__name__)
settings = get_settings()


class RAGPipeline:
    """
    Full RAG pipeline orchestrator.
    Handles: Query → Hybrid Search → Reranking → Hallucination Check → LLM Generation → Citations.
    """

    def __init__(self):
        self.search_service = HybridSearchService()
        self.reranker = RerankerService()
        self.llm = LLMService()
        self.query_understanding = QueryUnderstandingService()

    async def _check_document_status(
        self, db: AsyncSession, collection_id: Optional[str] = None
    ) -> str:
        """
        Check database document status to avoid misleading failure messages.
        Returns: 'ok' | 'no_documents' | 'indexing'
        """
        stmt = select(func.count(Document.id))
        if collection_id:
            stmt = stmt.where(Document.collection_id == collection_id)
        total_docs = (await db.execute(stmt)).scalar() or 0

        if total_docs == 0:
            return "no_documents"

        indexed_stmt = select(func.count(Document.id)).where(Document.status == "indexed")
        if collection_id:
            indexed_stmt = indexed_stmt.where(Document.collection_id == collection_id)
        indexed_docs = (await db.execute(indexed_stmt)).scalar() or 0

        if indexed_docs == 0:
            return "indexing"

        return "ok"

    async def _resolve_document_mention(
        self, query: str, filters: Optional[Dict[str, Any]], db: AsyncSession
    ) -> tuple[str, Optional[Dict[str, Any]]]:
        """Resolve natural document references like 'in rag(pdf) ...' to target document filter."""
        active_filters = dict(filters) if filters else {}
        if "document_id" in active_filters:
            return query, active_filters

        docs: List[Any] = []
        try:
            docs_res = await db.execute(select(Document).where(Document.status == "indexed"))
            scalars_fn = getattr(docs_res, "scalars", None)
            if callable(scalars_fn):
                res = scalars_fn()
                if hasattr(res, "all") and not inspect.iscoroutine(res.all):
                    val = res.all()
                    if not inspect.iscoroutine(val) and isinstance(val, (list, tuple)):
                        docs = list(val)
        except Exception as e:
            logger.debug("resolve_doc_mention_query_failed", error=str(e))

        if docs:
            doc_id, cleaned_q = self.query_understanding.resolve_document_mention(query, docs)
            if doc_id:
                active_filters["document_id"] = doc_id
                logger.info("resolved_document_mention", original=query, doc_id=doc_id, cleaned=cleaned_q)
                return cleaned_q, active_filters

        return query, active_filters if active_filters else None

    async def process_query(
        self,
        query: str,
        db: AsyncSession,
        chat_id: Optional[str] = None,
        collection_id: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> Dict[str, Any]:
        """
        Execute the full RAG pipeline (non-streaming).

        Steps:
        1. Check document index status
        2. Route query through agent
        3. Retrieve top-20 chunks via hybrid search (with query expansion)
        4. Rerank to top-5 using cross-encoder
        5. Check calibrated hallucination threshold
        6. Generate answer with Gemini
        7. Extract citations and suggested questions
        """
        start = time.time()

        # ── 1. Document Index Status Check ───────────────────────
        doc_status = await self._check_document_status(db, collection_id)
        if doc_status == "no_documents":
            return {
                "answer": "No documents have been uploaded yet. Please upload relevant documents in the Upload section to begin.",
                "citations": [],
                "confidence": 0.0,
                "suggested_questions": ["How do I upload a document?", "What file formats are supported?"],
                "tokens_used": 0,
                "latency_ms": 0,
                "model": settings.gemini_model,
                "tool_used": "none",
            }
        elif doc_status == "indexing":
            return {
                "answer": "Your uploaded documents are still being processed and indexed. Please wait a moment and try again.",
                "citations": [],
                "confidence": 0.0,
                "suggested_questions": ["Check indexing status in Uploads"],
                "tokens_used": 0,
                "latency_ms": 0,
                "model": settings.gemini_model,
                "tool_used": "none",
            }

        # ── 2. Agent Routing ─────────────────────────────────────
        tool = self._route_query(query)
        logger.info("agent_routing", query=query[:100], selected_tool=tool)

        if tool == "conversational":
            return {
                "answer": "Hello! I am your Enterprise AI Knowledge Assistant. You can ask me any question about your uploaded documents, standards, or policies.",
                "citations": [],
                "confidence": 1.0,
                "suggested_questions": ["What documents are uploaded?", "Summarize the uploaded standard"],
                "tokens_used": 0,
                "latency_ms": 0,
                "model": settings.gemini_model,
                "tool_used": tool,
            }

        # ── 2.5 Resolve natural document references ──────────────
        query, filters = await self._resolve_document_mention(query, filters, db)

        # ── 3. Hybrid Search (Top 20) ────────────────────────────
        search_results = await self.search_service.search(
            query=query,
            db=db,
            top_k=settings.top_k_retrieval,
            collection_id=collection_id,
            filters=filters,
        )

        if not search_results:
            return self._low_confidence_response(chat_id, db)

        # ── 4. Reranking (Top 5) ─────────────────────────────────
        reranked = self.reranker.rerank(
            query=query,
            chunks=search_results,
            top_k=settings.top_k_rerank,
        )

        # ── 5. Hallucination Detection ───────────────────────────
        if not self.llm.check_hallucination(reranked):
            return self._low_confidence_response(chat_id, db)

        # ── 6. Get Chat History ──────────────────────────────────
        chat_history = await self._get_chat_history(db, chat_id) if chat_id else None

        # ── 7. Generate Answer ───────────────────────────────────
        llm_result = await self.llm.generate_answer(
            query=query,
            chunks=reranked,
            chat_history=chat_history,
        )

        # ── 8. Extract Suggested Questions & Citations ───────────
        suggested = self.llm.extract_suggested_questions(llm_result["answer"])
        citations = self._build_citations(reranked)
        confidence = self._calculate_confidence(reranked)

        latency_ms = int((time.time() - start) * 1000)

        result = {
            "answer": llm_result["answer"],
            "citations": citations,
            "confidence": confidence,
            "suggested_questions": suggested,
            "tokens_used": llm_result.get("tokens_used"),
            "latency_ms": latency_ms,
            "model": llm_result.get("model", settings.gemini_model),
            "tool_used": tool,
            "diagnostics": self._build_diagnostics(reranked) if settings.debug else None,
        }

        logger.info(
            "rag_pipeline_complete",
            latency_ms=latency_ms,
            confidence=confidence,
            citations_count=len(citations),
        )

        return result

    async def process_query_stream(
        self,
        query: str,
        db: AsyncSession,
        chat_id: Optional[str] = None,
        collection_id: Optional[str] = None,
        filters: Optional[Dict[str, Any]] = None,
    ) -> AsyncGenerator[Dict[str, Any], None]:
        """
        Execute RAG pipeline with streaming response.

        Yields:
            Dicts with type: "token" | "citations" | "done" | "error"
        """
        start = time.time()

        try:
            # ── 0. Document Index Status Check ───────────────────────
            doc_status = await self._check_document_status(db, collection_id)
            if doc_status == "no_documents":
                yield {"type": "token", "data": "No documents have been uploaded yet. Please upload documents in the Upload section to begin querying."}
                yield {"type": "done", "data": {"confidence": 0.0, "citations": [], "suggested_questions": ["How do I upload a document?"]}}
                return
            elif doc_status == "indexing":
                yield {"type": "token", "data": "Your uploaded documents are currently being processed and indexed. Please wait a moment for processing to finish."}
                yield {"type": "done", "data": {"confidence": 0.0, "citations": []}}
                return

            # ── 1. Agent Routing ─────────────────────────────────────
            tool = self._route_query(query)

            if tool == "conversational":
                yield {"type": "token", "data": "Hello! I am your Enterprise AI Knowledge Assistant. Ask me anything about your uploaded documents."}
                yield {"type": "done", "data": {"confidence": 1.0, "citations": [], "suggested_questions": ["What documents have been uploaded?"]}}
                return

            # ── 1.5 Resolve natural document references ──────────────
            query, filters = await self._resolve_document_mention(query, filters, db)

            # ── 2. Retrieval & Reranking ─────────────────────────────
            yield {"type": "status", "data": "Retrieving relevant passages…"}
            search_results = await self.search_service.search(
                query=query, db=db,
                top_k=settings.top_k_retrieval,
                collection_id=collection_id,
                filters=filters,
            )

            if not search_results:
                yield {
                    "type": "token",
                    "data": "I couldn't find information related to your question in the uploaded documents. Please try rephrasing your question or upload relevant documents.",
                }
                yield {"type": "done", "data": {"confidence": 0.0, "citations": [], "suggested_questions": []}}
                return

            yield {"type": "status", "data": "Ranking results…"}
            reranked = self.reranker.rerank(
                query=query, chunks=search_results,
                top_k=settings.top_k_rerank,
            )

            # ── 3. Hallucination Check ───────────────────────────────
            if not self.llm.check_hallucination(reranked):
                yield {
                    "type": "token",
                    "data": "I couldn't find information related to your question in the uploaded documents. Please try rephrasing your question or upload relevant documents.",
                }
                yield {"type": "done", "data": {"confidence": 0.0, "citations": [], "suggested_questions": []}}
                return

            # ── 4. Chat History ──────────────────────────────────────
            chat_history = await self._get_chat_history(db, chat_id) if chat_id else None

            # ── 5. Stream Tokens ─────────────────────────────────────
            yield {"type": "status", "data": "Generating answer…"}
            full_answer = ""
            async for token in self.llm.generate_stream(
                query=query, chunks=reranked, chat_history=chat_history
            ):
                full_answer += token
                yield {"type": "token", "data": token}

            # ── 6. Post-stream metadata ──────────────────────────────
            citations = self._build_citations(reranked)
            confidence = self._calculate_confidence(reranked)
            suggested = self.llm.extract_suggested_questions(full_answer)
            latency_ms = int((time.time() - start) * 1000)

            yield {
                "type": "done",
                "data": {
                    "citations": citations,
                    "confidence": confidence,
                    "suggested_questions": suggested,
                    "latency_ms": latency_ms,
                    "model": settings.gemini_model,
                    "diagnostics": self._build_diagnostics(reranked) if settings.debug else None,
                },
            }

        except Exception as e:
            import traceback
            tb = traceback.format_exc()
            logger.error("rag_stream_error", error=str(e), traceback=tb)
            yield {"type": "error", "data": str(e)}

    # ── Agentic Routing ──────────────────────────────────────────
    def _route_query(self, query: str) -> str:
        """Simple agent routing based on query intent."""
        query_lower = query.lower().strip()

        if any(kw in query_lower for kw in ["compare", "difference between", "diff", "versus", "vs"]):
            return "document_comparison"
        elif any(kw in query_lower for kw in ["find document", "locate file", "filter by collection"]):
            return "metadata_search"
        elif query_lower in ["hi", "hello", "hey", "thanks", "thank you", "who are you?", "who are you"]:
            return "conversational"
        else:
            return "document_retrieval"

    # ── Helpers ──────────────────────────────────────────────────
    def _build_citations(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Build citation objects from reranked chunks."""
        def _to_int_or_none(v: Any) -> Optional[int]:
            if v is None or v == "":
                return None
            try:
                return int(v)
            except (ValueError, TypeError):
                return None

        citations = []
        for chunk in chunks:
            meta = chunk.get("metadata", {})
            citations.append({
                "chunk_id": chunk["chunk_id"],
                "document_id": meta.get("document_id", ""),
                "filename": meta.get("filename", "Unknown"),
                "page_number": _to_int_or_none(meta.get("page_number")),
                "paragraph_number": _to_int_or_none(meta.get("paragraph_number")),
                "relevance_score": round(chunk.get("rerank_score", chunk.get("fused_score", 0)), 4),
                "snippet": chunk["content"][:300],
            })
        return citations

    def _calculate_confidence(self, chunks: List[Dict[str, Any]]) -> float:
        """Calculate overall confidence score calibrated to human-readable scale [0.0 - 0.99]."""
        if not chunks:
            return 0.0

        best_score = chunks[0].get("rerank_score", chunks[0].get("fused_score", 0.0))
        if best_score <= 0.0:
            return 0.0

        # Calibrated mapping for cross-encoder reranker
        if best_score > 0.5:
            conf = 0.90 + min(best_score - 0.5, 0.5) * 0.18
        elif best_score > 0.1:
            conf = 0.80 + (best_score - 0.1) * 0.25
        elif best_score > 0.01:
            conf = 0.65 + (best_score - 0.01) * 1.5
        else:
            conf = max(best_score * 50, 0.1)

        return round(min(conf, 0.99), 2)

    def _build_diagnostics(self, chunks: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
        """Build diagnostic breakdown for developer inspection."""
        diag = []
        for c in chunks[:5]:
            meta = c.get("metadata", {})
            diag.append({
                "chunk_id": c.get("chunk_id"),
                "filename": meta.get("filename"),
                "page_number": meta.get("page_number"),
                "dense_rank": c.get("dense_rank"),
                "dense_score": round(c["dense_score"], 4) if c.get("dense_score") is not None else None,
                "bm25_rank": c.get("bm25_rank"),
                "bm25_score": round(c["bm25_score"], 4) if c.get("bm25_score") is not None else None,
                "fused_score": round(c["fused_score"], 5) if c.get("fused_score") is not None else None,
                "rerank_score": round(c["rerank_score"], 5) if c.get("rerank_score") is not None else None,
                "preview": c.get("content", "")[:120].replace("\n", " "),
            })
        return diag

    def _low_confidence_response(self, chat_id: Optional[str], db: AsyncSession) -> Dict[str, Any]:
        """Return a safe response when confidence is genuinely too low."""
        return {
            "answer": "I couldn't find information related to your question in the uploaded documents. Please try rephrasing your question or upload relevant documents.",
            "citations": [],
            "confidence": 0.0,
            "suggested_questions": [
                "What documents have been uploaded?",
                "Can you summarize the main topics in the document?",
            ],
            "tokens_used": 0,
            "latency_ms": 0,
            "model": settings.gemini_model,
            "tool_used": "none",
        }

    async def _get_chat_history(
        self, db: AsyncSession, chat_id: str, limit: int = 10
    ) -> List[Dict[str, str]]:
        """Retrieve recent chat history for context."""
        stmt = (
            select(ChatMessage)
            .where(ChatMessage.chat_id == chat_id)
            .order_by(ChatMessage.created_at.desc())
            .limit(limit)
        )
        result = await db.execute(stmt)
        messages = result.scalars().all()

        return [
            {"role": msg.role, "content": msg.content}
            for msg in reversed(messages)
        ]
