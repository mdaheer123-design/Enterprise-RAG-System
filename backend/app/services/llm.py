"""
LLM Service
Manages interaction with Google Gemini API for answer generation.
Supports streaming responses, hallucination detection, citation extraction,
and automatic model fallback.
"""

import json
import time
from typing import AsyncGenerator, Dict, List, Optional, Any

from google import genai
from google.genai import types
from google.genai.errors import APIError

from app.core.config import get_settings
from app.core.logging import get_logger
from app.services.gemini_key_manager import (
    GeminiKeyManager,
    GeminiQuotaExhaustedError,
    GeminiAllKeysFailedError,
)

logger = get_logger(__name__)
settings = get_settings()

# System instruction for the Enterprise RAG Assistant
_SYSTEM_INSTRUCTION = """You are an Enterprise AI Knowledge Assistant. Your role is to provide accurate, well-structured, and helpful answers based on the provided document context.

CORE GROUNDING RULES:
1. Base your answer primarily on the provided document context.
2. When the context contains the answer (e.g. definitions, standard names, clauses, forewords), explain it clearly and cite the exact source using [Source: filename, Page X, Paragraph Y].
3. Clearly distinguish between:
   (A) What is explicitly stated in the document (with inline citations).
   (B) What can be reasonably inferred from the document.
   (C) General knowledge context (if an acronym or term is referenced in the document but its etymology or background is helpful, you may provide it while clearly stating whether it is explicitly spelled out in the cited section).
4. If the retrieved context contains relevant terms, standards, or sections (e.g., ISO/IEC 27001), synthesize the answer and cite the relevant pages.
5. NEVER fabricate false citations or claim the document contains a specific quotation if it does not.
6. Only state: "I couldn't find information related to your question in the uploaded documents." if the provided context is completely unrelated to the user's question.
7. Be concise, professional, and well-structured. Use bullet points and headers where helpful.
8. At the end of your response, suggest 2-3 relevant follow-up questions.

FORMAT YOUR RESPONSE AS:
- Main answer with inline citations (e.g. [Source: filename, Page X])
- A "Sources" section listing referenced documents and pages
- A "Suggested Questions" section with 2-3 relevant follow-up questions"""


class LLMService:
    """Google Gemini LLM interface with multi-key rotation, streaming, fallback, and calibrated hallucination detection."""

    _instance: Optional["LLMService"] = None

    def __new__(cls) -> "LLMService":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance.key_manager = GeminiKeyManager()
            cls._instance.fallback_models = [
                settings.gemini_model,
                "gemini-2.5-flash",
                "gemini-flash-latest",
                "gemini-3.8-flash",
            ]
        return cls._instance

    @property
    def client(self) -> genai.Client:
        """Backward-compatible client property."""
        if hasattr(self, "key_manager") and self.key_manager.key_states:
            return self.key_manager.key_states[0].get_client()
        return genai.Client(api_key=settings.gemini_api_key)

    def _build_system_prompt(self) -> str:
        """Build the system prompt for the RAG assistant."""
        return _SYSTEM_INSTRUCTION

    def _build_context_prompt(
        self,
        query: str,
        chunks: List[Dict[str, Any]],
        chat_history: Optional[List[Dict[str, str]]] = None,
    ) -> str:
        """Build the context-augmented prompt."""
        context_parts = []
        for i, chunk in enumerate(chunks):
            meta = chunk.get("metadata", {})
            source_info = f"[Source {i+1}: {meta.get('filename', 'Unknown')}, Page {meta.get('page_number', 'N/A')}, Paragraph {meta.get('paragraph_number', 'N/A')}]"
            context_parts.append(f"{source_info}\n{chunk['content']}")

        context = "\n\n---\n\n".join(context_parts)

        # Include chat history for follow-up context
        history_text = ""
        if chat_history:
            recent = chat_history[-6:]  # Last 3 exchanges
            history_parts = [f"{msg['role'].upper()}: {msg['content']}" for msg in recent]
            history_text = f"\n\nPREVIOUS CONVERSATION:\n" + "\n".join(history_parts)

        return f"""DOCUMENT CONTEXT:
{context}
{history_text}

USER QUESTION: {query}

Provide a comprehensive, accurate answer based on the document context above. Cite specific sources and pages."""
    async def generate_answer(
        self,
        query: str,
        chunks: List[Dict[str, Any]],
        chat_history: Optional[List[Dict[str, str]]] = None,
    ) -> Dict[str, Any]:
        """
        Generate a non-streaming answer with citations and automatic model/key fallback.

        Returns:
            Dict with keys: answer, tokens_used, latency_ms, model
        """
        start = time.time()
        context_prompt = self._build_context_prompt(query, chunks, chat_history)

        last_error = None
        for model_name in self._get_model_candidates():
            try:
                async def _call_generate(client: genai.Client):
                    return await client.aio.models.generate_content(
                        model=model_name,
                        contents=context_prompt,
                        config=types.GenerateContentConfig(
                            system_instruction=_SYSTEM_INSTRUCTION,
                            temperature=settings.gemini_temperature,
                            max_output_tokens=settings.gemini_max_tokens,
                        ),
                    )

                response = await self.key_manager.execute_with_retry(_call_generate)

                latency_ms = int((time.time() - start) * 1000)

                tokens_used = None
                if hasattr(response, "usage_metadata") and response.usage_metadata:
                    tokens_used = getattr(response.usage_metadata, "total_token_count", None)

                result = {
                    "answer": response.text,
                    "tokens_used": tokens_used,
                    "latency_ms": latency_ms,
                    "model": model_name,
                }

                logger.info("answer_generated", model=model_name, latency_ms=latency_ms, tokens=tokens_used)
                return result
            except (GeminiQuotaExhaustedError, GeminiAllKeysFailedError) as e:
                logger.error("all_gemini_keys_exhausted_for_model", model=model_name, error=str(e))
                last_error = e
                # Quota is exhausted across all keys; trying another model on the same quota would fail immediately
                break
            except Exception as e:
                logger.warning("gemini_model_call_failed", model=model_name, error=str(e))
                last_error = e
                continue

        raise last_error or RuntimeError("All Gemini model candidates and API keys failed to generate an answer.")

    async def generate_stream(
        self,
        query: str,
        chunks: List[Dict[str, Any]],
        chat_history: Optional[List[Dict[str, str]]] = None,
    ) -> AsyncGenerator[str, None]:
        """
        Generate a streaming answer using SSE-compatible tokens with multi-key and model fallback.

        Yields:
            Individual text tokens as they are generated
        """
        context_prompt = self._build_context_prompt(query, chunks, chat_history)

        for model_name in self._get_model_candidates():
            try:
                def _stream_factory(client: genai.Client):
                    return client.aio.models.generate_content_stream(
                        model=model_name,
                        contents=context_prompt,
                        config=types.GenerateContentConfig(
                            system_instruction=_SYSTEM_INSTRUCTION,
                            temperature=settings.gemini_temperature,
                            max_output_tokens=settings.gemini_max_tokens,
                        ),
                    )

                stream_gen = self.key_manager.execute_stream_with_retry(_stream_factory)
                token_yielded = False
                async for chunk in stream_gen:
                    token_yielded = True
                    yield chunk

                if token_yielded:
                    return
            except Exception as e:
                logger.warning("gemini_stream_failed_retrying_fallback", model=model_name, error=str(e))
                continue

        # If all candidates fail, yield an informative error message
        yield "An error occurred while communicating with the AI service. Please try again."

    def _get_model_candidates(self) -> List[str]:
        """Return unique list of model candidates to try in priority order."""
        seen = set()
        candidates = []
        for m in [settings.gemini_model, "gemini-2.5-flash", "gemini-flash-latest", "gemini-3.8-flash"]:
            if m and m not in seen:
                seen.add(m)
                candidates.append(m)
        return candidates

    def check_hallucination(
        self,
        chunks: List[Dict[str, Any]],
        threshold: Optional[float] = None,
    ) -> bool:
        """
        Check if retrieved chunks meet the calibrated confidence threshold.
        Applies multi-factor scoring according to native scales:
        - Cross-encoder rerank score: calibrated threshold 0.002
        - Dense vector similarity score: settings.similarity_threshold (0.35)
        - RRF fused score: settings.rrf_threshold (0.003)

        Returns:
            True if retrieved content has sufficient relevance, False if likely hallucination risk.
        """
        if not chunks:
            return False

        # Gather best scores across all available metrics
        best_rerank = max((chunk.get("rerank_score", 0.0) for chunk in chunks), default=0.0)
        best_dense = max((chunk.get("dense_score", chunk.get("score", 0.0)) for chunk in chunks if chunk.get("source") == "dense"), default=0.0)
        best_fused = max((chunk.get("fused_score", 0.0) for chunk in chunks), default=0.0)

        rerank_thresh = threshold if threshold is not None else getattr(settings, "rerank_threshold", 0.002)
        dense_thresh = getattr(settings, "similarity_threshold", 0.35)
        fused_thresh = getattr(settings, "rrf_threshold", 0.003)

        # Passes if any primary metric indicates confidence
        passes = (best_rerank >= rerank_thresh) or (best_fused >= fused_thresh) or (best_dense >= dense_thresh)

        logger.info(
            "hallucination_check",
            best_rerank=best_rerank,
            rerank_thresh=rerank_thresh,
            best_fused=best_fused,
            fused_thresh=fused_thresh,
            passes=passes,
        )

        return passes

    async def generate_comparison(
        self,
        doc_a_text: str,
        doc_b_text: str,
        doc_a_name: str,
        doc_b_name: str,
    ) -> Dict[str, Any]:
        """Generate a document comparison analysis."""
        prompt = f"""Compare the following two documents and identify all differences.

DOCUMENT A: {doc_a_name}
{doc_a_text[:10000]}

DOCUMENT B: {doc_b_name}
{doc_b_text[:10000]}

Analyze and return a JSON object with:
{{
    "summary": "Brief overview of the differences",
    "differences": [
        {{
            "type": "added|removed|modified",
            "category": "clause|date|salary|policy|text|term",
            "location_a": "where in doc A (page/section)",
            "location_b": "where in doc B (page/section)",
            "content_a": "original text from doc A",
            "content_b": "changed text from doc B",
            "description": "human-readable description of the change"
        }}
    ]
}}

Return ONLY the JSON object, no markdown formatting."""

        for model_name in self._get_model_candidates():
            try:
                async def _call_comp(client: genai.Client):
                    return await client.aio.models.generate_content(
                        model=model_name,
                        contents=prompt,
                        config=types.GenerateContentConfig(
                            temperature=0.1,
                            response_mime_type="application/json",
                        ),
                    )

                response = await self.key_manager.execute_with_retry(_call_comp)
                text = response.text.strip()
                if text.startswith("```"):
                    text = text.split("```")[1]
                    if text.startswith("json"):
                        text = text[4:]

                return json.loads(text)
            except (GeminiQuotaExhaustedError, GeminiAllKeysFailedError) as e:
                logger.error("comparison_quota_exhausted", error=str(e))
                break
            except Exception as e:
                logger.warning("comparison_model_failed", model=model_name, error=str(e))
                continue

        return {"summary": "Failed to generate comparison.", "differences": []}

    def extract_suggested_questions(self, answer: str) -> List[str]:
        """Extract suggested follow-up questions from the answer."""
        questions = []
        lines = answer.split("\n")
        in_suggestions = False

        for line in lines:
            line = line.strip()
            if "suggested question" in line.lower() or "follow-up" in line.lower():
                in_suggestions = True
                continue
            if in_suggestions and line and (line[0].isdigit() or line.startswith("-") or line.startswith("•")):
                q = line.lstrip("0123456789.-•) ").strip()
                if q and q.endswith("?"):
                    questions.append(q)

        return questions[:3]
