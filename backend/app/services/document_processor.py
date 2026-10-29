"""
Document Processing Service
Handles file parsing, text extraction, cleaning, and metadata extraction
for PDF, DOCX, TXT, CSV, and Excel files.
"""

import os
import re
import uuid
from datetime import datetime
from pathlib import Path
from typing import Dict, List, Optional, Any, Tuple

import aiofiles
from fastapi import UploadFile

from app.core.config import get_settings
from app.core.logging import get_logger

logger = get_logger(__name__)
settings = get_settings()


class DocumentProcessor:
    """Extracts text and metadata from uploaded documents."""

    SUPPORTED_TYPES = {
        "pdf": "application/pdf",
        "docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "txt": "text/plain",
        "csv": "text/csv",
        "xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    }

    async def save_upload(self, file: UploadFile) -> Tuple[str, str]:
        """Save uploaded file and return (saved_filename, file_path)."""
        ext = Path(file.filename).suffix.lower().lstrip(".")
        if ext not in settings.allowed_extensions_list:
            raise ValueError(f"Unsupported file type: {ext}")

        # Create upload directory
        upload_dir = Path(settings.upload_dir)
        upload_dir.mkdir(parents=True, exist_ok=True)

        # Generate unique filename
        unique_name = f"{uuid.uuid4().hex}_{file.filename}"
        file_path = upload_dir / unique_name

        # Save file
        content = await file.read()
        if len(content) > settings.max_file_size_bytes:
            raise ValueError(f"File size exceeds {settings.max_file_size_mb}MB limit")

        if len(content) == 0:
            raise ValueError("Uploaded file is empty (0 bytes).")

        # Validate file content signature (magic bytes)
        if ext == "pdf" and b"%PDF" not in content[:1024]:
            raise ValueError("Corrupted or invalid PDF: Missing %PDF file signature.")

        async with aiofiles.open(file_path, "wb") as f:
            await f.write(content)

        logger.info("file_saved", filename=file.filename, path=str(file_path), size=len(content))
        return unique_name, str(file_path)

    async def extract_text(self, file_path: str, file_type: str) -> Dict[str, Any]:
        """
        Extract text content and metadata from a document.
        Returns: {"pages": [{"page_number": int, "content": str, "paragraphs": [str]}], "metadata": {...}}
        """
        extractors = {
            "pdf": self._extract_pdf,
            "docx": self._extract_docx,
            "txt": self._extract_txt,
            "csv": self._extract_csv,
            "xlsx": self._extract_xlsx,
        }

        extractor = extractors.get(file_type)
        if not extractor:
            raise ValueError(f"No extractor for file type: {file_type}")

        result = await extractor(file_path)
        logger.info("text_extracted", file_type=file_type, pages=len(result.get("pages", [])))
        return result

    async def _extract_pdf(self, file_path: str) -> Dict[str, Any]:
        """Extract text from PDF using pdfplumber with fallback to pypdf."""
        p = Path(file_path)
        if not p.is_file():
            raise FileNotFoundError(f"PDF file not found: {file_path}")
        if p.stat().st_size == 0:
            raise ValueError("PDF file is empty (0 bytes).")

        with open(file_path, "rb") as f:
            header = f.read(1024)
            if b"%PDF" not in header:
                raise ValueError("Corrupted or invalid PDF file: Missing %PDF signature.")

        pages = []
        total_words = 0
        total_chars = 0
        metadata: Dict[str, Any] = {}
        extracted = False

        # Attempt 1: pdfplumber (best layout and text stream support)
        try:
            import pdfplumber
            with pdfplumber.open(file_path) as pdf:
                page_count = len(pdf.pages)
                if page_count == 0:
                    raise ValueError("PDF has 0 pages.")

                meta = getattr(pdf, "metadata", {}) or {}
                metadata = {
                    "page_count": page_count,
                    "author": meta.get("Author"),
                    "title": meta.get("Title"),
                }

                for i, page in enumerate(pdf.pages):
                    raw_text = page.extract_text() or ""
                    cleaned = self._clean_text(raw_text)
                    paragraphs = self._split_paragraphs(cleaned)
                    words = len(cleaned.split())
                    total_words += words
                    total_chars += len(cleaned)

                    pages.append({
                        "page_number": i + 1,
                        "content": cleaned,
                        "paragraphs": paragraphs,
                        "word_count": words,
                    })
                extracted = True
        except Exception as e:
            logger.warning("pdfplumber_extraction_failed", error=str(e), file_path=file_path)

        # Attempt 2: pypdf fallback
        if not extracted:
            try:
                from pypdf import PdfReader
                reader = PdfReader(file_path)
                if getattr(reader, "is_encrypted", False):
                    raise ValueError("PDF is password-protected or encrypted.")

                page_count = len(reader.pages)
                if page_count == 0:
                    raise ValueError("PDF has 0 pages.")

                meta = reader.metadata
                metadata = {
                    "page_count": page_count,
                    "author": meta.author if meta else None,
                    "title": meta.title if meta else None,
                }

                pages = []
                total_words = 0
                total_chars = 0

                for i, page in enumerate(reader.pages):
                    raw_text = page.extract_text() or ""
                    cleaned = self._clean_text(raw_text)
                    paragraphs = self._split_paragraphs(cleaned)
                    words = len(cleaned.split())
                    total_words += words
                    total_chars += len(cleaned)

                    pages.append({
                        "page_number": i + 1,
                        "content": cleaned,
                        "paragraphs": paragraphs,
                        "word_count": words,
                    })
                extracted = True
            except Exception as e:
                if isinstance(e, (ValueError, FileNotFoundError)):
                    raise
                raise ValueError(f"Failed to read PDF file: {str(e)}")

        # Check for scanned / non-extractable PDF (OCR required)
        if total_chars == 0 or total_words == 0:
            raise ValueError(
                "PDF contains no extractable text. The document appears to be scanned or image-based, which requires an OCR engine (OCR is not currently enabled)."
            )

        metadata["word_count"] = total_words
        return {"pages": pages, "metadata": metadata}

    async def _extract_docx(self, file_path: str) -> Dict[str, Any]:
        """Extract text from DOCX."""
        from docx import Document as DocxDocument

        doc = DocxDocument(file_path)
        text_parts = []
        paragraphs = []

        for para in doc.paragraphs:
            if para.text.strip():
                text_parts.append(para.text)
                paragraphs.append(para.text)

        full_text = "\n".join(text_parts)
        full_text = self._clean_text(full_text)

        metadata = {
            "page_count": 1,
            "word_count": len(full_text.split()),
            "author": doc.core_properties.author if doc.core_properties else None,
            "title": doc.core_properties.title if doc.core_properties else None,
        }

        return {
            "pages": [{"page_number": 1, "content": full_text, "paragraphs": paragraphs}],
            "metadata": metadata,
        }

    async def _extract_txt(self, file_path: str) -> Dict[str, Any]:
        """Extract text from plain text files."""
        async with aiofiles.open(file_path, "r", encoding="utf-8", errors="ignore") as f:
            content = await f.read()

        content = self._clean_text(content)
        paragraphs = self._split_paragraphs(content)

        return {
            "pages": [{"page_number": 1, "content": content, "paragraphs": paragraphs}],
            "metadata": {"page_count": 1, "word_count": len(content.split())},
        }

    async def _extract_csv(self, file_path: str) -> Dict[str, Any]:
        """Extract text from CSV files as row-level natural language sentences."""
        import pandas as pd

        df = pd.read_csv(file_path)
        content = self._dataframe_to_natural_language(df)
        content = self._clean_text(content)
        cols = [str(c) for c in df.columns]

        return {
            "pages": [{"page_number": 1, "content": content, "paragraphs": content.split("\n")}],
            "metadata": {
                "page_count": 1,
                "word_count": len(content.split()),
                "rows": len(df),
                "columns": len(df.columns),
                "column_names": cols,
            },
        }

    async def _extract_xlsx(self, file_path: str) -> Dict[str, Any]:
        """Extract text from Excel files as row-level natural language sentences."""
        import pandas as pd

        sheets = pd.read_excel(file_path, sheet_name=None)
        pages = []
        total_words = 0
        sheets_meta = {}

        for i, (sheet_name, df) in enumerate(sheets.items()):
            nl_text = self._dataframe_to_natural_language(df)
            content = f"Sheet: {sheet_name}\n{nl_text}"
            content = self._clean_text(content)
            words = len(content.split())
            total_words += words
            cols = [str(c) for c in df.columns]

            sheets_meta[sheet_name] = {
                "rows": len(df),
                "columns": len(df.columns),
                "column_names": cols,
            }

            pages.append({
                "page_number": i + 1,
                "content": content,
                "paragraphs": content.split("\n"),
                "word_count": words,
                "sheet_name": sheet_name,
            })

        return {
            "pages": pages,
            "metadata": {
                "page_count": len(sheets),
                "word_count": total_words,
                "sheets": list(sheets.keys()),
                "sheets_meta": sheets_meta,
            },
        }

    @staticmethod
    def _dataframe_to_natural_language(df) -> str:
        """Convert a DataFrame into row-by-row natural language sentences.

        Each row becomes a sentence like:
        'Row 1: customer_name is Harish, gender is Male, city is Kolkata, ...'

        This representation is far more effective for semantic search and
        cross-encoder reranking than a raw table dump.
        """
        import pandas as pd

        cols = [str(c) for c in df.columns]
        # Filter out unnamed/empty columns
        meaningful_cols = [c for c in cols if not c.startswith("Unnamed")]
        if not meaningful_cols:
            meaningful_cols = cols

        # Build a header summary
        header = f"Table with columns: {', '.join(meaningful_cols)}.\n"

        rows = []
        for idx, row in df.iterrows():
            parts = []
            for col in meaningful_cols:
                val = row[col]
                if pd.isna(val):
                    continue
                parts.append(f"{col} is {val}")
            if parts:
                rows.append(f"Row {idx + 1}: {', '.join(parts)}.")

        return header + "\n".join(rows)

    @staticmethod
    def _clean_text(text: str) -> str:
        """Clean extracted text by removing excessive whitespace and control characters."""
        # Remove control characters except newlines
        text = re.sub(r"[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]", "", text)
        # Normalize whitespace
        text = re.sub(r"[ \t]+", " ", text)
        # Normalize newlines (max 2 consecutive)
        text = re.sub(r"\n{3,}", "\n\n", text)
        return text.strip()

    @staticmethod
    def _split_paragraphs(text: str) -> List[str]:
        """Split text into paragraphs."""
        paragraphs = re.split(r"\n\s*\n", text)
        return [p.strip() for p in paragraphs if p.strip()]
