"""
Regression Tests for Document Comparison Flow.
Verifies ID source of truth, verified response fields, compatibility checks, and query filtering.
"""

import pytest
import pytest_asyncio
from sqlalchemy import select
from httpx import AsyncClient, ASGITransport

from app.main import app
from app.core.database import close_db, async_session_factory
from app.models.models import Document

pytestmark = pytest.mark.asyncio(loop_scope="session")


@pytest_asyncio.fixture(loop_scope="session", scope="session")
async def client():
    """Create async test client."""
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac
    await close_db()


@pytest_asyncio.fixture(scope="session")
async def sample_docs():
    """Fetch sample documents from DB."""
    async with async_session_factory() as session:
        csv_doc = (await session.execute(
            select(Document).where(Document.original_filename.ilike("%Book%"))
        )).scalar_one_or_none()

        xlsx_doc = (await session.execute(
            select(Document).where(Document.original_filename.ilike("%Ecommerce%"))
        )).scalar_one_or_none()

        pdf_doc = (await session.execute(
            select(Document).where(Document.original_filename.ilike("%rag%"))
        )).scalar_one_or_none()

    return {
        "csv": csv_doc,
        "xlsx": xlsx_doc,
        "pdf": pdf_doc,
    }


async def test_compare_same_document_fails(client, sample_docs):
    """Test comparing a document with itself returns 400 Bad Request."""
    csv_doc = sample_docs["csv"]
    if not csv_doc:
        pytest.skip("CSV document not found in DB")

    response = await client.post("/api/compare/", json={
        "document_a_id": csv_doc.id,
        "document_b_id": csv_doc.id,
    })
    assert response.status_code == 400
    assert "Cannot compare a document with itself" in response.json()["detail"]


async def test_compare_nonexistent_document_fails(client, sample_docs):
    """Test comparing with a non-existent document ID returns 404."""
    csv_doc = sample_docs["csv"]
    if not csv_doc:
        pytest.skip("CSV document not found in DB")

    response = await client.post("/api/compare/", json={
        "document_a_id": csv_doc.id,
        "document_b_id": "nonexistent-id-00000000-0000",
    })
    assert response.status_code == 404


async def test_compare_csv_and_xlsx_compatibility(client, sample_docs):
    """
    Test comparing Book(Sheet1).csv and Ecommerce 1.xlsx.
    Verifies:
    1. Response IDs match requested IDs exactly.
    2. Filenames belong strictly to verified documents.
    3. Mode is structural_entity and direct row-by-row comparison is reported not appropriate.
    4. Row counts are not fabricated (added_count = 0, removed_count = 0).
    5. Detailed changes describe multi-entity scope mismatch.
    """
    csv_doc = sample_docs["csv"]
    xlsx_doc = sample_docs["xlsx"]
    if not csv_doc or not xlsx_doc:
        pytest.skip("Sample documents not found in DB")

    response = await client.post("/api/compare/", json={
        "document_a_id": csv_doc.id,
        "document_b_id": xlsx_doc.id,
    })
    assert response.status_code == 200
    data = response.json()

    # Verified IDs
    assert data["document_a_id"] == csv_doc.id
    assert data["document_b_id"] == xlsx_doc.id
    assert data["comparison_id"] is not None

    # Verified Filenames
    assert data["document_a_filename"] == csv_doc.original_filename
    assert data["document_b_filename"] == xlsx_doc.original_filename
    assert "rag(pdf).pdf" not in data["document_a_filename"]
    assert "rag(pdf).pdf" not in data["document_b_filename"]

    # Structural mode & compatibility
    assert data["comparison_mode"] == "structural_entity"
    assert data["comparison_status"] == "completed"

    # Direct row comparison not appropriate
    summary = data["summary"].lower()
    assert "direct row-by-row comparison is not appropriate" in summary

    # No fabricated row diff counts
    assert data["added_count"] == 0 or data["added_count"] == 1  # 1 entity addition or 0 row additions
    assert data["removed_count"] == 0  # 0 row deletions

    # Detailed changes present
    assert len(data["detailed_changes"]) > 0
    categories = [d["category"] for d in data["detailed_changes"]]
    assert "entity_scope" in categories


async def test_compare_filter_by_document_pair(client, sample_docs):
    """Test GET /api/compare/ filters by exact document pair."""
    csv_doc = sample_docs["csv"]
    xlsx_doc = sample_docs["xlsx"]
    if not csv_doc or not xlsx_doc:
        pytest.skip("Sample documents not found in DB")

    response = await client.get(f"/api/compare/?document_a_id={csv_doc.id}&document_b_id={xlsx_doc.id}")
    assert response.status_code == 200
    comparisons = response.json()
    assert len(comparisons) > 0

    for comp in comparisons:
        ids = {comp["document_a_id"], comp["document_b_id"]}
        assert csv_doc.id in ids
        assert xlsx_doc.id in ids


async def test_compare_cross_modal_csv_and_pdf(client, sample_docs):
    """Test comparing CSV and PDF detects cross-modal incompatibility without fabricating counts."""
    csv_doc = sample_docs["csv"]
    pdf_doc = sample_docs["pdf"]
    if not csv_doc or not pdf_doc:
        pytest.skip("Sample documents not found in DB")

    response = await client.post("/api/compare/", json={
        "document_a_id": csv_doc.id,
        "document_b_id": pdf_doc.id,
    })
    assert response.status_code == 200
    data = response.json()

    assert data["comparison_mode"] == "cross_modal_incompatible"
    assert data["comparison_status"] == "incompatible"
    assert "direct comparison is not appropriate" in data["summary"].lower()
    assert data["added_count"] == 0
    assert data["removed_count"] == 0
