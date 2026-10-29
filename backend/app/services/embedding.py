"""
Embedding Service
Generates embeddings using BGE-Large model via sentence-transformers.
Supports batch generation and caching.
"""

from typing import List, Optional

import numpy as np
from sentence_transformers import SentenceTransformer

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)
settings = get_settings()


class EmbeddingService:
    """Generates document/query embeddings using BGE-Large."""

    _instance: Optional["EmbeddingService"] = None
    _model: Optional[SentenceTransformer] = None

    def __new__(cls) -> "EmbeddingService":
        """Singleton pattern – only load the model once."""
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _load_model(self) -> SentenceTransformer:
        """Lazy-load the embedding model."""
        if self._model is None:
            logger.info("loading_embedding_model", model=settings.embedding_model)
            self._model = SentenceTransformer(settings.embedding_model)
            logger.info("embedding_model_loaded", dimension=self._model.get_sentence_embedding_dimension())
        return self._model

    @property
    def model(self) -> SentenceTransformer:
        return self._load_model()

    @property
    def dimension(self) -> int:
        return self.model.get_sentence_embedding_dimension()

    def embed_texts(self, texts: List[str], batch_size: int = 32) -> List[List[float]]:
        """
        Generate embeddings for a list of texts.

        Args:
            texts: List of text strings to embed
            batch_size: Number of texts to embed in one batch

        Returns:
            List of embedding vectors
        """
        if not texts:
            return []

        # BGE models perform better with instruction prefix for queries
        embeddings = self.model.encode(
            texts,
            batch_size=batch_size,
            show_progress_bar=False,
            normalize_embeddings=True,
        )

        logger.info("embeddings_generated", count=len(texts), dimension=embeddings.shape[1])
        return embeddings.tolist()

    def embed_query(self, query: str) -> List[float]:
        """
        Generate embedding for a search query.
        Uses BGE instruction prefix for better retrieval.
        """
        # BGE models recommend prepending instruction for queries
        instruction = "Represent this sentence for searching relevant passages: "
        embedding = self.model.encode(
            [instruction + query],
            normalize_embeddings=True,
        )
        return embedding[0].tolist()

    def compute_similarity(self, embedding_a: List[float], embedding_b: List[float]) -> float:
        """Compute cosine similarity between two embeddings."""
        a = np.array(embedding_a)
        b = np.array(embedding_b)
        return float(np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b)))
