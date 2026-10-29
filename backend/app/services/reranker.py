"""
Reranker Service
Uses BGE-Reranker-Large (cross-encoder) to rerank retrieved chunks
before passing them to the LLM for answer generation.
"""

from typing import List, Dict, Any, Optional, Tuple

from sentence_transformers import CrossEncoder

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)
settings = get_settings()


class RerankerService:
    """Cross-encoder reranker using BGE-Reranker-Large."""

    _instance: Optional["RerankerService"] = None
    _model: Optional[CrossEncoder] = None

    def __new__(cls) -> "RerankerService":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _load_model(self) -> CrossEncoder:
        """Lazy-load the reranker model."""
        if self._model is None:
            logger.info("loading_reranker_model", model=settings.reranker_model)
            self._model = CrossEncoder(settings.reranker_model, max_length=512)
            logger.info("reranker_model_loaded")
        return self._model

    @property
    def model(self) -> CrossEncoder:
        return self._load_model()

    # Common stopwords to exclude from keyword boosting
    _STOPWORDS = frozenset({
        "a", "an", "the", "is", "are", "was", "were", "be", "been", "being",
        "have", "has", "had", "do", "does", "did", "will", "would", "could",
        "should", "may", "might", "can", "shall", "of", "in", "to", "for",
        "with", "on", "at", "from", "by", "about", "as", "into", "through",
        "during", "before", "after", "above", "below", "between", "out",
        "up", "down", "and", "but", "or", "nor", "not", "so", "if", "then",
        "than", "too", "very", "just", "how", "what", "which", "who", "whom",
        "this", "that", "these", "those", "am", "it", "its", "my", "your",
        "we", "they", "he", "she", "me", "him", "her", "us", "them",
        "i", "you", "all", "each", "every", "both", "few", "more", "most",
        "other", "some", "such", "no", "only", "own", "same", "many",
        "give", "list", "tell", "show", "find", "get", "make",
    })

    # Boost factor for chunks containing exact query keywords
    KEYWORD_BOOST = 0.15

    def _extract_query_keywords(self, query: str) -> List[str]:
        """Extract meaningful keywords from the query, excluding stopwords."""
        import re
        tokens = re.findall(r"\b\w+\b", query.lower())
        return [t for t in tokens if t not in self._STOPWORDS and len(t) > 1]

    def rerank(
        self,
        query: str,
        chunks: List[Dict[str, Any]],
        top_k: int = 5,
    ) -> List[Dict[str, Any]]:
        """
        Rerank retrieved chunks using cross-encoder scoring with keyword-aware boosting.

        The cross-encoder (BGE-Reranker) excels at natural language inference but
        struggles with structured/tabular data. To compensate, chunks that contain
        exact query keywords (e.g. city names, proper nouns) receive a score boost
        so they can't be completely buried by the reranker.

        Args:
            query: The user's question
            chunks: List of retrieved chunks from hybrid search
            top_k: Number of top chunks to return after reranking

        Returns:
            Top-k chunks sorted by boosted reranker score
        """
        if not chunks:
            return []

        # Extract meaningful keywords for boosting
        keywords = self._extract_query_keywords(query)

        # Prepare (query, document) pairs for the cross-encoder
        pairs = [(query, chunk["content"]) for chunk in chunks]

        # Score all pairs
        scores = self.model.predict(pairs, show_progress_bar=False)

        # Attach scores to chunks with keyword-aware boosting
        scored_chunks = []
        for chunk, score in zip(chunks, scores):
            reranked = chunk.copy()
            raw_score = float(score)
            reranked["rerank_score_raw"] = raw_score

            # Apply keyword boost: if the chunk contains query keywords, boost its score
            boost = 0.0
            if keywords:
                content_lower = chunk["content"].lower()
                matched = sum(1 for kw in keywords if kw in content_lower)
                if matched > 0:
                    boost = self.KEYWORD_BOOST * (matched / len(keywords))

            reranked["rerank_score"] = raw_score + boost
            reranked["keyword_boost"] = round(boost, 5)
            scored_chunks.append(reranked)

        # Sort by boosted reranker score descending
        scored_chunks.sort(key=lambda x: x["rerank_score"], reverse=True)

        # Return top-k
        top_chunks = scored_chunks[:top_k]

        logger.info(
            "chunks_reranked",
            input_count=len(chunks),
            output_count=len(top_chunks),
            top_score=top_chunks[0]["rerank_score"] if top_chunks else 0,
            keywords=keywords[:5],
        )

        return top_chunks
