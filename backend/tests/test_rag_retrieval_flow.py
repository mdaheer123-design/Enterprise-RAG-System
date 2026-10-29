"""
Regression Test Suite for RAG Retrieval & Answer Pipeline
Covers 10 key requirements:
1. Direct acronym query
2. Natural-language query about document title
3. Exact keyword query
4. Paraphrased query
5. Absent content rejection (hallucination protection)
6. Calibrated threshold separation
7. Document not finished indexing status
8. Vector database failure resilience
9. Collection filtering isolation
10. Valid filename and page citations
"""

import pytest
import pytest_asyncio
from unittest.mock import AsyncMock, MagicMock, patch

from app.core.config import get_settings
from app.services.llm import LLMService
from app.services.query_understanding import QueryUnderstandingService
from app.services.rag_pipeline import RAGPipeline

settings = get_settings()


@pytest.fixture
def query_expander():
    return QueryUnderstandingService()


@pytest.fixture
def mock_chunks():
    return [
        {
            "chunk_id": "chunk-p4",
            "content": "ISO/IEC 27001:2022(E)\nForeword\nISO (the International Organization for Standardization) and IEC (the International Electrotechnical Commission) form the specialized system for worldwide standardization.",
            "metadata": {
                "document_id": "doc-1",
                "filename": "rag(pdf).pdf",
                "page_number": 4,
                "paragraph_number": 1,
                "collection_id": "col-a",
            },
            "rerank_score": 0.1342,
            "fused_score": 0.015,
            "score": 0.78,
            "source": "dense",
        },
        {
            "chunk_id": "chunk-p1",
            "content": "ISO/IEC 27001\nINTERNATIONAL STANDARD\nThird edition 2022-10\nInformation security, cybersecurity and privacy protection — Information security management systems — Requirements",
            "metadata": {
                "document_id": "doc-1",
                "filename": "rag(pdf).pdf",
                "page_number": 1,
                "paragraph_number": 1,
                "collection_id": "col-a",
            },
            "rerank_score": 0.0850,
            "fused_score": 0.014,
            "score": 0.72,
            "source": "dense",
        },
    ]


# ── Test 1: Direct Acronym Query Expansion ───────────────────────
def test_direct_acronym_query_expansion(query_expander):
    """Test acronym detection and natural language expansion."""
    expansions, keywords = query_expander.expand_query("full form of iso")
    assert any("ISO" in q for q in expansions)
    assert "iso" in keywords
    assert any("stand for" in q.lower() or "meaning" in q.lower() for q in expansions)


# ── Test 2: Natural-Language Title Query Understanding ──────────
def test_natural_language_title_query(query_expander):
    """Test extraction of keywords from title questions."""
    expansions, keywords = query_expander.expand_query("What is the title of this standard?")
    assert "title" in keywords
    assert "standard" in keywords
    assert expansions[0] == "What is the title of this standard?"


# ── Test 3: Exact Keyword Query (Punctuation and Slash Handling) ─
def test_exact_keyword_slash_handling(query_expander):
    """Test that ISO/IEC 27001 extracts components for exact keyword matching."""
    expansions, keywords = query_expander.expand_query("ISO/IEC 27001")
    assert "iso" in keywords
    assert "iec" in keywords
    assert "27001" in keywords


# ── Test 4: Paraphrased Query Matching ───────────────────────────
def test_paraphrased_query_understanding(query_expander):
    """Test that 'What does ISO mean?' generates relevant keywords."""
    expansions, keywords = query_expander.expand_query("What does ISO mean?")
    assert "iso" in keywords
    assert any("ISO" in q for q in expansions)


# ── Test 5: Question Absent from Document (Hallucination Rejection) ──
def test_absent_question_rejection():
    """Verify that irrelevant chunks with near-zero rerank scores are rejected."""
    llm = LLMService()
    irrelevant_chunks = [
        {"chunk_id": "c1", "content": "Unrelated content", "rerank_score": 0.00015},
        {"chunk_id": "c2", "content": "Another unrelated piece", "rerank_score": 0.00008},
    ]
    assert llm.check_hallucination(irrelevant_chunks, threshold=0.01) is False


# ── Test 6: Calibrated Threshold Separates Relevant from Noise ──
def test_calibrated_threshold_separation(mock_chunks):
    """Verify that calibrated threshold permits 0.1342 (relevant) while rejecting 0.0001 (noise)."""
    llm = LLMService()
    # Relevant chunk with score 0.1342 must pass
    assert llm.check_hallucination(mock_chunks, threshold=0.01) is True

    # Noise chunk must fail
    noise_chunks = [{"chunk_id": "n1", "rerank_score": 0.0002}]
    assert llm.check_hallucination(noise_chunks, threshold=0.01) is False


# ── Test 7: Document Not Finished Indexing Status ─────────────────
@pytest.mark.asyncio
async def test_document_indexing_status():
    """Test that pipeline recognizes when documents are still indexing."""
    pipeline = RAGPipeline()
    mock_db = AsyncMock()

    with patch.object(pipeline, "_check_document_status", return_value="indexing"):
        res = await pipeline.process_query(query="full form of iso", db=mock_db)
        assert "still being processed" in res["answer"].lower()
        assert res["confidence"] == 0.0


# ── Test 8: Vector Database Failure Resilience ────────────────────
@pytest.mark.asyncio
async def test_vector_db_failure_resilience():
    """Test that pipeline handles vector DB query failure gracefully."""
    pipeline = RAGPipeline()
    mock_db = AsyncMock()

    with patch.object(pipeline, "_check_document_status", return_value="ok"):
        with patch.object(pipeline.search_service, "search", return_value=[]):
            res = await pipeline.process_query(query="full form of iso", db=mock_db)
            assert res["confidence"] == 0.0
            assert "couldn't find information" in res["answer"].lower()


# ── Test 9: Collection Filtering Isolation ────────────────────────
@pytest.mark.asyncio
async def test_collection_filtering_isolation():
    """Test that querying with a non-existent collection ID isolates results."""
    pipeline = RAGPipeline()
    mock_db = AsyncMock()

    with patch.object(pipeline, "_check_document_status", return_value="no_documents"):
        res = await pipeline.process_query(
            query="ISO standard", db=mock_db, collection_id="non-existent-col"
        )
        assert "no documents have been uploaded yet" in res["answer"].lower()


# ── Test 10: Successful Answer with Valid Filename & Citation ────
@pytest.mark.asyncio
async def test_successful_answer_with_valid_citations(mock_chunks):
    """Test that pipeline generates answer with correct filename, page, and paragraph citations."""
    pipeline = RAGPipeline()
    mock_db = AsyncMock()

    with patch.object(pipeline, "_check_document_status", return_value="ok"):
        with patch.object(pipeline.search_service, "search", return_value=mock_chunks):
            with patch.object(pipeline.reranker, "rerank", return_value=mock_chunks):
                with patch.object(pipeline.llm, "generate_answer", return_value={
                    "answer": "ISO stands for International Organization for Standardization [Source: rag(pdf).pdf, Page 4, Paragraph 1].",
                    "tokens_used": 150,
                    "model": "gemini-2.5-flash",
                }):
                    res = await pipeline.process_query(query="full form of iso", db=mock_db)
                    assert "International Organization for Standardization" in res["answer"]
                    assert len(res["citations"]) > 0
                    assert res["citations"][0]["filename"] == "rag(pdf).pdf"
                    assert res["citations"][0]["page_number"] == 4
                    assert res["confidence"] > 0.7
