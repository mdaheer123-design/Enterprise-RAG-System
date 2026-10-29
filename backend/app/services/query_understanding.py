"""
Query Understanding & Normalization Service
Handles:
- Acronym and abbreviation extraction
- Common question pattern normalization
- Natural document referencing (e.g. "in rag(pdf) full form of iso" -> doc: rag(pdf).pdf, query: "full form of iso")
- Content listing & table of contents query expansions
- Punctuation and hyphenation variations
- Multi-query expansion for hybrid retrieval
"""

import re
from typing import List, Set, Tuple, Optional, Any


class QueryUnderstandingService:
    """Lightweight query understanding and retrieval expansion."""

    # Common patterns for abbreviation and definition queries
    _FULL_FORM_PATTERNS = [
        re.compile(r"\b(?:what\s+is\s+(?:the\s+)?)?full\s+form\s+(?:of|for)\s+([A-Za-z0-9/\-]+)", re.IGNORECASE),
        re.compile(r"\b(?:what\s+does\s+)([A-Za-z0-9/\-]+)\s+(?:stand\s+for|mean)\b", re.IGNORECASE),
        re.compile(r"\bmeaning\s+(?:of|for)\s+([A-Za-z0-9/\-]+)", re.IGNORECASE),
        re.compile(r"\bdefinition\s+(?:of|for)\s+([A-Za-z0-9/\-]+)", re.IGNORECASE),
        re.compile(r"\bexpansion\s+(?:of|for)\s+([A-Za-z0-9/\-]+)", re.IGNORECASE),
        re.compile(r"\babbreviation\s+(?:of|for)\s+([A-Za-z0-9/\-]+)", re.IGNORECASE),
    ]

    # Patterns for table of contents / outline queries
    _CONTENTS_PATTERNS = [
        re.compile(r"\b(?:list\s+out|show|give|display|what\s+are\s+the)\s+(?:all\s+)?(?:the\s+)?(?:contents|table\s+of\s+contents|topics|sections|outline|chapters)\b", re.IGNORECASE),
        re.compile(r"\b(?:table\s+of\s+contents|contents\s+page|document\s+outline)\b", re.IGNORECASE),
    ]

    def resolve_document_mention(self, query: str, documents: List[Any]) -> Tuple[Optional[str], str]:
        """
        Check if query explicitly references a document by name, e.g.:
        - 'in rag(pdf) list out contents'
        - 'from rag(pdf) what is iso'
        - 'in Book(Sheet1).csv customer 30'
        
        Returns:
            Tuple of (matched_document_id or None, cleaned_query)
        """
        clean_q = query.strip()
        if not documents:
            return None, clean_q

        # Extract document candidate from prefix or suffix
        patterns = [
            # Prefix: "in/from/for/about <doc_hint> <rest>"
            re.compile(r"^(?:in|from|within|for|about|inside)\s+([a-zA-Z0-9_\-\.\(\)\s]{2,40}?)\s*[,:]?\s+(.+)$", re.IGNORECASE),
            # Suffix: "<rest> in/from/for <doc_hint>"
            re.compile(r"^(.+?)\s+(?:in|from|within|for|inside)\s+([a-zA-Z0-9_\-\.\(\)\s]{2,40})$", re.IGNORECASE),
        ]

        for p_idx, pat in enumerate(patterns):
            m = pat.match(clean_q)
            if m:
                if p_idx == 0:
                    doc_hint, remainder = m.group(1).strip(), m.group(2).strip()
                else:
                    remainder, doc_hint = m.group(1).strip(), m.group(2).strip()

                doc_hint_norm = re.sub(r"[^\w]", "", doc_hint.lower())
                if len(doc_hint_norm) >= 2:
                    for doc in documents:
                        fname = getattr(doc, "original_filename", "") or getattr(doc, "filename", "")
                        fname_norm = re.sub(r"[^\w]", "", fname.lower())
                        base_fname_norm = re.sub(r"[^\w]", "", fname.rsplit(".", 1)[0].lower())

                        if (
                            doc_hint_norm == fname_norm
                            or doc_hint_norm == base_fname_norm
                            or (len(doc_hint_norm) >= 3 and doc_hint_norm in fname_norm)
                            or (len(base_fname_norm) >= 3 and base_fname_norm in doc_hint_norm)
                        ):
                            return doc.id, remainder

        return None, clean_q

    def expand_query(self, query: str) -> Tuple[List[str], Set[str]]:
        """
        Generate retrieval query variants and keyword tokens without modifying the original query.
        """
        clean_q = query.strip()
        queries = [clean_q]
        keywords: Set[str] = set()

        # 1. Check for Table of Contents / Outline query
        is_contents_query = any(p.search(clean_q) for p in self._CONTENTS_PATTERNS)
        if is_contents_query:
            queries.append("Contents Page Foreword Introduction")
            queries.append("Table of contents")
            queries.append("Foreword Introduction Scope Normative references")
            keywords.update(["contents", "foreword", "introduction", "scope", "page"])

        # 2. Extract acronym/target term if matching definition patterns
        target_term = None
        for pattern in self._FULL_FORM_PATTERNS:
            match = pattern.search(clean_q)
            if match:
                target_term = match.group(1).strip(" ?.,!;:")
                break

        # 3. Extract uppercase/alphanumeric acronyms (2-10 chars, like ISO, IEC, 27001, ISMS)
        acronym_candidates = re.findall(r"\b[A-Za-z0-9]{2,10}\b", clean_q)
        for term in acronym_candidates:
            if term.isupper() or any(c.isdigit() for c in term):
                keywords.add(term.lower())

        if target_term:
            t_upper = target_term.upper()
            keywords.add(target_term.lower())

            # Add natural language search expansions for dense retrieval
            queries.append(f"What does {t_upper} stand for?")
            queries.append(f"{t_upper} definition and meaning")
            queries.append(f"Foreword and introduction to {t_upper}")
            queries.append(t_upper)

            # Handle slash/hyphen variants (e.g. ISO/IEC -> ISO, IEC, ISO IEC)
            if "/" in target_term:
                parts = target_term.split("/")
                for p in parts:
                    if p.strip():
                        keywords.add(p.strip().lower())
                queries.append(" ".join(parts))
            elif "-" in target_term:
                parts = target_term.split("-")
                for p in parts:
                    if p.strip():
                        keywords.add(p.strip().lower())
                queries.append(" ".join(parts))

        # 4. Clean tokenization for BM25 keywords
        raw_tokens = re.findall(r"\b[a-zA-Z0-9_\-]{2,}\b", clean_q.lower())
        stopwords = {
            "what", "is", "the", "for", "of", "and", "in", "to", "a", "an",
            "this", "that", "does", "from", "within", "list", "out", "give", "show", "tell"
        }
        for token in raw_tokens:
            if token not in stopwords:
                keywords.add(token)

        # Deduplicate while preserving order
        unique_queries = []
        seen = set()
        for q in queries:
            normalized = q.strip().lower()
            if normalized not in seen:
                seen.add(normalized)
                unique_queries.append(q.strip())

        return unique_queries, keywords
