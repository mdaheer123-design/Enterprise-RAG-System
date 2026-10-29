"""
Chat API Routes
Handles chat creation, messaging, streaming responses, and chat history.
"""

import json
import time
from typing import Optional, Any, List

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from app.core.database import get_db
from app.core.config import get_settings
from app.core.logging import get_logger

settings = get_settings()
from app.models.models import Chat, ChatMessage, Citation, AnalyticsEvent, Document
from app.schemas.schemas import (
    ChatCreate, ChatResponse, ChatListResponse,
    ChatDetailResponse, MessageResponse, QueryRequest, QueryResponse,
)
from app.services.rag_pipeline import RAGPipeline

logger = get_logger(__name__)
router = APIRouter(prefix="/chat", tags=["Chat"])

rag_pipeline = RAGPipeline()


def _safe_int(val: Any) -> Optional[int]:
    """Safely coerce a value to Optional[int] so empty strings do not crash Postgres."""
    if val is None or val == "":
        return None
    try:
        return int(val)
    except (ValueError, TypeError):
        return None


@router.post("/", response_model=ChatResponse)
async def create_chat(
    data: ChatCreate,
    db: AsyncSession = Depends(get_db),
):
    """Create a new chat session."""
    chat = Chat(
        title=data.title or "New Chat",
        collection_id=data.collection_id,
    )
    db.add(chat)
    await db.flush()
    await db.commit()
    await db.refresh(chat)

    logger.info("chat_created", chat_id=chat.id)
    return chat


@router.get("/", response_model=ChatListResponse)
async def list_chats(
    page: int = 1,
    page_size: int = 20,
    db: AsyncSession = Depends(get_db),
):
    """List all chat sessions."""
    count_result = await db.execute(select(func.count()).select_from(Chat))
    total = count_result.scalar()

    stmt = (
        select(Chat)
        .where(Chat.is_active == True)
        .order_by(Chat.updated_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    result = await db.execute(stmt)
    chats = result.scalars().all()

    return ChatListResponse(chats=chats, total=total)


@router.get("/{chat_id}", response_model=ChatDetailResponse)
async def get_chat(chat_id: str, db: AsyncSession = Depends(get_db)):
    """Get a chat with all messages and citations."""
    stmt = (
        select(Chat)
        .options(selectinload(Chat.messages).selectinload(ChatMessage.citations))
        .where(Chat.id == chat_id)
    )
    result = await db.execute(stmt)
    chat = result.scalar_one_or_none()

    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    return ChatDetailResponse(
        chat=ChatResponse.model_validate(chat),
        messages=[MessageResponse.model_validate(m) for m in chat.messages],
    )


@router.post("/ask", response_model=QueryResponse)
async def ask_question(
    data: QueryRequest,
    db: AsyncSession = Depends(get_db),
):
    """Ask a question and get a non-streaming response with citations."""
    # Create or get chat
    if data.chat_id:
        result = await db.execute(select(Chat).where(Chat.id == data.chat_id))
        chat = result.scalar_one_or_none()
        if not chat:
            raise HTTPException(status_code=404, detail="Chat not found")
    else:
        chat = Chat(title=data.question[:50] + "..." if len(data.question) > 50 else data.question)
        db.add(chat)
        await db.flush()

    # Save user message
    user_msg = ChatMessage(
        chat_id=chat.id,
        role="user",
        content=data.question,
    )
    db.add(user_msg)
    await db.flush()

    # Run RAG pipeline
    result = await rag_pipeline.process_query(
        query=data.question,
        db=db,
        chat_id=chat.id,
        collection_id=data.collection_id or chat.collection_id,
        filters=data.filters,
    )

    # Save assistant message
    assistant_msg = ChatMessage(
        chat_id=chat.id,
        role="assistant",
        content=result["answer"],
        tokens_used=result.get("tokens_used"),
        latency_ms=result.get("latency_ms"),
        model=result.get("model"),
    )
    db.add(assistant_msg)
    await db.flush()

    # Save citations (only for documents that exist in DB to prevent foreign key errors)
    existing_docs = await db.execute(select(Document.id))
    valid_doc_ids = set(existing_docs.scalars().all())

    citation_responses = []
    for cit_data in result["citations"]:
        doc_id = cit_data.get("document_id")
        if not doc_id or doc_id not in valid_doc_ids:
            continue
        citation = Citation(
            message_id=assistant_msg.id,
            document_id=doc_id,
            chunk_id=cit_data["chunk_id"],
            filename=cit_data["filename"],
            page_number=_safe_int(cit_data.get("page_number")),
            paragraph_number=_safe_int(cit_data.get("paragraph_number")),
            relevance_score=cit_data["relevance_score"],
            snippet=cit_data["snippet"],
        )
        db.add(citation)
        cit_dict = dict(cit_data)
        cit_dict["id"] = citation.id
        citation_responses.append(cit_dict)

    # Update chat
    chat.message_count = (chat.message_count or 0) + 2
    if chat.title == "New Chat":
        chat.title = data.question[:80]

    # Track analytics
    event = AnalyticsEvent(
        event_type="query",
        event_data={
            "chat_id": chat.id,
            "question": data.question[:200],
            "confidence": result["confidence"],
        },
    )
    db.add(event)

    await db.commit()

    return QueryResponse(
        answer=result["answer"],
        chat_id=chat.id,
        message_id=assistant_msg.id,
        citations=citation_responses,
        confidence=result["confidence"],
        suggested_questions=result.get("suggested_questions", []),
        tokens_used=result.get("tokens_used"),
        latency_ms=result.get("latency_ms"),
    )


@router.post("/stream")
async def stream_response(
    data: QueryRequest,
    db: AsyncSession = Depends(get_db),
):
    """Stream a response using Server-Sent Events (SSE)."""

    async def generate():
        chat = None
        full_answer = ""
        final_data = {}
        committed = False

        try:
            # ── Create or get chat ────────────────────────────────
            if data.chat_id:
                result = await db.execute(select(Chat).where(Chat.id == data.chat_id))
                chat = result.scalar_one_or_none()
                if not chat:
                    yield f"data: {json.dumps({'type': 'error', 'data': 'Chat not found'})}\n\n"
                    yield f"data: {json.dumps({'type': 'done', 'data': {'citations': [], 'confidence': 0.0, 'suggested_questions': []}})}\n\n"
                    return
            else:
                chat = Chat(title=data.question[:50] + ("..." if len(data.question) > 50 else ""))
                db.add(chat)
                await db.flush()

            # ── Save user message ─────────────────────────────────
            user_msg = ChatMessage(chat_id=chat.id, role="user", content=data.question)
            db.add(user_msg)
            await db.flush()

            # ── Send chat_id immediately ──────────────────────────
            yield f"data: {json.dumps({'type': 'chat_id', 'data': chat.id})}\n\n"
            yield f"data: {json.dumps({'type': 'status', 'data': 'Searching documents…'})}\n\n"

            # ── Stream from RAG pipeline ──────────────────────────
            async for event in rag_pipeline.process_query_stream(
                query=data.question,
                db=db,
                chat_id=chat.id,
                collection_id=data.collection_id or chat.collection_id,
                filters=data.filters,
            ):
                event_type = event["type"]
                if event_type == "token":
                    full_answer += event["data"]
                    yield f"data: {json.dumps(event)}\n\n"
                elif event_type == "status":
                    yield f"data: {json.dumps(event)}\n\n"
                elif event_type == "done":
                    final_data = event["data"]
                    yield f"data: {json.dumps(event)}\n\n"
                elif event_type == "error":
                    # Yield error but ALSO a done event so frontend resolves the pending msg
                    yield f"data: {json.dumps(event)}\n\n"
                    yield f"data: {json.dumps({'type': 'done', 'data': {'citations': [], 'confidence': 0.0, 'suggested_questions': []}})}\n\n"

            # ── Persist assistant message & citations ─────────────
            if not full_answer:
                full_answer = "I couldn't find information related to your question in the uploaded documents. Please try rephrasing your question or upload relevant documents."

            assistant_msg = ChatMessage(
                chat_id=chat.id,
                role="assistant",
                content=full_answer,
                latency_ms=final_data.get("latency_ms"),
                model=final_data.get("model", settings.gemini_model),
            )
            db.add(assistant_msg)
            await db.flush()

            # Query existing document IDs in DB to prevent foreign key violations
            existing_docs = await db.execute(select(Document.id))
            valid_doc_ids = set(existing_docs.scalars().all())

            for cit_data in final_data.get("citations", []):
                doc_id = cit_data.get("document_id", "")
                if not doc_id or doc_id not in valid_doc_ids:
                    continue
                citation = Citation(
                    message_id=assistant_msg.id,
                    document_id=doc_id,
                    chunk_id=cit_data.get("chunk_id", ""),
                    filename=cit_data.get("filename", ""),
                    page_number=_safe_int(cit_data.get("page_number")),
                    paragraph_number=_safe_int(cit_data.get("paragraph_number")),
                    relevance_score=cit_data.get("relevance_score", 0),
                    snippet=cit_data.get("snippet", ""),
                )
                db.add(citation)

            chat.message_count = (chat.message_count or 0) + 2

            # Always commit to persist user_msg even when answer is empty
            await db.commit()
            committed = True

        except Exception as exc:
            logger.error("stream_endpoint_error", error=str(exc))
            if not committed:
                try:
                    await db.rollback()
                except Exception:
                    pass
            yield f"data: {json.dumps({'type': 'error', 'data': 'An unexpected server error occurred. Please try again.'})}\n\n"
            yield f"data: {json.dumps({'type': 'done', 'data': {'citations': [], 'confidence': 0.0, 'suggested_questions': []}})}\n\n"

    return StreamingResponse(
        generate(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "Connection": "keep-alive",
            "X-Accel-Buffering": "no",
        },
    )


@router.delete("/{chat_id}")
async def delete_chat(chat_id: str, db: AsyncSession = Depends(get_db)):
    """Delete a chat session."""
    result = await db.execute(select(Chat).where(Chat.id == chat_id))
    chat = result.scalar_one_or_none()
    if not chat:
        raise HTTPException(status_code=404, detail="Chat not found")

    await db.delete(chat)
    await db.commit()
    return {"message": "Chat deleted", "id": chat_id}


@router.get("/{chat_id}/history")
async def get_chat_history(
    chat_id: str,
    limit: int = 50,
    db: AsyncSession = Depends(get_db),
):
    """Get chat message history."""
    stmt = (
        select(ChatMessage)
        .options(selectinload(ChatMessage.citations))
        .where(ChatMessage.chat_id == chat_id)
        .order_by(ChatMessage.created_at.asc())
        .limit(limit)
    )
    result = await db.execute(stmt)
    messages = result.scalars().all()

    return [MessageResponse.model_validate(m) for m in messages]
