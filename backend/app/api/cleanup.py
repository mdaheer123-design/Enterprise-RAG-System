"""
Cleanup API Routes
Provides endpoints for monitoring weekly cleanup status and triggering on-demand maintenance.
"""

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.database import get_db
from app.core.logging import get_logger
from app.schemas.schemas import CleanupStatusResponse, CleanupRunRequest, CleanupRunResponse
from app.services.cleanup_service import CleanupService

logger = get_logger(__name__)
router = APIRouter(prefix="/cleanup", tags=["Cleanup"])

cleanup_service = CleanupService()


@router.get("/status", response_model=CleanupStatusResponse)
async def get_status(db: AsyncSession = Depends(get_db)):
    """Get the current automatic weekly cleanup schedule and history."""
    try:
        data = await cleanup_service.get_cleanup_status(db)
        return CleanupStatusResponse(
            enabled=data.get("enabled", True),
            interval_days=data.get("interval_days", 7),
            retention_days=data.get("retention_days", 7),
            last_cleanup_at=data.get("last_cleanup_at"),
            next_cleanup_at=data.get("next_cleanup_at"),
            last_deleted_counts=data.get("last_deleted_counts"),
            status=data.get("status", "idle"),
            message="Weekly cleanup is active and scheduled",
        )
    except Exception as e:
        logger.error("get_cleanup_status_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Failed to fetch cleanup status: {str(e)}")


@router.post("/run", response_model=CleanupRunResponse)
async def trigger_cleanup(
    body: CleanupRunRequest = CleanupRunRequest(),
    db: AsyncSession = Depends(get_db),
):
    """
    Trigger cleanup of temporary user data.
    Safely purges chats, conversation messages, citations, comparisons, and temporary activity logs.
    Uploaded documents, files, collections, and embeddings are strictly preserved.
    """
    try:
        result = await cleanup_service.perform_cleanup(
            session=db,
            older_than_days=body.older_than_days,
            force=body.force,
        )
        return CleanupRunResponse(
            status=result["status"],
            message=result["message"],
            last_cleanup_at=result["last_cleanup_at"],
            next_cleanup_at=result["next_cleanup_at"],
            records_deleted=result["records_deleted"],
        )
    except Exception as e:
        logger.error("trigger_cleanup_failed", error=str(e))
        raise HTTPException(status_code=500, detail=f"Cleanup execution failed: {str(e)}")
