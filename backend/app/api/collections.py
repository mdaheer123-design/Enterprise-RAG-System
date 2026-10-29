"""
Collection API Routes
Manages document collections (folders/groups).
"""

from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy import select, func, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.models.models import Collection, Document, Chat
from app.schemas.schemas import CollectionCreate, CollectionUpdate, CollectionResponse
from app.services.vector_store import VectorStore

logger = get_logger(__name__)
router = APIRouter(prefix="/collections", tags=["Collections"])


@router.post("/", response_model=CollectionResponse)
async def create_collection(
    data: CollectionCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new collection."""
    # Check for duplicate name
    existing = await db.execute(select(Collection).where(Collection.name == data.name))
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=409, detail=f"Collection '{data.name}' already exists")

    collection = Collection(**data.model_dump())
    db.add(collection)
    await db.flush()
    await db.commit()
    await db.refresh(collection)

    logger.info("collection_created", id=collection.id, name=collection.name)
    return collection


@router.get("/", response_model=list[CollectionResponse])
async def list_collections(db: AsyncSession = Depends(get_db)):
    """List all collections with document counts."""
    result = await db.execute(
        select(Collection).order_by(Collection.created_at.desc())
    )
    return result.scalars().all()


@router.get("/{collection_id}", response_model=CollectionResponse)
async def get_collection(collection_id: str, db: AsyncSession = Depends(get_db)):
    """Get a single collection."""
    result = await db.execute(select(Collection).where(Collection.id == collection_id))
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")
    return collection


@router.put("/{collection_id}", response_model=CollectionResponse)
async def update_collection(
    collection_id: str,
    data: CollectionUpdate,
    db: AsyncSession = Depends(get_db),
):
    """Update a collection."""
    result = await db.execute(select(Collection).where(Collection.id == collection_id))
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    update_data = data.model_dump(exclude_unset=True)
    for key, value in update_data.items():
        setattr(collection, key, value)

    await db.commit()
    await db.refresh(collection)
    return collection


@router.delete("/{collection_id}")
async def delete_collection(collection_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a collection, clean up documents, unlink chats, and remove vector store assets."""
    result = await db.execute(select(Collection).where(Collection.id == collection_id))
    collection = result.scalar_one_or_none()
    if not collection:
        raise HTTPException(status_code=404, detail="Collection not found")

    # 1. Unlink any chats referencing this collection to avoid foreign key errors
    await db.execute(
        update(Chat).where(Chat.collection_id == collection_id).values(collection_id=None)
    )

    # 2. Clean up any documents in this collection
    doc_res = await db.execute(select(Document).where(Document.collection_id == collection_id))
    docs = doc_res.scalars().all()
    if docs:
        vector_store = VectorStore()
        for doc in docs:
            try:
                vector_store.delete_document(doc.id)
            except Exception as e:
                logger.warning("chroma_delete_failed_on_col_delete", doc_id=doc.id, error=str(e))
            await db.delete(doc)

    # 3. Delete collection record
    await db.delete(collection)
    await db.commit()

    logger.info("collection_deleted", id=collection_id)
    return {"message": "Collection deleted", "id": collection_id}
