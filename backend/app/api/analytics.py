"""
Analytics API Routes
Provides dashboard statistics and usage metrics.
"""

from datetime import datetime, timedelta

from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.models.models import Document, Collection, Chat, ChatMessage, AnalyticsEvent
from app.schemas.schemas import AnalyticsOverview, DocumentResponse

logger = get_logger(__name__)
router = APIRouter(prefix="/analytics", tags=["Analytics"])


@router.get("/overview", response_model=AnalyticsOverview)
async def get_overview(db: AsyncSession = Depends(get_db)):
    """Get comprehensive analytics overview for the dashboard."""
    # Total documents
    doc_count = (await db.execute(select(func.count()).select_from(Document))).scalar() or 0

    # Total collections
    col_count = (await db.execute(select(func.count()).select_from(Collection))).scalar() or 0

    # Total chats
    chat_count = (await db.execute(select(func.count()).select_from(Chat))).scalar() or 0

    # Total questions (user messages)
    question_count = (await db.execute(
        select(func.count()).select_from(ChatMessage).where(ChatMessage.role == "user")
    )).scalar() or 0

    # Total storage
    storage = (await db.execute(select(func.sum(Document.file_size)))).scalar() or 0

    # Documents by type
    type_result = await db.execute(
        select(Document.file_type, func.count())
        .group_by(Document.file_type)
    )
    docs_by_type = {row[0]: row[1] for row in type_result.all()}

    # Recent uploads (last 10)
    recent_result = await db.execute(
        select(Document)
        .order_by(Document.created_at.desc())
        .limit(10)
    )
    recent_uploads = recent_result.scalars().all()

    # Questions per day (last 7 days)
    seven_days_ago = datetime.utcnow() - timedelta(days=7)
    daily_result = await db.execute(
        select(
            func.date_trunc("day", ChatMessage.created_at).label("day"),
            func.count().label("count"),
        )
        .where(ChatMessage.role == "user")
        .where(ChatMessage.created_at >= seven_days_ago)
        .group_by("day")
        .order_by("day")
    )

    questions_per_day = [
        {"date": str(row.day), "count": row.count}
        for row in daily_result.all()
    ]

    return AnalyticsOverview(
        total_documents=doc_count,
        total_collections=col_count,
        total_chats=chat_count,
        total_questions=question_count,
        total_storage_bytes=storage,
        documents_by_type=docs_by_type,
        recent_uploads=[DocumentResponse.model_validate(d) for d in recent_uploads],
        questions_per_day=questions_per_day,
    )
