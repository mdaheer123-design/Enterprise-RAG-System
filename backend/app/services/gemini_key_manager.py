"""
Gemini API Key Manager
Manages pool of Gemini API keys with automatic failover, health tracking,
rate-limit detection, cooldowns, exponential backoff, and shared quota protection.
Guarantees that raw API keys are never exposed in logs or client-facing responses.
"""

import asyncio
import time
from dataclasses import dataclass
from typing import Any, AsyncGenerator, Callable, Coroutine, Dict, List, Optional, TypeVar

from google import genai
from google.genai.errors import APIError

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)
T = TypeVar("T")


def mask_key(key: str) -> str:
    """Return a masked representation of an API key for safe logging."""
    if not key:
        return "<EMPTY_KEY>"
    if len(key) <= 8:
        return "***"
    return f"{key[:6]}...{key[-4:]}"


class GeminiQuotaExhaustedError(RuntimeError):
    """Raised when all configured Gemini API keys have exhausted their rate limit or quota."""
    pass


class GeminiAllKeysFailedError(RuntimeError):
    """Raised when all configured Gemini API keys failed (e.g., all marked invalid)."""
    pass


@dataclass
class KeyState:
    """State and health tracking for a single Gemini API key."""
    key: str
    masked: str
    index: int
    is_valid: bool = True
    invalid_reason: Optional[str] = None
    cooldown_until: float = 0.0
    consecutive_failures: int = 0
    total_calls: int = 0
    total_failures: int = 0
    client: Optional[genai.Client] = None

    def get_client(self) -> genai.Client:
        """Lazily initialize client per key."""
        if self.client is None:
            self.client = genai.Client(api_key=self.key)
        return self.client

    def is_eligible(self, now: float) -> bool:
        """Check if key is valid and not currently in cooldown."""
        return self.is_valid and self.cooldown_until <= now


class GeminiKeyManager:
    """
    Thread-safe / async pool manager for Gemini API keys.
    Provides automatic rotation on rate limits, bounded retries,
    exponential backoff, cooldowns, and shared quota exhaustion detection.
    """

    _instance: Optional["GeminiKeyManager"] = None

    def __new__(cls, *args, **kwargs) -> "GeminiKeyManager":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
            cls._instance._initialized = False
        return cls._instance

    def __init__(self, keys: Optional[List[str]] = None):
        if getattr(self, "_initialized", False):
            if keys is not None:
                self._load_keys(keys)
            return

        self._lock = asyncio.Lock()
        self._current_idx = 0
        self.settings = get_settings()

        self.cooldown_seconds = getattr(self.settings, "gemini_key_cooldown_seconds", 60.0)
        self.transient_cooldown_seconds = 15.0
        self.max_retries_per_key = getattr(self.settings, "gemini_max_retries_per_key", 2)
        self.total_max_retries = getattr(self.settings, "gemini_total_max_retries", 6)
        self.backoff_factor = getattr(self.settings, "gemini_backoff_factor", 0.5)

        initial_keys = keys if keys is not None else self.settings.all_gemini_api_keys
        self._load_keys(initial_keys)
        self._initialized = True

    def _load_keys(self, raw_keys: List[str]) -> None:
        """Populate or reload key states."""
        self.key_states: List[KeyState] = []
        for i, key in enumerate(raw_keys, start=1):
            cleaned = key.strip()
            if cleaned:
                self.key_states.append(
                    KeyState(
                        key=cleaned,
                        masked=mask_key(cleaned),
                        index=i,
                    )
                )

        logger.info(
            "gemini_key_manager_initialized",
            total_keys=len(self.key_states),
            keys=[k.masked for k in self.key_states],
        )

    @property
    def total_keys(self) -> int:
        return len(self.key_states)

    def classify_error(self, exc: Exception) -> str:
        """
        Classifies an error to determine whether to rotate, blacklist, backoff, or re-raise.
        Returns:
            - 'rate_limit': 429, RESOURCE_EXHAUSTED, quota limit
            - 'invalid_key': 400/401/403 with invalid key / permission denied on key
            - 'transient': 500, 502, 503, 504, connection error, timeout
            - 'content': Prompt safety blocked or bad argument (do not rotate key)
            - 'other': Unclassified exception
        """
        err_msg = str(exc).lower()
        err_code = getattr(exc, "code", None)

        # 1. Rate Limit / Quota Exhaustion
        if err_code == 429 or "429" in err_msg or "resource_exhausted" in err_msg or "quota" in err_msg:
            return "rate_limit"

        # 2. Invalid API Key / Authentication
        if err_code in (400, 401, 403) and (
            "api_key_invalid" in err_msg
            or "api key not valid" in err_msg
            or "invalid api key" in err_msg
            or "permission_denied" in err_msg
            or "unregistered" in err_msg
        ):
            return "invalid_key"

        # 3. Transient Server / Network Errors
        if err_code in (500, 502, 503, 504) or "unavailable" in err_msg or "overloaded" in err_msg or "timeout" in err_msg or "connection" in err_msg:
            return "transient"

        # 4. Content / Safety
        if "safety" in err_msg or "harm" in err_msg or "blocked" in err_msg:
            return "content"

        return "other"

    async def get_next_key(self) -> KeyState:
        """
        Selects the next eligible key via round-robin.
        If all keys are in cooldown, checks whether shared quota is exhausted
        or waits if the shortest cooldown is brief.
        """
        async with self._lock:
            if not self.key_states:
                raise GeminiAllKeysFailedError("No Gemini API keys configured.")

            valid_keys = [k for k in self.key_states if k.is_valid]
            if not valid_keys:
                raise GeminiAllKeysFailedError("All Gemini API keys are marked invalid.")

            now = time.time()
            total_count = len(self.key_states)

            # Circular scan starting from _current_idx to preserve order
            for offset in range(total_count):
                idx = (self._current_idx + offset) % total_count
                candidate = self.key_states[idx]
                if candidate.is_eligible(now):
                    self._current_idx = (idx + 1) % total_count
                    return candidate

            # If no keys are currently eligible, inspect cooldowns
            earliest_key = min(valid_keys, key=lambda k: k.cooldown_until)
            wait_time = earliest_key.cooldown_until - now

            if wait_time > 10.0:
                logger.error(
                    "all_gemini_keys_exhausted_or_in_cooldown",
                    earliest_cooldown_in_sec=round(wait_time, 2),
                    total_valid_keys=len(valid_keys),
                )
                raise GeminiQuotaExhaustedError(
                    f"All Gemini API keys are currently in cooldown (earliest resets in {int(wait_time)}s)."
                )

            # If wait is short (<= 10s), wait until the earliest key recovers
            logger.info("waiting_for_gemini_key_cooldown", wait_time=round(wait_time, 2), key=earliest_key.masked)
            await asyncio.sleep(max(wait_time, 0.1))
            return earliest_key

    async def record_success(self, key_state: KeyState) -> None:
        """Update metrics on successful call."""
        async with self._lock:
            key_state.consecutive_failures = 0
            key_state.total_calls += 1

    async def record_failure(self, key_state: KeyState, exc: Exception, error_type: str) -> None:
        """Update key state, apply cooldown or mark invalid based on error classification."""
        async with self._lock:
            now = time.time()
            key_state.consecutive_failures += 1
            key_state.total_failures += 1

            if error_type == "invalid_key":
                key_state.is_valid = False
                key_state.invalid_reason = str(exc)
                logger.warning(
                    "gemini_key_permanently_invalidated",
                    key_index=key_state.index,
                    masked_key=key_state.masked,
                    reason=str(exc),
                )
            elif error_type == "rate_limit":
                # Apply rate-limit cooldown with exponential multiplier for repeated failures
                cooldown = self.cooldown_seconds * (1.5 ** (min(key_state.consecutive_failures - 1, 3)))
                key_state.cooldown_until = now + cooldown
                logger.warning(
                    "gemini_key_rate_limited",
                    key_index=key_state.index,
                    masked_key=key_state.masked,
                    cooldown_seconds=round(cooldown, 1),
                )
            elif error_type == "transient":
                key_state.cooldown_until = now + self.transient_cooldown_seconds
                logger.warning(
                    "gemini_key_temporary_failure",
                    key_index=key_state.index,
                    masked_key=key_state.masked,
                    cooldown_seconds=self.transient_cooldown_seconds,
                    error=str(exc),
                )

    async def execute_with_retry(
        self,
        operation: Callable[[genai.Client], Coroutine[Any, Any, T]],
    ) -> T:
        """
        Execute an async Gemini operation with automatic key rotation,
        exponential backoff, cooldowns, and shared quota exhaustion detection.
        """
        max_attempts = min(max(len(self.key_states) * self.max_retries_per_key, 2), self.total_max_retries)
        last_error = None
        attempted_keys = set()

        for attempt in range(max_attempts):
            try:
                key_state = await self.get_next_key()
            except (GeminiQuotaExhaustedError, GeminiAllKeysFailedError) as e:
                # Quota or validity exhausted across the entire pool
                raise e

            attempted_keys.add(key_state.index)

            try:
                client = key_state.get_client()
                result = await operation(client)
                await self.record_success(key_state)
                return result

            except Exception as exc:
                last_error = exc
                error_type = self.classify_error(exc)

                # If it's a content/safety error, switching keys won't help
                if error_type == "content":
                    raise exc

                await self.record_failure(key_state, exc, error_type)

                # Check if we have attempted all available valid keys for rate limit
                valid_count = sum(1 for k in self.key_states if k.is_valid)
                if error_type == "rate_limit" and len(attempted_keys) >= valid_count:
                    # All valid keys have failed with rate limits in this execution
                    logger.error(
                        "all_keys_rate_limited_shared_quota_detected",
                        attempted_count=len(attempted_keys),
                        total_valid=valid_count,
                    )
                    raise GeminiQuotaExhaustedError(
                        "All available Gemini API keys have exceeded quota or rate limits (shared quota limit reached)."
                    ) from exc

                # Exponential backoff before next attempt
                backoff = min(self.backoff_factor * (2 ** attempt), 4.0)
                await asyncio.sleep(backoff)

        raise last_error or RuntimeError("Gemini operation failed after maximum retries across keys.")

    async def execute_stream_with_retry(
        self,
        stream_factory: Callable[[genai.Client], Coroutine[Any, Any, Any]],
    ) -> AsyncGenerator[str, None]:
        """
        Execute an async Gemini streaming operation with automatic key rotation.
        If the stream fails prior to yielding any chunk, smoothly failover to the next key.
        Once chunks start flowing, stream directly to caller.
        """
        max_attempts = min(max(len(self.key_states) * self.max_retries_per_key, 2), self.total_max_retries)
        last_error = None
        attempted_keys = set()

        for attempt in range(max_attempts):
            try:
                key_state = await self.get_next_key()
            except (GeminiQuotaExhaustedError, GeminiAllKeysFailedError) as e:
                yield f"[AI Service Error: {str(e)}]"
                return

            attempted_keys.add(key_state.index)

            try:
                client = key_state.get_client()
                stream = await stream_factory(client)

                first_chunk_received = False
                async for chunk in stream:
                    if not first_chunk_received:
                        first_chunk_received = True
                        await self.record_success(key_state)

                    if chunk.text:
                        yield chunk.text

                # Stream completed successfully
                return

            except Exception as exc:
                last_error = exc
                error_type = self.classify_error(exc)

                if error_type == "content":
                    yield f"[Content Filter: {str(exc)}]"
                    return

                await self.record_failure(key_state, exc, error_type)

                # Check shared quota limit
                valid_count = sum(1 for k in self.key_states if k.is_valid)
                if error_type == "rate_limit" and len(attempted_keys) >= valid_count:
                    logger.error("streaming_all_keys_rate_limited", attempted=len(attempted_keys))
                    yield "[AI Service Error: All API keys have exceeded quota limits. Please try again later.]"
                    return

                backoff = min(self.backoff_factor * (2 ** attempt), 3.0)
                await asyncio.sleep(backoff)

        yield f"[AI Service Error: Request failed after attempting multiple API keys: {str(last_error)}]"

    def get_status_summary(self) -> List[Dict[str, Any]]:
        """Return diagnostic metrics without exposing raw keys."""
        now = time.time()
        return [
            {
                "index": k.index,
                "masked_key": k.masked,
                "is_valid": k.is_valid,
                "in_cooldown": k.cooldown_until > now,
                "cooldown_remaining_sec": max(0, round(k.cooldown_until - now, 1)),
                "total_calls": k.total_calls,
                "total_failures": k.total_failures,
                "consecutive_failures": k.consecutive_failures,
            }
            for k in self.key_states
        ]
