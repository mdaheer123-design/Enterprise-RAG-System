"""
Vector Store Service
Manages ChromaDB collections for storing and retrieving document embeddings.
Provides abstraction layer that can be swapped for pgvector/FAISS in production.
"""

import os
from typing import Dict, List, Optional, Any

import chromadb
from chromadb.config import Settings as ChromaSettings

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)
settings = get_settings()


class VectorStore:
    """ChromaDB-backed vector store with abstraction for production swap."""

    _instance: Optional["VectorStore"] = None
    _client: Optional[chromadb.ClientAPI] = None

    COLLECTION_NAME = "documents"

    def __new__(cls) -> "VectorStore":
        if cls._instance is None:
            cls._instance = super().__new__(cls)
        return cls._instance

    def _get_client(self) -> chromadb.ClientAPI:
        """Lazy-init ChromaDB client."""
        if self._client is None:
            persist_dir = settings.chroma_persist_dir
            os.makedirs(persist_dir, exist_ok=True)

            if settings.env == "production":
                self._client = chromadb.HttpClient(
                    host=settings.chroma_host,
                    port=settings.chroma_port,
                )
            else:
                self._client = chromadb.PersistentClient(
                    path=persist_dir,
                    settings=ChromaSettings(anonymized_telemetry=False),
                )

            logger.info("chromadb_initialized", persist_dir=persist_dir)
        return self._client

    @property
    def client(self) -> chromadb.ClientAPI:
        return self._get_client()

    def get_or_create_collection(self, name: Optional[str] = None) -> chromadb.Collection:
        """Get or create a ChromaDB collection."""
        collection_name = name or self.COLLECTION_NAME
        return self.client.get_or_create_collection(
            name=collection_name,
            metadata={"hnsw:space": "cosine"},
        )

    def add_documents(
        self,
        ids: List[str],
        embeddings: List[List[float]],
        documents: List[str],
        metadatas: List[Dict[str, Any]],
        collection_name: Optional[str] = None,
    ) -> None:
        """Add document chunks with embeddings to the vector store."""
        collection = self.get_or_create_collection(collection_name)

        # ChromaDB has a batch limit; process in chunks of 100
        batch_size = 100
        for i in range(0, len(ids), batch_size):
            batch_end = min(i + batch_size, len(ids))

            # Sanitize metadata – ChromaDB only supports str, int, float, bool
            sanitized_metas = []
            for meta in metadatas[i:batch_end]:
                sanitized = {}
                for k, v in meta.items():
                    if v is None:
                        sanitized[k] = ""
                    elif isinstance(v, (str, int, float, bool)):
                        sanitized[k] = v
                    else:
                        sanitized[k] = str(v)
                sanitized_metas.append(sanitized)

            collection.add(
                ids=ids[i:batch_end],
                embeddings=embeddings[i:batch_end],
                documents=documents[i:batch_end],
                metadatas=sanitized_metas,
            )

        logger.info("vectors_added", count=len(ids), collection=collection_name or self.COLLECTION_NAME)

    def query(
        self,
        query_embedding: List[float],
        n_results: int = 20,
        where: Optional[Dict[str, Any]] = None,
        collection_name: Optional[str] = None,
    ) -> Dict[str, Any]:
        """
        Query the vector store for similar documents.

        Returns:
            Dict with keys: ids, documents, metadatas, distances
        """
        collection = self.get_or_create_collection(collection_name)

        query_params: Dict[str, Any] = {
            "query_embeddings": [query_embedding],
            "n_results": n_results,
            "include": ["documents", "metadatas", "distances"],
        }

        if where:
            query_params["where"] = where

        results = collection.query(**query_params)

        logger.info(
            "vector_query",
            n_results=n_results,
            returned=len(results["ids"][0]) if results["ids"] else 0,
        )

        return {
            "ids": results["ids"][0] if results["ids"] else [],
            "documents": results["documents"][0] if results["documents"] else [],
            "metadatas": results["metadatas"][0] if results["metadatas"] else [],
            "distances": results["distances"][0] if results["distances"] else [],
        }

    def delete_by_document(self, document_id: str, collection_name: Optional[str] = None) -> None:
        """Delete all vectors for a given document."""
        collection = self.get_or_create_collection(collection_name)
        collection.delete(where={"document_id": document_id})
        logger.info("vectors_deleted", document_id=document_id)

    def get_collection_count(self, collection_name: Optional[str] = None) -> int:
        """Get the total number of vectors in a collection."""
        collection = self.get_or_create_collection(collection_name)
        return collection.count()
