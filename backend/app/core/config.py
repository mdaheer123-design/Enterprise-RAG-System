"""
Enterprise AI Knowledge Assistant - Configuration
Centralized settings management using Pydantic Settings.
"""

import os
from functools import lru_cache
from typing import List
from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Application settings loaded from environment variables."""

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )

    # ── Environment ──────────────────────────────────────────────
    env: str = "development"
    debug: bool = True

    # ── Server ───────────────────────────────────────────────────
    host: str = "0.0.0.0"
    port: int = 8000

    # ── Database ─────────────────────────────────────────────────
    database_url: str = "postgresql+asyncpg://postgres:postgres@localhost:5432/rag_assistant"
    database_url_sync: str = "postgresql://postgres:postgres@localhost:5432/rag_assistant"

    # ── ChromaDB ─────────────────────────────────────────────────
    chroma_host: str = "localhost"
    chroma_port: int = 8100
    chroma_persist_dir: str = "./data/chroma"

    # ── Gemini ───────────────────────────────────────────
    gemini_api_key: str = ""
    gemini_api_keys: str = ""
    gemini_api_2key: str = ""
    gemini_api_3key: str = ""
    gemini_api_4key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    gemini_temperature: float = 0.3
    gemini_max_tokens: int = 4096
    gemini_key_cooldown_seconds: float = 60.0
    gemini_max_retries_per_key: int = 2
    gemini_total_max_retries: int = 6
    gemini_backoff_factor: float = 0.5

    # ── Embedding Model ──────────────────────────────────────────
    embedding_model: str = "BAAI/bge-large-en-v1.5"
    embedding_dimension: int = 1024

    # ── Reranker ─────────────────────────────────────────────────
    reranker_model: str = "BAAI/bge-reranker-large"

    # ── RAG Configuration ────────────────────────────────────────
    chunk_size: int = 512
    chunk_overlap: int = 50
    top_k_retrieval: int = 20
    top_k_rerank: int = 5
    similarity_threshold: float = 0.35
    rerank_threshold: float = 0.003
    rrf_threshold: float = 0.003

    # ── Hybrid Search ────────────────────────────────────────────
    bm25_weight: float = 0.3
    dense_weight: float = 0.7

    # ── File Upload ──────────────────────────────────────────────
    max_file_size_mb: int = 50
    upload_dir: str = "./data/uploads"
    allowed_extensions: str = "pdf,docx,txt,csv,xlsx"

    # ── Rate Limiting ────────────────────────────────────────────
    rate_limit: str = "100/minute"

    # ── Logging ──────────────────────────────────────────────────
    log_level: str = "INFO"
    log_format: str = "json"

    # ── CORS ─────────────────────────────────────────────────────
    cors_origins: str = "http://localhost:5173,http://localhost:3000"

    # ── Security ─────────────────────────────────────────────────
    secret_key: str = "change-me-in-production"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 30

    # ── Weekly Automatic Cleanup ─────────────────────────────────
    cleanup_enabled: bool = True
    cleanup_interval_days: int = 7
    cleanup_retention_days: int = 7


    @property
    def allowed_extensions_list(self) -> List[str]:
        return [ext.strip() for ext in self.allowed_extensions.split(",")]

    @property
    def cors_origins_list(self) -> List[str]:
        return [origin.strip() for origin in self.cors_origins.split(",")]

    @property
    def max_file_size_bytes(self) -> int:
        return self.max_file_size_mb * 1024 * 1024

    @property
    def all_gemini_api_keys(self) -> List[str]:
        """
        Collect and deduplicate all configured Gemini API keys preserving order.
        Supports:
        - GEMINI_API_KEYS (comma, semicolon, or newline separated)
        - GEMINI_API_KEY (single key backwards compatibility)
        - GEMINI_API_2KEY, GEMINI_API_3KEY, GEMINI_API_4KEY, etc.
        - Any GEMINI_API_KEY_* environment variables.
        """
        keys: List[str] = []

        # 1. Check GEMINI_API_KEYS list
        if self.gemini_api_keys:
            raw_keys = self.gemini_api_keys.replace(";", ",").replace("\n", ",")
            for k in raw_keys.split(","):
                k_clean = k.strip()
                if k_clean and k_clean not in keys:
                    keys.append(k_clean)

        # 2. Check primary single key
        if self.gemini_api_key and self.gemini_api_key.strip():
            k_clean = self.gemini_api_key.strip()
            if k_clean not in keys:
                keys.append(k_clean)

        # 3. Check explicitly declared numbered keys
        for explicit_key in [self.gemini_api_2key, self.gemini_api_3key, self.gemini_api_4key]:
            if explicit_key and explicit_key.strip():
                k_clean = explicit_key.strip()
                if k_clean not in keys:
                    keys.append(k_clean)

        # 4. Check additional env variables matching GEMINI_API_KEY_* or GEMINI_API_*KEY
        for env_name, env_val in os.environ.items():
            upper = env_name.upper()
            if (upper.startswith("GEMINI_API_KEY_") or (upper.startswith("GEMINI_API_") and upper.endswith("KEY"))) and env_val:
                k_clean = env_val.strip()
                if k_clean and k_clean not in keys:
                    keys.append(k_clean)

        return keys


@lru_cache()
def get_settings() -> Settings:
    """Cached settings instance."""
    return Settings()
