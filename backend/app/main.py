"""
Enterprise AI Knowledge Assistant – FastAPI Application
Main entry point with middleware, CORS, rate limiting, and route registration.
"""

from contextlib import asynccontextmanager

from fastapi import FastAPI, Request
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from slowapi import Limiter, _rate_limit_exceeded_handler
from slowapi.errors import RateLimitExceeded
from slowapi.util import get_remote_address

from app.core.config import get_settings
from app.core.database import init_db, close_db
from app.core.logging import setup_logging, get_logger
from app.api import documents, chat, collections, search, comparison, analytics, cleanup

settings = get_settings()


# ── Lifespan ─────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    """Application startup and shutdown events."""
    setup_logging()
    logger = get_logger("app")
    logger.info("application_starting", env=settings.env)

    # Initialize database tables (dev only)
    if settings.env == "development":
        await init_db()
        logger.info("database_initialized")

    # Warm up ML models in background thread so user queries are instant
    import asyncio
    from app.services.embedding import EmbeddingService
    from app.services.reranker import RerankerService

    def _warmup_models():
        try:
            logger.info("preloading_models_start")
            _ = EmbeddingService().model
            _ = RerankerService().model
            logger.info("preloading_models_complete")
        except Exception as e:
            logger.warning("preloading_models_failed", error=str(e))

    asyncio.get_running_loop().run_in_executor(None, _warmup_models)

    # Sync ChromaDB with database to eliminate any orphaned vectors
    async def _cleanup_orphaned_vectors():
        try:
            from app.core.database import async_session_factory
            from app.models.models import Document
            from app.services.vector_store import VectorStore
            from sqlalchemy import select

            async with async_session_factory() as session:
                docs = await session.execute(select(Document.id))
                valid_ids = set(docs.scalars().all())

            vs = VectorStore()
            col = vs.get_or_create_collection()
            results = col.get(include=["metadatas"])
            chroma_ids = set(m.get("document_id") for m in results["metadatas"] if m)
            orphans = chroma_ids - valid_ids
            for oid in orphans:
                if oid:
                    vs.delete_by_document(oid)
                    logger.info("cleaned_orphaned_vector", document_id=oid)
        except Exception as e:
            logger.warning("vector_store_sync_failed", error=str(e))

    asyncio.create_task(_cleanup_orphaned_vectors())

    # Weekly automatic cleanup background scheduler
    from app.services.cleanup_service import CleanupService
    cleanup_svc = CleanupService()
    cleanup_task = asyncio.create_task(cleanup_svc.start_scheduler())

    yield

    # Shutdown
    cleanup_svc.stop_scheduler()
    cleanup_task.cancel()
    await close_db()
    logger.info("application_stopped")


# ── App Instance ─────────────────────────────────────────────────
app = FastAPI(
    title="Enterprise AI Knowledge Assistant",
    description="Production-grade RAG-powered document assistant with hybrid search, reranking, and streaming.",
    version="1.0.0",
    lifespan=lifespan,
    docs_url="/docs",
    redoc_url="/redoc",
)


# ── Rate Limiting ────────────────────────────────────────────────
limiter = Limiter(key_func=get_remote_address)
app.state.limiter = limiter
app.add_exception_handler(RateLimitExceeded, _rate_limit_exceeded_handler)


# ── CORS ─────────────────────────────────────────────────────────
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Global Error Handler ────────────────────────────────────────
@app.exception_handler(Exception)
async def global_exception_handler(request: Request, exc: Exception):
    logger = get_logger("app")
    logger.error("unhandled_error", error=str(exc), path=request.url.path)
    return JSONResponse(
        status_code=500,
        content={"detail": f"An internal error occurred: {str(exc)}"},
    )


# ── Register Routes ─────────────────────────────────────────────
app.include_router(documents.router, prefix="/api")
app.include_router(chat.router, prefix="/api")
app.include_router(collections.router, prefix="/api")
app.include_router(search.router, prefix="/api")
app.include_router(comparison.router, prefix="/api")
app.include_router(analytics.router, prefix="/api")
app.include_router(cleanup.router, prefix="/api")


# ── Health Check ─────────────────────────────────────────────────
@app.get("/health", tags=["Health"])
@app.get("/api/health", tags=["Health"])
async def health_check():
    return {
        "status": "healthy",
        "version": "1.0.0",
        "environment": settings.env,
    }


@app.get("/", tags=["Root"])
async def root():
    return {
        "name": "Enterprise AI Knowledge Assistant",
        "version": "1.0.0",
        "docs": "/docs",
    }
