"""
Weekly Automatic Cleanup Service
Manages scheduled and on-demand cleanup of temporary user activity data
(chat history, conversation messages, citations, comparisons, and temporary analytics)
while strictly preserving all uploaded documents, chunks, files, and vector embeddings.
"""

import asyncio
from datetime import datetime, timedelta
from typing import Dict, Any, Optional

from sqlalchemy import select, delete, or_
from sqlalchemy.ext.asyncio import AsyncSession

from app.core.config import get_settings
from app.core.database import async_session_factory
from app.core.logging import get_logger
from app.models.models import (
    Chat, ChatMessage, Citation, Comparison, AnalyticsEvent, SystemSetting
)

logger = get_logger(__name__)
settings = get_settings()

SETTING_KEY = "weekly_cleanup"


class CleanupService:
    """
    Automated weekly maintenance service.
    Safely purges temporary user data every 7 days without affecting uploaded knowledge.
    """

    _instance: Optional["CleanupService"] = None

    def __new__(cls) -> "CleanupService":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._stop_event = asyncio.Event()
            cls._instance._is_running = False
        return cls._instance

    async def get_cleanup_status(self, session: AsyncSession) -> Dict[str, Any]:
        """Retrieve the current cleanup schedule and last run status from database."""
        result = await session.execute(
            select(SystemSetting).where(SystemSetting.key == SETTING_KEY)
        )
        setting = result.scalar_one_or_none()

        now = datetime.utcnow()
        if not setting or not setting.value:
            # Initialize default schedule (next run in 7 days from now)
            next_run = now + timedelta(days=settings.cleanup_interval_days)
            initial_val = {
                "enabled": settings.cleanup_enabled,
                "interval_days": settings.cleanup_interval_days,
                "retention_days": settings.cleanup_retention_days,
                "last_cleanup_at": None,
                "next_cleanup_at": next_run.isoformat(),
                "last_deleted_counts": {
                    "chats": 0,
                    "chat_messages": 0,
                    "citations": 0,
                    "comparisons": 0,
                    "analytics_events": 0,
                },
                "status": "idle",
            }
            new_setting = SystemSetting(
                key=SETTING_KEY,
                value=initial_val,
                updated_at=now,
            )
            session.add(new_setting)
            await session.commit()
            return initial_val

        val = dict(setting.value)
        val["enabled"] = settings.cleanup_enabled
        val["interval_days"] = settings.cleanup_interval_days
        val["retention_days"] = settings.cleanup_retention_days
        return val

    async def perform_cleanup(
        self,
        session: AsyncSession,
        older_than_days: Optional[int] = None,
        force: bool = False,
    ) -> Dict[str, Any]:
        """
        Safely purge temporary user data.
        
        Guarantees:
        - Documents (table `documents`): NEVER touched.
        - Document Chunks (table `document_chunks`): NEVER touched.
        - Collections (table `collections`): NEVER touched.
        - Uploaded files on disk: NEVER touched.
        - Vector store / ChromaDB embeddings: NEVER touched.

        Deletes:
        - Citations (chat response references)
        - ChatMessages (conversation messages)
        - Chats (conversation sessions)
        - Comparisons (temporary document diff results)
        - AnalyticsEvents (temporary query/search/comparison activity)
        """
        if older_than_days is None:
            older_than_days = settings.cleanup_retention_days

        now = datetime.utcnow()
        use_cutoff = (older_than_days > 0 and not force)
        cutoff = now - timedelta(days=older_than_days) if use_cutoff else None

        logger.info(
            "cleanup_started",
            cutoff=cutoff.isoformat() if cutoff else "ALL_TEMPORARY_DATA",
            older_than_days=older_than_days,
            force=force,
        )

        records_deleted = {
            "chats": 0,
            "chat_messages": 0,
            "citations": 0,
            "comparisons": 0,
            "analytics_events": 0,
        }

        try:
            # 1. Identify and delete Citations & ChatMessages & Chats
            if cutoff:
                # Find chats created at or before cutoff
                chat_ids_subq = select(Chat.id).where(Chat.created_at <= cutoff)
                msg_ids_subq = select(ChatMessage.id).where(
                    or_(
                        ChatMessage.created_at <= cutoff,
                        ChatMessage.chat_id.in_(chat_ids_subq),
                    )
                )

                del_cits = await session.execute(
                    delete(Citation).where(Citation.message_id.in_(msg_ids_subq))
                )
                del_msgs = await session.execute(
                    delete(ChatMessage).where(
                        or_(
                            ChatMessage.created_at <= cutoff,
                            ChatMessage.chat_id.in_(chat_ids_subq),
                        )
                    )
                )
                del_chats = await session.execute(
                    delete(Chat).where(Chat.created_at <= cutoff)
                )
                del_comps = await session.execute(
                    delete(Comparison).where(Comparison.created_at <= cutoff)
                )
                del_events = await session.execute(
                    delete(AnalyticsEvent).where(
                        AnalyticsEvent.created_at <= cutoff,
                        AnalyticsEvent.event_type.in_(["query", "search", "comparison"]),
                    )
                )
            else:
                # Full purge of all temporary user data
                del_cits = await session.execute(delete(Citation))
                del_msgs = await session.execute(delete(ChatMessage))
                del_chats = await session.execute(delete(Chat))
                del_comps = await session.execute(delete(Comparison))
                del_events = await session.execute(
                    delete(AnalyticsEvent).where(
                        AnalyticsEvent.event_type.in_(["query", "search", "comparison"])
                    )
                )

            records_deleted["citations"] = del_cits.rowcount or 0
            records_deleted["chat_messages"] = del_msgs.rowcount or 0
            records_deleted["chats"] = del_chats.rowcount or 0
            records_deleted["comparisons"] = del_comps.rowcount or 0
            records_deleted["analytics_events"] = del_events.rowcount or 0

            # 2. Update persistent SystemSetting record
            next_run = now + timedelta(days=settings.cleanup_interval_days)
            status_data = {
                "enabled": settings.cleanup_enabled,
                "interval_days": settings.cleanup_interval_days,
                "retention_days": settings.cleanup_retention_days,
                "last_cleanup_at": now.isoformat(),
                "next_cleanup_at": next_run.isoformat(),
                "last_deleted_counts": records_deleted,
                "status": "completed",
            }

            result = await session.execute(
                select(SystemSetting).where(SystemSetting.key == SETTING_KEY)
            )
            setting = result.scalar_one_or_none()
            if setting:
                setting.value = status_data
                setting.updated_at = now
            else:
                setting = SystemSetting(key=SETTING_KEY, value=status_data, updated_at=now)
                session.add(setting)

            await session.commit()

            logger.info("cleanup_completed", records_deleted=records_deleted, next_run=next_run.isoformat())
            return {
                "status": "success",
                "message": "Weekly cleanup completed successfully",
                "last_cleanup_at": now,
                "next_cleanup_at": next_run,
                "records_deleted": records_deleted,
            }

        except Exception as e:
            await session.rollback()
            logger.error("cleanup_failed", error=str(e))
            raise

    async def start_scheduler(self) -> None:
        """
        Background scheduler daemon.
        Executes weekly cleanup reliably across server restarts without duplicate runs.
        """
        if not settings.cleanup_enabled:
            logger.info("weekly_cleanup_disabled")
            return

        self._stop_event.clear()
        self._is_running = True
        logger.info("weekly_cleanup_scheduler_started", interval_days=settings.cleanup_interval_days)

        # Initial check on startup
        try:
            await self._check_and_run()
        except Exception as e:
            logger.warning("initial_cleanup_check_failed", error=str(e))

        # Periodic check loop (every 60 minutes) to prevent drift and handle restarts
        while not self._stop_event.is_set():
            try:
                # Wait 1 hour (3600 seconds) or until stop event is set
                try:
                    await asyncio.wait_for(self._stop_event.wait(), timeout=3600.0)
                    break
                except asyncio.TimeoutError:
                    pass

                await self._check_and_run()

            except asyncio.CancelledError:
                break
            except Exception as e:
                logger.error("weekly_cleanup_loop_error", error=str(e))
                await asyncio.sleep(60)

        self._is_running = False
        logger.info("weekly_cleanup_scheduler_stopped")

    async def _check_and_run(self) -> None:
        """Check if 7 days have passed since last cleanup and execute if due."""
        async with async_session_factory() as session:
            try:
                status = await self.get_cleanup_status(session)
                next_cleanup_raw = status.get("next_cleanup_at")
                if not next_cleanup_raw:
                    return

                next_run = datetime.fromisoformat(next_cleanup_raw)
                now = datetime.utcnow()

                if now >= next_run:
                    # Prevent duplicate execution
                    current_status = status.get("status")
                    if current_status == "running":
                        logger.warning("cleanup_already_in_progress")
                        return

                    logger.info("scheduled_weekly_cleanup_due", now=now.isoformat(), next_run=next_run.isoformat())
                    await self.perform_cleanup(
                        session=session,
                        older_than_days=settings.cleanup_retention_days,
                        force=False,
                    )
            except Exception as e:
                logger.error("check_and_run_error", error=str(e))

    def stop_scheduler(self) -> None:
        """Signal scheduler to shut down cleanly."""
        self._stop_event.set()
