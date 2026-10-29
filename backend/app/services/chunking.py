"""
Chunking Service
Implements Recursive Character Text Splitter with configurable chunk size/overlap.
Each chunk carries rich metadata for citation and filtering.
"""

import uuid
from typing import Dict, List, Optional, Any

from langchain_text_splitters import RecursiveCharacterTextSplitter

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)
settings = get_settings()


class ChunkingService:
    """Splits document text into overlapping chunks with metadata."""

    def __init__(
        self,
        chunk_size: Optional[int] = None,
        chunk_overlap: Optional[int] = None,
    ):
        self.chunk_size = chunk_size or settings.chunk_size
        self.chunk_overlap = chunk_overlap or settings.chunk_overlap

        self.splitter = RecursiveCharacterTextSplitter(
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
            length_function=len,
            separators=["\n\n", "\n", ". ", "! ", "? ", "; ", ", ", " ", ""],
            is_separator_regex=False,
        )

    def chunk_document(
        self,
        pages: List[Dict[str, Any]],
        document_id: str,
        filename: str,
        collection_id: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """
        Split document pages into chunks with metadata.

        Args:
            pages: List of page dicts with keys: page_number, content, paragraphs
            document_id: UUID of the document
            filename: Original filename
            collection_id: Optional collection UUID

        Returns:
            List of chunk dicts with keys: id, content, metadata
        """
        chunks = []
        global_index = 0

        for page in pages:
            page_number = page.get("page_number", 1)
            content = page.get("content", "")
            paragraphs = page.get("paragraphs", [])

            if not content.strip():
                continue

            # Split page content into chunks
            page_chunks = self.splitter.split_text(content)

            for chunk_text in page_chunks:
                if not chunk_text.strip():
                    continue

                # Determine which paragraph this chunk belongs to
                paragraph_number = self._find_paragraph_number(chunk_text, paragraphs)

                # Find character positions
                start_char = content.find(chunk_text)
                end_char = start_char + len(chunk_text) if start_char >= 0 else None

                chunk_data = {
                    "id": str(uuid.uuid4()),
                    "content": chunk_text,
                    "chunk_index": global_index,
                    "metadata": {
                        "document_id": document_id,
                        "filename": filename,
                        "page_number": page_number,
                        "paragraph_number": paragraph_number,
                        "chunk_index": global_index,
                        "start_char": start_char if start_char >= 0 else None,
                        "end_char": end_char,
                        "token_count": len(chunk_text.split()),
                        "collection_id": collection_id,
                    },
                }

                chunks.append(chunk_data)
                global_index += 1

        logger.info(
            "document_chunked",
            document_id=document_id,
            total_chunks=len(chunks),
            chunk_size=self.chunk_size,
            chunk_overlap=self.chunk_overlap,
        )

        return chunks

    @staticmethod
    def _find_paragraph_number(chunk_text: str, paragraphs: List[str]) -> Optional[int]:
        """Find which paragraph a chunk belongs to."""
        chunk_start = chunk_text[:100]  # Use first 100 chars for matching
        for i, para in enumerate(paragraphs):
            if chunk_start in para:
                return i + 1
        return None
