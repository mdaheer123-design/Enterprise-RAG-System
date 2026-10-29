"""
Document API Routes
Handles document upload, listing, deletion, and indexing.
"""

import os
from pathlib import Path
from typing import List, Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile, BackgroundTasks
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import get_db
from app.core.logging import get_logger
from app.models.models import Document, DocumentChunk, Collection, AnalyticsEvent, Citation, Comparison
from app.schemas.schemas import DocumentResponse, DocumentListResponse
from app.services.document_processor import DocumentProcessor
from app.services.chunking import ChunkingService
from app.services.embedding import EmbeddingService
from app.services.vector_store import VectorStore

logger = get_logger(__name__)
settings = get_settings()
router = APIRouter(prefix="/documents", tags=["Documents"])

processor = DocumentProcessor()
chunker = ChunkingService()
embedding_service = EmbeddingService()
vector_store = VectorStore()


async def _index_document(document_id: str) -> None:
    """Background task to process, chunk, embed, and index a document."""
    from app.core.database import async_session_factory

    async with async_session_factory() as db:
        try:
            # Fetch document
            result = await db.execute(select(Document).where(Document.id == document_id))
            doc = result.scalar_one_or_none()
            if not doc:
                logger.error("indexing_aborted_document_not_found", document_id=document_id)
                return

            # Check that file exists on disk
            if not doc.file_path or not os.path.exists(doc.file_path):
                raise FileNotFoundError(f"Source file not found at path: {doc.file_path}")

            logger.info("indexing_start", document_id=document_id, filename=doc.original_filename)

            # 1. Extract text and page metadata
            extraction = await processor.extract_text(doc.file_path, doc.file_type)
            pages = extraction.get("pages", [])
            metadata = extraction.get("metadata", {})

            # Update document metadata immediately
            doc.page_count = metadata.get("page_count") or len(pages)
            doc.word_count = metadata.get("word_count") or 0
            doc.author = metadata.get("author")
            doc.title = metadata.get("title")

            # 2. Chunk text
            chunks = chunker.chunk_document(
                pages=pages,
                document_id=document_id,
                filename=doc.original_filename,
                collection_id=doc.collection_id,
            )

            if not chunks:
                raise ValueError("No text content could be extracted or chunked from document.")

            # 3. Clean up any existing chunks or vectors (ensures idempotency on retries)
            await db.execute(delete(DocumentChunk).where(DocumentChunk.document_id == document_id))
            try:
                vector_store.delete_by_document(document_id)
            except Exception as ve:
                logger.warning("vector_clean_warning", document_id=document_id, error=str(ve))

            # 4. Generate embeddings (batch)
            texts = [c["content"] for c in chunks]
            embeddings = embedding_service.embed_texts(texts)

            # 5. Store chunks in database
            db_chunks = []
            for chunk in chunks:
                db_chunk = DocumentChunk(
                    id=chunk["id"],
                    document_id=document_id,
                    content=chunk["content"],
                    chunk_index=chunk["chunk_index"],
                    page_number=chunk["metadata"].get("page_number"),
                    paragraph_number=chunk["metadata"].get("paragraph_number"),
                    start_char=chunk["metadata"].get("start_char"),
                    end_char=chunk["metadata"].get("end_char"),
                    token_count=chunk["metadata"].get("token_count"),
                    metadata_json=chunk["metadata"],
                )
                db.add(db_chunk)
                db_chunks.append(db_chunk)

            # 6. Store in vector database
            vector_store.add_documents(
                ids=[c["id"] for c in chunks],
                embeddings=embeddings,
                documents=texts,
                metadatas=[c["metadata"] for c in chunks],
            )

            # 7. Update document status to indexed
            doc.status = "indexed"
            doc.error_message = None
            await db.commit()

            # 8. Update collection document count if applicable
            if doc.collection_id:
                count_result = await db.execute(
                    select(func.count()).where(Document.collection_id == doc.collection_id)
                )
                count = count_result.scalar() or 0
                collection_result = await db.execute(
                    select(Collection).where(Collection.id == doc.collection_id)
                )
                collection = collection_result.scalar_one_or_none()
                if collection:
                    collection.document_count = count
                    await db.commit()

            logger.info(
                "indexing_complete",
                document_id=document_id,
                chunks=len(chunks),
                page_count=doc.page_count,
            )

        except Exception as e:
            import traceback
            tb_str = traceback.format_exc()
            logger.error("indexing_error", document_id=document_id, error=str(e), traceback=tb_str)
            # Update status to failed with human-readable error message
            try:
                result = await db.execute(select(Document).where(Document.id == document_id))
                doc = result.scalar_one_or_none()
                if doc:
                    doc.status = "failed"
                    doc.error_message = f"{str(e)}\n{tb_str}"
                    await db.commit()
            except Exception as db_err:
                logger.error("failed_to_persist_failure_status", error=str(db_err))


@router.post("/upload", response_model=List[DocumentResponse])
async def upload_documents(
    files: List[UploadFile] = File(...),
    collection_id: Optional[str] = Form(None),
    background_tasks: BackgroundTasks = BackgroundTasks(),
    db: AsyncSession = Depends(get_db),
):
    """
    Upload one or more documents for processing and indexing.
    Supported formats: PDF, DOCX, TXT, CSV, XLSX
    """
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    uploaded = []

    for file in files:
        # Validate file type
        ext = Path(file.filename).suffix.lower().lstrip(".")
        if ext not in settings.allowed_extensions_list:
            raise HTTPException(
                status_code=400,
                detail=f"Unsupported file type: {ext}. Allowed: {settings.allowed_extensions}",
            )

        # Validate collection exists if provided
        if collection_id:
            result = await db.execute(select(Collection).where(Collection.id == collection_id))
            if not result.scalar_one_or_none():
                raise HTTPException(status_code=404, detail=f"Collection {collection_id} not found")

        # Save file
        try:
            saved_name, file_path = await processor.save_upload(file)
        except ValueError as e:
            raise HTTPException(status_code=400, detail=str(e))

        # Get file size
        file_size = os.path.getsize(file_path)

        # Create document record
        doc = Document(
            filename=saved_name,
            original_filename=file.filename,
            file_type=ext,
            file_size=file_size,
            file_path=file_path,
            collection_id=collection_id,
            status="processing",
        )
        db.add(doc)
        await db.flush()

        # Track analytics
        event = AnalyticsEvent(
            event_type="upload",
            event_data={"document_id": doc.id, "filename": file.filename, "file_type": ext},
        )
        db.add(event)

        uploaded.append(doc)

        # Queue background indexing
        background_tasks.add_task(_index_document, doc.id)

    await db.commit()

    logger.info("documents_uploaded", count=len(uploaded))
    return uploaded


@router.get("/", response_model=DocumentListResponse)
async def list_documents(
    page: int = 1,
    page_size: int = 20,
    collection_id: Optional[str] = None,
    file_type: Optional[str] = None,
    status: Optional[str] = None,
    search: Optional[str] = None,
    db: AsyncSession = Depends(get_db),
):
    """List documents with filtering and pagination."""
    stmt = select(Document)

    if collection_id:
        stmt = stmt.where(Document.collection_id == collection_id)
    if file_type:
        stmt = stmt.where(Document.file_type == file_type)
    if status:
        stmt = stmt.where(Document.status == status)
    if search:
        stmt = stmt.where(Document.original_filename.ilike(f"%{search}%"))

    # Count total
    count_stmt = select(func.count()).select_from(stmt.subquery())
    total = (await db.execute(count_stmt)).scalar()

    # Apply pagination
    stmt = stmt.order_by(Document.created_at.desc())
    stmt = stmt.offset((page - 1) * page_size).limit(page_size)

    result = await db.execute(stmt)
    documents = result.scalars().all()

    return DocumentListResponse(
        documents=documents,
        total=total,
        page=page,
        page_size=page_size,
    )


@router.get("/{document_id}", response_model=DocumentResponse)
async def get_document(document_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single document by ID."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    return doc


@router.delete("/{document_id}")
async def delete_document(document_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a document and all associated chunks/vectors."""
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    # Delete vectors
    try:
        vector_store.delete_by_document(document_id)
    except Exception as e:
        logger.warning("vector_delete_error", error=str(e))

    # Delete file
    try:
        if os.path.exists(doc.file_path):
            os.remove(doc.file_path)
    except Exception as e:
        logger.warning("file_delete_error", error=str(e))

    # Delete vectors from ChromaDB
    try:
        from app.services.vector_store import VectorStore
        VectorStore().delete_by_document(document_id)
    except Exception as ve:
        logger.warning("vector_delete_error", error=str(ve))

    # Delete from database with full cleanup of dependent records
    # 1. Citations referencing this document or its chunks
    chunk_ids_subq = select(DocumentChunk.id).where(DocumentChunk.document_id == document_id)
    await db.execute(
        delete(Citation).where(
            (Citation.document_id == document_id) | 
            (Citation.chunk_id.in_(chunk_ids_subq))
        )
    )

    # 2. Comparisons referencing this document
    await db.execute(
        delete(Comparison).where(
            (Comparison.document_a_id == document_id) | 
            (Comparison.document_b_id == document_id)
        )
    )

    # 3. Document chunks
    await db.execute(
        delete(DocumentChunk).where(DocumentChunk.document_id == document_id)
    )

    # 4. Document record
    col_id = doc.collection_id
    await db.delete(doc)
    await db.flush()

    if col_id:
        count_result = await db.execute(
            select(func.count()).where(Document.collection_id == col_id)
        )
        count = count_result.scalar() or 0
        col_res = await db.execute(select(Collection).where(Collection.id == col_id))
        collection = col_res.scalar_one_or_none()
        if collection:
            collection.document_count = count

    await db.commit()

    logger.info("document_deleted", document_id=document_id)
    return {"message": "Document deleted successfully", "id": document_id}


@router.post("/{document_id}/retry", response_model=DocumentResponse)
async def retry_document_indexing(
    document_id: str,
    background_tasks: BackgroundTasks,
    db: AsyncSession = Depends(get_db),
):
    """
    Retry processing and indexing for a failed or stuck document.
    """
    result = await db.execute(select(Document).where(Document.id == document_id))
    doc = result.scalar_one_or_none()
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")

    if doc.status == "processing":
        raise HTTPException(status_code=409, detail="Document is currently being processed")

    # Check whether the original file still exists
    if not doc.file_path or not os.path.exists(doc.file_path):
        doc.status = "failed"
        doc.error_message = "Original source file not found on disk. Please upload the document again."
        await db.commit()
        raise HTTPException(
            status_code=400,
            detail="Original source file is missing from the server. Please re-upload the document.",
        )

    # Reset status and clear previous error
    doc.status = "processing"
    doc.error_message = None
    await db.commit()
    await db.refresh(doc)

    background_tasks.add_task(_index_document, document_id)
    logger.info("indexing_retry_initiated", document_id=document_id, filename=doc.original_filename)
    return doc
