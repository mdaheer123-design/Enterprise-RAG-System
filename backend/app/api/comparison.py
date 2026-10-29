"""
Comparison API Routes
Handles document comparison operations.
"""

import os
from typing import Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, or_, and_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.models.models import Document, Comparison
from app.schemas.schemas import (
    ComparisonRequest, ComparisonResponse, ComparisonDifference, DocumentResponse
)
from app.services.document_processor import DocumentProcessor
from app.services.comparison_service import ComparisonService

logger = get_logger(__name__)
router = APIRouter(prefix="/compare", tags=["Comparison"])

processor = DocumentProcessor()
comparison_service = ComparisonService()


def _build_comparison_response(comp: Comparison, doc_a: Document, doc_b: Document) -> ComparisonResponse:
    """Build verified ComparisonResponse from DB model and documents."""
    result_data = comp.result if isinstance(comp.result, dict) else {}
    raw_diffs = result_data.get("differences", [])

    differences = [
        ComparisonDifference(
            type=d.get("type", "modified"),
            category=d.get("category", "text"),
            location_a=d.get("location_a"),
            location_b=d.get("location_b"),
            content_a=d.get("content_a"),
            content_b=d.get("content_b"),
            description=d.get("description", ""),
        )
        for d in raw_diffs
    ]

    added_cnt = result_data.get("added_count", sum(1 for d in differences if d.type == "added"))
    removed_cnt = result_data.get("removed_count", sum(1 for d in differences if d.type == "removed"))
    modified_cnt = result_data.get("modified_count", sum(1 for d in differences if d.type == "modified"))

    comp_mode = result_data.get("comparison_mode", "semantic")
    comp_status = result_data.get("comparison_status", comp.status or "completed")

    return ComparisonResponse(
        id=comp.id,
        comparison_id=comp.id,
        document_a_id=doc_a.id,
        document_a_filename=doc_a.original_filename,
        document_b_id=doc_b.id,
        document_b_filename=doc_b.original_filename,
        document_a=DocumentResponse.model_validate(doc_a),
        document_b=DocumentResponse.model_validate(doc_b),
        comparison_mode=comp_mode,
        comparison_status=comp_status,
        summary=comp.summary or result_data.get("summary", ""),
        status=comp.status or comp_status,
        added_count=added_cnt,
        removed_count=removed_cnt,
        modified_count=modified_cnt,
        detailed_changes=differences,
        differences=differences,
        created_at=comp.created_at,
    )


@router.post("/", response_model=ComparisonResponse)
async def compare_documents(
    data: ComparisonRequest,
    db: AsyncSession = Depends(get_db),
):
    """Compare two documents and generate a difference report."""
    if data.document_a_id == data.document_b_id:
        raise HTTPException(status_code=400, detail="Cannot compare a document with itself")

    # Fetch documents
    result_a = await db.execute(select(Document).where(Document.id == data.document_a_id))
    doc_a = result_a.scalar_one_or_none()
    if not doc_a:
        raise HTTPException(status_code=404, detail=f"Document A ({data.document_a_id}) not found")

    result_b = await db.execute(select(Document).where(Document.id == data.document_b_id))
    doc_b = result_b.scalar_one_or_none()
    if not doc_b:
        raise HTTPException(status_code=404, detail=f"Document B ({data.document_b_id}) not found")

    # Verify both document files exist and are accessible on disk
    if not os.path.exists(doc_a.file_path):
        raise HTTPException(status_code=404, detail=f"File for Document A not found on disk: {doc_a.original_filename}")
    if not os.path.exists(doc_b.file_path):
        raise HTTPException(status_code=404, detail=f"File for Document B not found on disk: {doc_b.original_filename}")

    # Extract text & metadata from both documents
    text_a = await processor.extract_text(doc_a.file_path, doc_a.file_type)
    text_b = await processor.extract_text(doc_b.file_path, doc_b.file_type)

    full_text_a = "\n".join([p["content"] for p in text_a.get("pages", [])])
    full_text_b = "\n".join([p["content"] for p in text_b.get("pages", [])])

    meta_a = text_a.get("metadata", {})
    meta_b = text_b.get("metadata", {})

    # Execute verified comparison via ComparisonService
    comp_res = await comparison_service.compare_documents(
        doc_a_name=doc_a.original_filename,
        doc_a_type=doc_a.file_type,
        meta_a=meta_a,
        doc_a_text=full_text_a,
        doc_b_name=doc_b.original_filename,
        doc_b_type=doc_b.file_type,
        meta_b=meta_b,
        doc_b_text=full_text_b,
    )

    summary_text = comp_res.get("summary", "")
    comp_status = comp_res.get("comparison_status", "completed")

    # Save comparison record
    comparison = Comparison(
        document_a_id=doc_a.id,
        document_b_id=doc_b.id,
        result=comp_res,
        summary=summary_text,
        status=comp_status,
    )
    db.add(comparison)
    await db.commit()
    await db.refresh(comparison)

    return _build_comparison_response(comparison, doc_a, doc_b)


@router.get("/", response_model=list[ComparisonResponse])
async def list_comparisons(
    document_a_id: Optional[str] = Query(None, description="Filter by Document A ID"),
    document_b_id: Optional[str] = Query(None, description="Filter by Document B ID"),
    db: AsyncSession = Depends(get_db),
):
    """List document comparisons, optionally filtered by exact document pair."""
    stmt = select(Comparison).order_by(Comparison.created_at.desc())

    if document_a_id and document_b_id:
        # Match ordered or normalized document pair
        stmt = stmt.where(
            or_(
                and_(Comparison.document_a_id == document_a_id, Comparison.document_b_id == document_b_id),
                and_(Comparison.document_a_id == document_b_id, Comparison.document_b_id == document_a_id),
            )
        )
    elif document_a_id:
        stmt = stmt.where(or_(Comparison.document_a_id == document_a_id, Comparison.document_b_id == document_a_id))
    elif document_b_id:
        stmt = stmt.where(or_(Comparison.document_a_id == document_b_id, Comparison.document_b_id == document_b_id))

    stmt = stmt.limit(20)
    result = await db.execute(stmt)
    comparisons = result.scalars().all()

    responses = []
    for comp in comparisons:
        doc_a_result = await db.execute(select(Document).where(Document.id == comp.document_a_id))
        doc_b_result = await db.execute(select(Document).where(Document.id == comp.document_b_id))
        doc_a = doc_a_result.scalar_one_or_none()
        doc_b = doc_b_result.scalar_one_or_none()

        if doc_a and doc_b:
            responses.append(_build_comparison_response(comp, doc_a, doc_b))

    return responses


@router.get("/{comparison_id}", response_model=ComparisonResponse)
async def get_comparison(
    comparison_id: str,
    db: AsyncSession = Depends(get_db),
):
    """Get a single comparison by its ID."""
    result = await db.execute(select(Comparison).where(Comparison.id == comparison_id))
    comp = result.scalar_one_or_none()
    if not comp:
        raise HTTPException(status_code=404, detail=f"Comparison {comparison_id} not found")

    doc_a_result = await db.execute(select(Document).where(Document.id == comp.document_a_id))
    doc_b_result = await db.execute(select(Document).where(Document.id == comp.document_b_id))
    doc_a = doc_a_result.scalar_one_or_none()
    doc_b = doc_b_result.scalar_one_or_none()

    if not doc_a or not doc_b:
        raise HTTPException(status_code=404, detail="Associated documents for comparison not found")

    return _build_comparison_response(comp, doc_a, doc_b)
