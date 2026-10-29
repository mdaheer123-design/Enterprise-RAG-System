"""
Comprehensive tests for PDF upload, extraction, indexing, retries, and search.
Covers all 12 core requirements for the document processing pipeline.
"""

import os
import uuid
import pytest
import pytest_asyncio
from unittest.mock import patch, MagicMock
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.database import async_session_factory, close_db
from app.models.models import Document, DocumentChunk
from app.services.document_processor import DocumentProcessor
from app.services.chunking import ChunkingService
from app.services.vector_store import VectorStore
from app.api.documents import _index_document
from sqlalchemy import select, delete

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def client():
    """Create async test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_db()


def create_minimal_pdf_bytes(text: str = "Enterprise AI Assistant PDF content") -> bytes:
    """Generate a valid minimal single-page PDF with text."""
    # A standard valid minimal PDF 1.4 stream containing text
    stream_content = f"BT /F1 12 Tf 72 712 Td ({text}) Tj ET"
    stream_len = len(stream_content)
    pdf = f"""%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources <</Font <</F1 5 0 R>>>>>> endobj
4 0 obj <</Length {stream_len}>> stream
{stream_content}
endstream endobj
5 0 obj <</Type /Font /Subtype /Type1 /BaseFont /Helvetica>> endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000244 00000 n 
0000000300 00000 n 
trailer <</Size 6 /Root 1 0 R>>
startxref
370
%%EOF"""
    return pdf.encode("utf-8")


def create_blank_pdf_bytes() -> bytes:
    """Generate a valid PDF with zero text (simulating scanned/empty PDF)."""
    stream_content = "q 10 10 100 100 re f Q"  # rectangle draw, no text
    stream_len = len(stream_content)
    pdf = f"""%PDF-1.4
1 0 obj <</Type /Catalog /Pages 2 0 R>> endobj
2 0 obj <</Type /Pages /Kids [3 0 R] /Count 1>> endobj
3 0 obj <</Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R>> endobj
4 0 obj <</Length {stream_len}>> stream
{stream_content}
endstream endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000214 00000 n 
trailer <</Size 5 /Root 1 0 R>>
startxref
300
%%EOF"""
    return pdf.encode("utf-8")


# ── Test 1: Valid text-based PDF extraction ─────────────────────
async def test_1_valid_text_pdf_extraction(tmp_path):
    processor = DocumentProcessor()
    pdf_path = tmp_path / "valid_doc.pdf"
    pdf_path.write_bytes(create_minimal_pdf_bytes("Knowledge Retrieval and Indexing Test"))

    result = await processor.extract_text(str(pdf_path), "pdf")
    assert "pages" in result
    assert len(result["pages"]) == 1
    assert "Knowledge" in result["pages"][0]["content"]
    assert result["metadata"]["page_count"] == 1
    assert result["metadata"]["word_count"] > 0


# ── Test 2: Filename with parentheses and spaces ────────────────
async def test_2_pdf_filename_with_parentheses(client, tmp_path):
    pdf_content = create_minimal_pdf_bytes("Parentheses in Filename Test")
    filename = "report (final) (v2.1).pdf"

    files = {"files": (filename, pdf_content, "application/pdf")}
    response = await client.post("/api/documents/upload", files=files)
    assert response.status_code == 200
    docs = response.json()
    assert len(docs) == 1
    doc = docs[0]
    assert doc["original_filename"] == filename
    assert doc["status"] in ["processing", "indexed"]

    # Verify file saved on disk preserves content
    async with async_session_factory() as session:
        db_doc = await session.get(Document, doc["id"])
        assert db_doc is not None
        assert os.path.exists(db_doc.file_path)
        # Clean up
        if os.path.exists(db_doc.file_path):
            os.remove(db_doc.file_path)
        await session.delete(db_doc)
        await session.commit()


# ── Test 3: Multiple pages PDF extraction ───────────────────────
async def test_3_multiple_pages_pdf():
    # We verify multi-page extraction on the uploaded rag(pdf).pdf (26 pages)
    pdf_path = "data/uploads/639f9453784e4ebe80ee6d02fedb3fd7_rag(pdf).pdf"
    if os.path.exists(pdf_path):
        processor = DocumentProcessor()
        result = await processor.extract_text(pdf_path, "pdf")
        assert len(result["pages"]) == 26
        assert result["metadata"]["page_count"] == 26
        assert result["metadata"]["word_count"] > 5000
        # Check consecutive page numbers
        for idx, page in enumerate(result["pages"]):
            assert page["page_number"] == idx + 1


# ── Test 4: PDF with no extractable text (OCR detection) ────────
async def test_4_pdf_no_extractable_text_requires_ocr(tmp_path):
    processor = DocumentProcessor()
    blank_pdf = tmp_path / "blank_scanned.pdf"
    blank_pdf.write_bytes(create_blank_pdf_bytes())

    with pytest.raises(ValueError) as excinfo:
        await processor.extract_text(str(blank_pdf), "pdf")
    assert "no extractable text" in str(excinfo.value)
    assert "OCR" in str(excinfo.value)


# ── Test 5: Invalid or corrupted PDF ────────────────────────────
async def test_5_invalid_or_corrupted_pdf(tmp_path):
    processor = DocumentProcessor()
    corrupt_pdf = tmp_path / "corrupted.pdf"
    corrupt_pdf.write_bytes(b"This is not a real PDF file header")

    with pytest.raises(ValueError) as excinfo:
        await processor.extract_text(str(corrupt_pdf), "pdf")
    assert "%PDF" in str(excinfo.value) or "corrupted" in str(excinfo.value).lower()


# ── Test 6: Missing file error handling ─────────────────────────
async def test_6_missing_file_handling():
    processor = DocumentProcessor()
    with pytest.raises(FileNotFoundError):
        await processor.extract_text("data/uploads/non_existent_file_xyz.pdf", "pdf")


# ── Test 7: Embedding provider failure handling ─────────────────
async def test_7_embedding_failure_handling(tmp_path):
    doc_id = str(uuid.uuid4())
    pdf_file = tmp_path / "test_embed_fail.pdf"
    pdf_file.write_bytes(create_minimal_pdf_bytes("Embedding Failure Content"))

    async with async_session_factory() as session:
        doc = Document(
            id=doc_id,
            filename=f"{doc_id}_test.pdf",
            original_filename="test_embed_fail.pdf",
            file_type="pdf",
            file_size=len(pdf_file.read_bytes()),
            file_path=str(pdf_file),
            status="processing",
        )
        session.add(doc)
        await session.commit()

    # Mock embedding failure
    with patch("app.api.documents.embedding_service.embed_texts", side_effect=RuntimeError("Embedding service connection timed out")):
        await _index_document(doc_id)

    # Verify document marked as failed with useful error
    async with async_session_factory() as session:
        updated = await session.get(Document, doc_id)
        assert updated.status == "failed"
        assert "Embedding service connection timed out" in updated.error_message
        await session.delete(updated)
        await session.commit()


# ── Test 8: Vector database insertion failure handling ──────────
async def test_8_vector_db_insertion_failure(tmp_path):
    doc_id = str(uuid.uuid4())
    pdf_file = tmp_path / "test_vector_fail.pdf"
    pdf_file.write_bytes(create_minimal_pdf_bytes("Vector Failure Content"))

    async with async_session_factory() as session:
        doc = Document(
            id=doc_id,
            filename=f"{doc_id}_test.pdf",
            original_filename="test_vector_fail.pdf",
            file_type="pdf",
            file_size=len(pdf_file.read_bytes()),
            file_path=str(pdf_file),
            status="processing",
        )
        session.add(doc)
        await session.commit()

    # Mock vector store insertion failure
    with patch("app.api.documents.vector_store.add_documents", side_effect=Exception("ChromaDB vector insertion failed: disk full")):
        await _index_document(doc_id)

    async with async_session_factory() as session:
        updated = await session.get(Document, doc_id)
        assert updated.status == "failed"
        assert "ChromaDB vector insertion failed" in updated.error_message
        await session.delete(updated)
        await session.commit()


# ── Test 9: Retry endpoint execution ────────────────────────────
async def test_9_retry_endpoint_success(client, tmp_path):
    doc_id = str(uuid.uuid4())
    pdf_file = tmp_path / "retry_test.pdf"
    pdf_file.write_bytes(create_minimal_pdf_bytes("Retry Test Document"))

    async with async_session_factory() as session:
        doc = Document(
            id=doc_id,
            filename=f"{doc_id}_retry.pdf",
            original_filename="retry_test.pdf",
            file_type="pdf",
            file_size=len(pdf_file.read_bytes()),
            file_path=str(pdf_file),
            status="failed",
            error_message="Previous failure occurred",
        )
        session.add(doc)
        await session.commit()

    # Call real backend retry endpoint
    response = await client.post(f"/api/documents/{doc_id}/retry")
    assert response.status_code == 200
    data = response.json()
    assert data["id"] == doc_id
    assert data["status"] == "processing"
    assert data["error_message"] is None

    # Clean up
    async with async_session_factory() as session:
        d = await session.get(Document, doc_id)
        if d:
            await session.delete(d)
            await session.commit()


# ── Test 10: Retry endpoint with missing source file ────────────
async def test_10_retry_endpoint_missing_file(client):
    doc_id = str(uuid.uuid4())

    async with async_session_factory() as session:
        doc = Document(
            id=doc_id,
            filename=f"{doc_id}_missing.pdf",
            original_filename="missing.pdf",
            file_type="pdf",
            file_size=1234,
            file_path="data/uploads/deleted_file_never_existed.pdf",
            status="failed",
            error_message="File lost",
        )
        session.add(doc)
        await session.commit()

    response = await client.post(f"/api/documents/{doc_id}/retry")
    assert response.status_code == 400
    assert "missing" in response.json()["detail"].lower() or "re-upload" in response.json()["detail"].lower()

    # Clean up
    async with async_session_factory() as session:
        d = await session.get(Document, doc_id)
        if d:
            await session.delete(d)
            await session.commit()


# ── Test 11: Duplicate retry prevention ─────────────────────────
async def test_11_duplicate_retry_prevention(client, tmp_path):
    doc_id = str(uuid.uuid4())
    pdf_file = tmp_path / "dup_retry.pdf"
    pdf_file.write_bytes(create_minimal_pdf_bytes("Duplicate Prevention Content"))

    async with async_session_factory() as session:
        doc = Document(
            id=doc_id,
            filename=f"{doc_id}_dup.pdf",
            original_filename="dup_retry.pdf",
            file_type="pdf",
            file_size=100,
            file_path=str(pdf_file),
            status="processing",  # already processing!
        )
        session.add(doc)
        await session.commit()

    # Calling retry while already processing must return 409 Conflict
    response = await client.post(f"/api/documents/{doc_id}/retry")
    assert response.status_code == 409
    assert "currently being processed" in response.json()["detail"]

    # Clean up
    async with async_session_factory() as session:
        d = await session.get(Document, doc_id)
        if d:
            await session.delete(d)
            await session.commit()


# ── Test 12: Successful indexing followed by real search query ──
async def test_12_search_indexed_pdf(client):
    # Search for ISO 27001 text from the indexed rag(pdf).pdf document
    response = await client.post("/api/search/", json={
        "query": "information security risk assessment",
        "top_k": 3,
    })
    assert response.status_code == 200
    data = response.json()
    assert "results" in data
    assert len(data["results"]) > 0
    first_hit = data["results"][0]
    assert "content" in first_hit
    assert "relevance_score" in first_hit
    assert first_hit["page_number"] is not None
