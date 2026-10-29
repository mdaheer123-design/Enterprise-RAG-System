"""
Tests for GeminiKeyManager: Key Rotation, Failures, Cooldowns, Recovery, and Quota Exhaustion.
"""

import asyncio
import time
from unittest.mock import AsyncMock, MagicMock, patch
import pytest

from app.core.config import Settings
from app.services.gemini_key_manager import (
    GeminiKeyManager,
    GeminiQuotaExhaustedError,
    GeminiAllKeysFailedError,
    KeyState,
    mask_key,
)


class DummyChunk:
    def __init__(self, text: str):
        self.text = text


class DummyStream:
    def __init__(self, texts):
        self.texts = texts

    def __aiter__(self):
        self._iter = iter(self.texts)
        return self

    async def __anext__(self):
        try:
            val = next(self._iter)
            return DummyChunk(val)
        except StopIteration:
            raise StopAsyncIteration


class MockAPIError(Exception):
    def __init__(self, code: int, message: str):
        self.code = code
        self.message = message
        super().__init__(f"{code} {message}")


@pytest.fixture
def mock_keys():
    return [
        "AQ.KeyOne1111111111111111111111111111111111111",
        "AQ.KeyTwo2222222222222222222222222222222222222",
        "AQ.KeyThree33333333333333333333333333333333333",
    ]


@pytest.fixture
def manager(mock_keys):
    # Reset singleton instance for tests
    GeminiKeyManager._instance = None
    mgr = GeminiKeyManager(keys=mock_keys)
    mgr.cooldown_seconds = 2.0
    mgr.transient_cooldown_seconds = 1.0
    mgr.backoff_factor = 0.01  # Keep tests fast
    mgr.max_retries_per_key = 2
    mgr.total_max_retries = 6
    return mgr


def test_key_masking():
    """Ensure raw keys are never exposed in masked output."""
    raw = "FAKE_TEST_KEY_Ab8RN6Kd6jBTJAEVm8UrlrC0Fqf4A6Tely"
    masked = mask_key(raw)
    assert masked.startswith("FAK")
    assert masked.endswith("Tely")
    assert "..." in masked
    assert raw not in masked

    assert mask_key("") == "<EMPTY_KEY>"
    assert mask_key("short") == "***"


def test_single_key_backward_compatibility():
    """Verify single-key setup functions seamlessly."""
    single_key = "AQ.SingleKey1234567890abcdef"
    GeminiKeyManager._instance = None
    mgr = GeminiKeyManager(keys=[single_key])
    assert mgr.total_keys == 1
    assert mgr.key_states[0].key == single_key
    assert mgr.key_states[0].is_valid is True


def test_settings_multi_key_resolution():
    """Verify settings properties parse comma-separated and numbered env keys."""
    settings = Settings(
        gemini_api_key="KEY_PRIMARY",
        gemini_api_2key="KEY_SECOND",
        gemini_api_3key="KEY_THIRD",
        gemini_api_keys="KEY_A, KEY_B, KEY_PRIMARY",
    )
    keys = settings.all_gemini_api_keys
    # Should contain KEY_A, KEY_B, KEY_PRIMARY, KEY_SECOND, KEY_THIRD without duplicates
    assert "KEY_A" in keys
    assert "KEY_B" in keys
    assert "KEY_PRIMARY" in keys
    assert "KEY_SECOND" in keys
    assert "KEY_THIRD" in keys
    assert len(keys) == len(set(keys))


@pytest.mark.asyncio
async def test_key_rotation_on_rate_limit(manager):
    """Test that hitting HTTP 429 rotates to the next eligible key."""
    call_counts = {}

    async def mock_operation(client):
        # Identify key from client
        key = getattr(client, "_api_key", None)
        call_counts[key] = call_counts.get(key, 0) + 1

        if call_counts[key] == 1 and key == manager.key_states[0].key:
            # First key hits rate limit
            raise MockAPIError(429, "Resource exhausted / quota limit reached")
        
        mock_resp = MagicMock()
        mock_resp.text = f"Success with {mask_key(key)}"
        return mock_resp

    # Patch client creation to attach _api_key for assertion
    with patch("google.genai.Client") as mock_client_cls:
        def make_client(api_key):
            c = MagicMock()
            c._api_key = api_key
            return c
        mock_client_cls.side_effect = make_client

        res = await manager.execute_with_retry(mock_operation)
        assert "Success with" in res.text

        # Key 1 was rate-limited and should be in cooldown
        assert manager.key_states[0].cooldown_until > time.time()
        assert manager.key_states[0].consecutive_failures == 1

        # Key 2 succeeded
        assert manager.key_states[1].total_calls >= 1
        assert manager.key_states[1].consecutive_failures == 0


@pytest.mark.asyncio
async def test_invalid_key_permanent_skip(manager):
    """Test that 400/401/403 API_KEY_INVALID marks key permanently invalid."""
    async def mock_operation(client):
        key = getattr(client, "_api_key", None)
        if key == manager.key_states[0].key:
            raise MockAPIError(400, "API_KEY_INVALID: API key not valid. Please pass a valid API key.")
        mock_resp = MagicMock()
        mock_resp.text = "Success on valid key"
        return mock_resp

    with patch("google.genai.Client") as mock_client_cls:
        def make_client(api_key):
            c = MagicMock()
            c._api_key = api_key
            return c
        mock_client_cls.side_effect = make_client

        res = await manager.execute_with_retry(mock_operation)
        assert res.text == "Success on valid key"

        # Key 0 must be permanently disabled
        assert manager.key_states[0].is_valid is False
        assert "API_KEY_INVALID" in (manager.key_states[0].invalid_reason or "")

        # Next call should skip Key 0 automatically
        next_key = await manager.get_next_key()
        assert next_key.key != manager.key_states[0].key


@pytest.mark.asyncio
async def test_shared_quota_exhaustion_terminates(manager):
    """Test that when all configured keys hit 429 quota exhaustion, it raises without infinite loops."""
    async def mock_all_fail(client):
        raise MockAPIError(429, "RESOURCE_EXHAUSTED: Shared project quota exceeded")

    with patch("google.genai.Client"):
        with pytest.raises(GeminiQuotaExhaustedError) as exc_info:
            await manager.execute_with_retry(mock_all_fail)

        assert "quota" in str(exc_info.value).lower()


@pytest.mark.asyncio
async def test_cooldown_recovery(manager):
    """Test that once cooldown expires, key becomes eligible again."""
    key = manager.key_states[0]
    now = time.time()
    key.cooldown_until = now - 1.0  # Already in past

    assert key.is_eligible(now) is True


@pytest.mark.asyncio
async def test_streaming_failover_before_chunks(manager):
    """Test streaming failover when initial stream creation fails on Key 1."""
    attempt = 0

    async def mock_stream_factory(client):
        nonlocal attempt
        attempt += 1
        key = getattr(client, "_api_key", None)
        if key == manager.key_states[0].key:
            raise MockAPIError(429, "Rate limit on stream start")
        return DummyStream(["Hello", " world", "!"])

    with patch("google.genai.Client") as mock_client_cls:
        def make_client(api_key):
            c = MagicMock()
            c._api_key = api_key
            return c
        mock_client_cls.side_effect = make_client

        tokens = []
        async for token in manager.execute_stream_with_retry(mock_stream_factory):
            tokens.append(token)

        assert "".join(tokens) == "Hello world!"
        assert manager.key_states[0].consecutive_failures == 1
        assert manager.key_states[1].total_calls >= 1


def test_status_summary_privacy(manager):
    """Verify get_status_summary does not leak secret keys."""
    summary = manager.get_status_summary()
    assert len(summary) == len(manager.key_states)
    for item in summary:
        assert "key" not in item
        assert "masked_key" in item
        assert "..." in item["masked_key"]
